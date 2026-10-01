#!/usr/bin/env node
/*
 * VisionForge camera gateway
 *
 * Browsers cannot talk to industrial and IP cameras directly (Telnet native mode, FTP drops,
 * RTSP, HTTP digest auth, no CORS). This small service runs on the station PC and exposes every
 * configured camera through one vendor-neutral HTTP API that the VisionForge page calls:
 *
 *   GET /api/health                     gateway status
 *   GET /api/cameras                    configured cameras (no credentials)
 *   GET /api/cameras/:id/frame          latest image (JPEG/PNG/BMP); ?trigger=1 triggers first
 *
 * Also: PLC inspection trigger over Modbus TCP (plc.js), and image / reference-sample storage
 * on this PC with retention (storage.js). See README.md for the full API.
 *
 * Adapters: cognex-native (In-Sight Native Mode over TCP), http-snapshot (Hikvision ISAPI,
 * Axis, Dahua, phone IP-webcam apps; none/basic/digest auth), rtsp (one frame via ffmpeg), and
 * folder (newest image written by a smart camera's FTP/file output).
 *
 * No dependencies: Node.js 18+ only. Usage: node gateway.js [path/to/cameras.json]
 */

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { PlcHandshake } = require('./plc');
const { Storage } = require('./storage');

const VERSION = '1.1.0';
const configPath = path.resolve(process.argv[2] || path.join(__dirname, 'cameras.json'));
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}\nCopy cameras.example.json to cameras.json and edit it.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const PORT = config.port || 8765;
const HOST = config.host || '127.0.0.1';
const TIMEOUT_MS = config.timeoutMs || 6000;
const allowedOrigins = new Set(config.allowedOrigins || []);
const cameras = new Map((config.cameras || []).map((camera) => [camera.id, camera]));
const configDir = path.dirname(configPath);
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

// Optional PLC handshake (Modbus TCP) and image/sample storage, enabled by config sections.
const plc = config.plc && config.plc.enabled !== false ? new PlcHandshake(config.plc) : null;
const storage = config.storage && config.storage.enabled !== false
  ? new Storage({ ...config.storage, path: path.resolve(configDir, config.storage.path || 'vision-data') })
  : null;

class GatewayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new GatewayError(504, `${what} did not respond within ${ms} ms`)), ms)),
]);

const contentTypeOf = (buffer) => {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  return null;
};

/* ---------- http-snapshot: GET an image URL, with basic or digest authentication ---------- */

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new GatewayError(504, `No response from ${new URL(url).host}`)));
  });
}

function digestHeader(challenge, { user, password }, method, url) {
  const params = Object.fromEntries([...challenge.matchAll(/(\w+)=("([^"]*)"|[^,\s]+)/g)].map((m) => [m[1], m[3] ?? m[2]]));
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const uri = new URL(url).pathname + new URL(url).search;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${user}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = params.qop ? params.qop.split(',')[0].trim() : null;
  const response = qop ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${params.nonce}:${ha2}`);
  let header = `Digest username="${user}", realm="${params.realm}", nonce="${params.nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (params.opaque) header += `, opaque="${params.opaque}"`;
  if (params.algorithm) header += `, algorithm=${params.algorithm}`;
  return header;
}

async function httpSnapshot(camera) {
  const headers = {};
  if (camera.auth === 'basic') headers.Authorization = `Basic ${Buffer.from(`${camera.user}:${camera.password}`).toString('base64')}`;
  let res = await request(camera.url, headers);
  if (res.status === 401 && camera.auth === 'digest') {
    const challenge = String(res.headers['www-authenticate'] || '');
    if (!/^Digest/i.test(challenge)) throw new GatewayError(502, 'Camera did not offer digest authentication');
    res = await request(camera.url, { Authorization: digestHeader(challenge, camera, 'GET', camera.url) });
  }
  if (res.status === 401) throw new GatewayError(502, 'Camera rejected the user name or password');
  if (res.status !== 200) throw new GatewayError(502, `Camera returned HTTP ${res.status}`);
  const type = contentTypeOf(res.body);
  if (!type) throw new GatewayError(502, 'Camera response is not a JPEG, PNG or BMP image');
  return { body: res.body, type };
}

/* ---------- cognex-native: In-Sight Native Mode over TCP (default port 23) ---------- */

// Session: log in, optionally trigger an acquisition (SW8 = software trigger), then read the
// current image (RB = read bitmap, returned as hexadecimal text). The reply format varies by
// firmware, so the parser only relies on the status line and on the BMP header's own length.
function cognexNative(camera, trigger) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: camera.host, port: camera.port || 23 });
    let text = '';
    let waiter = null;
    const fail = (error) => { socket.destroy(); reject(error); };
    const expect = (test, onMatch) => { waiter = { test, onMatch }; check(); };
    const send = (line) => socket.write(`${line}\r\n`);
    const check = () => {
      if (!waiter) return;
      const match = waiter.test(text);
      if (match !== null && match !== false) { const next = waiter.onMatch; waiter = null; next(match); }
    };
    socket.setTimeout(TIMEOUT_MS, () => fail(new GatewayError(504, `Cognex ${camera.host} did not respond`)));
    socket.on('error', (error) => fail(new GatewayError(502, `Cannot reach Cognex ${camera.host}:${camera.port || 23} (${error.code || error.message})`)));
    socket.on('data', (chunk) => { text += chunk.toString('latin1'); check(); });

    const statusLine = (after) => (t) => {
      const lines = t.slice(after).split(/\r?\n/);
      return lines.length > 1 ? lines[0].trim() : null;
    };
    const commandStatus = { '1': 'ok', '0': 'unrecognised command', '-1': 'invalid argument', '-2': 'command failed (is the camera Online?)', '-3': 'user has no write access' };

    expect((t) => /User:\s*$/i.test(t) || null, () => {
      send(camera.user || 'admin');
      expect((t) => /Password:\s*$/i.test(t) || null, () => {
        send(camera.password || '');
        expect((t) => (/User Logged In/i.test(t) ? true : /Invalid Password|Invalid User|Login failed/i.test(t) ? 'denied' : null), (result) => {
          if (result === 'denied') return fail(new GatewayError(502, 'Cognex rejected the user name or password'));
          const readImage = () => {
            const start = text.length;
            send('RB');
            expect((t) => {
              const body = t.slice(start);
              const lines = body.split(/\r?\n/);
              if (lines.length < 2) return null;
              const status = lines[0].trim();
              if (status !== '1') return { error: commandStatus[status] || `status ${status}` };
              // Optional decimal length line, then hex lines; stop once the BMP is complete.
              let rest = lines.slice(1);
              if (/^\d{1,9}$/.test(rest[0]?.trim() || '') && rest.length > 1 && !/[a-f]/i.test(rest[0])) rest = rest.slice(1);
              const hex = rest.join('').replace(/[^0-9a-f]/gi, '');
              if (hex.length < 12) return null;
              const head = Buffer.from(hex.slice(0, 12), 'hex');
              if (head[0] !== 0x42 || head[1] !== 0x4d) return { error: 'reply is not a bitmap' };
              const size = head.readUInt32LE(2);
              return hex.length >= size * 2 ? { image: Buffer.from(hex.slice(0, size * 2), 'hex') } : null;
            }, (outcome) => {
              socket.end();
              if (outcome.error) reject(new GatewayError(502, `Cognex RB: ${outcome.error}`));
              else resolve({ body: outcome.image, type: 'image/bmp' });
            });
          };
          if (!trigger) return readImage();
          const start = text.length;
          send('SW8');
          expect(statusLine(start), (status) => {
            if (status !== '1') return fail(new GatewayError(502, `Cognex trigger (SW8): ${commandStatus[status] || `status ${status}`}`));
            readImage();
          });
        });
      });
    });
  }).catch((error) => { throw error instanceof GatewayError ? error : new GatewayError(502, error.message); });
}

/* ---------- rtsp: one frame through ffmpeg (must be installed and on PATH) ---------- */

function rtspFrame(camera) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(camera.ffmpeg || 'ffmpeg', ['-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', camera.url, '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']);
    const chunks = [];
    let errors = '';
    ffmpeg.stdout.on('data', (c) => chunks.push(c));
    ffmpeg.stderr.on('data', (c) => { errors += c; });
    ffmpeg.on('error', () => reject(new GatewayError(502, 'ffmpeg is not installed or not on PATH (needed for RTSP cameras)')));
    ffmpeg.on('close', (code) => {
      const body = Buffer.concat(chunks);
      if (code === 0 && body.length) resolve({ body, type: 'image/jpeg' });
      else reject(new GatewayError(502, `RTSP frame failed: ${errors.trim().split('\n').pop() || `ffmpeg exit ${code}`}`));
    });
  });
}

/* ---------- folder: newest image written by a smart camera (FTP / file output) ---------- */

const IMAGE_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp' };
async function folderImage(camera) {
  let entries;
  try { entries = await fs.promises.readdir(camera.path); } catch { throw new GatewayError(502, `Folder not found: ${camera.path}`); }
  const images = await Promise.all(entries.filter((name) => IMAGE_EXT[path.extname(name).toLowerCase()]).map(async (name) => {
    const full = path.join(camera.path, name);
    return { name, full, mtime: (await fs.promises.stat(full)).mtimeMs };
  }));
  if (!images.length) throw new GatewayError(404, `No images yet in ${camera.path}`);
  const newest = images.sort((a, b) => b.mtime - a.mtime)[0];
  return { body: await fs.promises.readFile(newest.full), type: IMAGE_EXT[path.extname(newest.name).toLowerCase()], name: newest.name, time: newest.mtime };
}

const ADAPTERS = {
  'cognex-native': (camera, trigger) => cognexNative(camera, trigger),
  'http-snapshot': (camera) => httpSnapshot(camera),
  rtsp: (camera) => rtspFrame(camera),
  folder: (camera) => folderImage(camera),
};

/* ---------- HTTP API ---------- */

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Frame-Time, X-Frame-Source');
    // Chrome Private/Local Network Access: a public HTTPS page calling a local service.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  return origin && !(allowedOrigins.has(origin) || allowedOrigins.has('*')) ? origin : null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, limitBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) { reject(new GatewayError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new GatewayError(400, 'Request body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const sendFile = (res, file) => { res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=86400' }); res.end(file.body); };
const requireStorage = () => { if (!storage) throw new GatewayError(404, 'Storage is not configured on this gateway (add a "storage" section to cameras.json)'); return storage; };
const requirePlc = () => { if (!plc) throw new GatewayError(404, 'No PLC is configured on this gateway (add a "plc" section to cameras.json)'); return plc; };

/* ---------- PLC events for the station page (Server-Sent Events) ---------- */

const eventClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  eventClients.forEach((client) => client.res.write(payload));
}
function updateStationOnline() {
  if (plc) plc.setStationOnline([...eventClients].some((client) => client.station));
}
if (plc) {
  plc.on('status', (status) => broadcast('status', status));
  plc.on('trigger', (trigger) => { log(`PLC trigger ${trigger.id} (recipe ${trigger.recipe}, part ${trigger.partNumber})`); broadcast('trigger', trigger); });
  plc.on('result', (result) => { log(`PLC result ${result.id}: ${result.result}${result.reason ? ` (${result.reason})` : ''} in ${result.cycleMs} ms`); broadcast('result', result); });
  plc.on('log', log);
}
setInterval(() => eventClients.forEach((client) => client.res.write(': keep-alive\n\n')), 15000);

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = (re) => p.match(re);
  let match;

  if (p === '/api/plc/status' && req.method === 'GET') return sendJson(res, 200, plc ? plc.status() : { configured: false });
  if (p === '/api/plc/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const client = { res, station: url.searchParams.get('station') === '1' };
    eventClients.add(client);
    res.write(`event: status\ndata: ${JSON.stringify(plc ? plc.status() : { configured: false })}\n\n`);
    updateStationOnline();
    req.on('close', () => { eventClients.delete(client); updateStationOnline(); });
    return true;
  }
  if (p === '/api/plc/result' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    try { return sendJson(res, 200, await requirePlc().submitResult(Number(body.id), String(body.result))); }
    catch (error) { throw error.status ? error : new GatewayError(409, error.message); }
  }

  if (p === '/api/storage' && req.method === 'GET') return sendJson(res, 200, storage ? { configured: true, ...(await storage.stats()) } : { configured: false });
  if (p === '/api/storage/retention' && req.method === 'POST') return sendJson(res, 200, await requireStorage().setRetention(await readJson(req, 64 * 1024)));

  if (p === '/api/images' && req.method === 'POST') {
    const body = await readJson(req);
    const record = await requireStorage().saveImage(body.image, body.meta || {});
    log(`Stored image ${record.id} (${record.bytes} B)`);
    return sendJson(res, 201, record);
  }
  if (p === '/api/images' && req.method === 'GET') {
    const q = url.searchParams;
    return sendJson(res, 200, await requireStorage().listImages({ date: q.get('date') || undefined, result: q.get('result') || undefined, part: q.get('part') || undefined, limit: Number(q.get('limit')) || 60 }));
  }
  if ((match = m(/^\/api\/images\/([\w-]+)\/file$/)) && req.method === 'GET') return sendFile(res, await requireStorage().imageFile(match[1]));
  if ((match = m(/^\/api\/images\/([\w-]+)$/)) && req.method === 'GET') return sendJson(res, 200, await requireStorage().imageMeta(match[1]));

  if (p === '/api/samples' && req.method === 'POST') {
    const body = await readJson(req);
    const record = await requireStorage().saveSample(body.image, body.meta || {});
    log(`Stored sample ${record.id} (${record.label}${record.defectType ? ` · ${record.defectType}` : ''})`);
    return sendJson(res, 201, record);
  }
  if (p === '/api/samples' && req.method === 'GET') return sendJson(res, 200, await requireStorage().listSamples());
  if ((match = m(/^\/api\/samples\/([\w-]+)\/file$/)) && req.method === 'GET') return sendFile(res, await requireStorage().sampleFile(match[1]));
  if ((match = m(/^\/api\/samples\/([\w-]+)$/)) && req.method === 'DELETE') return sendJson(res, 200, await requireStorage().deleteSample(match[1]));
  return false;
}

const server = http.createServer(async (req, res) => {
  const rejected = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(rejected ? 403 : 204); res.end(); return; }
  if (rejected) { sendJson(res, 403, { error: `Origin ${rejected} is not in allowedOrigins` }); return; }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/plc/') || url.pathname.startsWith('/api/images') || url.pathname.startsWith('/api/samples') || url.pathname.startsWith('/api/storage')) {
      if (await handleApi(req, res, url) !== false) return;
      throw new GatewayError(404, 'Not found');
    }
    if (req.method !== 'GET') throw new GatewayError(405, 'Only GET is supported here');
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION, cameras: cameras.size, plc: Boolean(plc), storage: Boolean(storage) });
    if (url.pathname === '/api/cameras') {
      return sendJson(res, 200, [...cameras.values()].map(({ id, name, type, vendor, host, trigger }) => ({
        id, name, type, vendor: vendor || null, host: host || null, canTrigger: type === 'cognex-native' && trigger !== false,
      })));
    }
    const match = url.pathname.match(/^\/api\/cameras\/([\w.-]+)\/frame$/);
    if (match) {
      const camera = cameras.get(match[1]);
      if (!camera) throw new GatewayError(404, `Unknown camera “${match[1]}”`);
      const adapter = ADAPTERS[camera.type];
      if (!adapter) throw new GatewayError(500, `Unsupported camera type “${camera.type}”`);
      const trigger = url.searchParams.get('trigger') === '1' && camera.type === 'cognex-native' && camera.trigger !== false;
      const started = Date.now();
      const frame = await withTimeout(adapter(camera, trigger), TIMEOUT_MS + 2000, camera.name);
      res.writeHead(200, {
        'Content-Type': frame.type,
        'Cache-Control': 'no-store',
        'X-Frame-Time': new Date(frame.time || Date.now()).toISOString(),
        'X-Frame-Source': `${camera.type}${trigger ? ' (triggered)' : ''}${frame.name ? ` ${frame.name}` : ''}`,
      });
      res.end(frame.body);
      console.log(`${new Date().toISOString()} ${camera.id} ${frame.type} ${frame.body.length} B ${Date.now() - started} ms${trigger ? ' triggered' : ''}`);
      return;
    }
    throw new GatewayError(404, 'Not found');
  } catch (error) {
    const status = error.status || 500;
    console.warn(`${new Date().toISOString()} ${req.method} ${req.url} → ${status} ${error.message}`);
    if (!res.headersSent) sendJson(res, status, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VisionForge camera gateway ${VERSION} on http://${HOST}:${PORT}`);
  cameras.forEach((camera) => console.log(`  ${camera.id.padEnd(14)} ${camera.type.padEnd(14)} ${camera.name}`));
  console.log(`Allowed page origins: ${[...allowedOrigins].join(', ') || '(none — set allowedOrigins)'}`);
  if (plc) { plc.start(); console.log(`PLC: Modbus TCP ${config.plc.host}:${config.plc.port || 502} (unit ${config.plc.unitId || 1})`); } else console.log('PLC: not configured');
  if (storage) { storage.start(log); console.log(`Storage: ${storage.root} (PASS ${storage.retention.retentionPassDays} d, FAIL/ERROR ${storage.retention.retentionFailDays} d)`); } else console.log('Storage: not configured');
});
