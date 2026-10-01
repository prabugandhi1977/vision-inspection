#!/usr/bin/env node
/*
 * PLC simulator for testing the VisionForge PLC handshake without hardware.
 *
 * A Modbus TCP server (coils + holding registers) running a small "PLC program" that uses the
 * default signal map in plc.js:
 *   waits for Ready (coil 10) → writes recipe (HR0) and part number (HR1) → sets Trigger (coil 0)
 *   → waits for Complete (coil 12) → reads Pass/Fail/Error (coils 13–15) and result code (HR10)
 *   → clears Trigger → waits for Complete to drop.
 *
 * Usage:  node plc-simulator.js [--port 1502] [--interval 3000] [--count 0] [--manual]
 *   --interval ms   time between parts in automatic mode (default 3000)
 *   --count n       stop after n parts (0 = run until stopped)
 *   --manual        trigger one part each time Enter is pressed
 * Point the gateway at it with  "plc": { "host": "127.0.0.1", "port": 1502 }.
 */

const net = require('net');
const readline = require('readline');

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return pairs;
}, []));
const PORT = Number(args.port || 1502);
const INTERVAL = Number(args.interval || 3000);
const COUNT = Number(args.count || 0);
const MANUAL = Boolean(args.manual);

const coils = new Uint8Array(2000);
const holding = new Uint16Array(2000);
const C = { trigger: 0, reset: 1, ready: 10, busy: 11, complete: 12, pass: 13, fail: 14, error: 15, heartbeat: 16 };
const HR = { recipe: 0, partNumber: 1, resultCode: 10, count: 11 };

/* ---------- Modbus TCP server ---------- */

function handle(pdu) {
  const fc = pdu[0];
  const exception = (code) => Buffer.from([fc | 0x80, code]);
  const address = pdu.readUInt16BE(1);
  if (fc === 1 || fc === 2) {
    const count = pdu.readUInt16BE(3);
    if (address + count > coils.length) return exception(2);
    const bytes = Buffer.alloc(Math.ceil(count / 8));
    for (let i = 0; i < count; i += 1) if (coils[address + i]) bytes[i >> 3] |= 1 << (i & 7);
    return Buffer.concat([Buffer.from([fc, bytes.length]), bytes]);
  }
  if (fc === 3 || fc === 4) {
    const count = pdu.readUInt16BE(3);
    if (address + count > holding.length) return exception(2);
    const out = Buffer.alloc(2 + count * 2);
    out[0] = fc; out[1] = count * 2;
    for (let i = 0; i < count; i += 1) out.writeUInt16BE(holding[address + i], 2 + i * 2);
    return out;
  }
  if (fc === 5) {
    if (address >= coils.length) return exception(2);
    coils[address] = pdu.readUInt16BE(3) === 0xff00 ? 1 : 0;
    return Buffer.from(pdu.subarray(0, 5));
  }
  if (fc === 6) {
    if (address >= holding.length) return exception(2);
    holding[address] = pdu.readUInt16BE(3);
    return Buffer.from(pdu.subarray(0, 5));
  }
  return exception(1);
}

net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  console.log(`[plc] vision gateway connected from ${socket.remoteAddress}`);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 7) {
      const length = buffer.readUInt16BE(4);
      if (buffer.length < 6 + length) return;
      const frame = buffer.subarray(0, 6 + length);
      buffer = buffer.subarray(6 + length);
      const reply = handle(frame.subarray(7));
      const header = Buffer.from(frame.subarray(0, 7));
      header.writeUInt16BE(reply.length + 1, 4);
      socket.write(Buffer.concat([header, reply]));
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => console.log('[plc] vision gateway disconnected'));
}).listen(PORT, '127.0.0.1', () => console.log(`[plc] Modbus TCP PLC simulator on 127.0.0.1:${PORT} · ${MANUAL ? 'press Enter to trigger a part' : `a part every ${INTERVAL} ms`}${COUNT ? ` · ${COUNT} parts` : ''}`));

/* ---------- Simulated PLC program ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(test, timeoutMs) {
  const start = Date.now();
  while (!test()) { if (Date.now() - start > timeoutMs) return false; await sleep(5); }
  return true;
}

const tally = { PASS: 0, FAIL: 0, ERROR: 0, TIMEOUT: 0 };
let part = 1000;
let running = false;

async function cycle() {
  if (running) return;
  running = true;
  try {
    if (!(await waitFor(() => coils[C.ready], MANUAL ? 0 : 2000))) {
      console.log('[plc] vision station not ready (Ready = 0) — part held');
      return;
    }
    part += 1;
    holding[HR.recipe] = 1;
    holding[HR.partNumber] = part;
    const started = Date.now();
    coils[C.trigger] = 1;
    const done = await waitFor(() => coils[C.complete], 8000);
    if (!done) {
      tally.TIMEOUT += 1;
      console.log(`[plc] part ${part}: no Complete from vision within 8 s`);
    } else {
      const result = coils[C.pass] ? 'PASS' : coils[C.fail] ? 'FAIL' : coils[C.error] ? 'ERROR' : 'NONE';
      tally[result] = (tally[result] || 0) + 1;
      console.log(`[plc] part ${part}: ${result} (code ${holding[HR.resultCode]}, vision count ${holding[HR.count]}) in ${Date.now() - started} ms → ${result === 'PASS' ? 'accept' : 'reject'}`);
    }
    coils[C.trigger] = 0;
    await waitFor(() => !coils[C.complete], 2000);
  } finally {
    running = false;
  }
  const total = tally.PASS + tally.FAIL + tally.ERROR + tally.TIMEOUT;
  if (COUNT && total >= COUNT) {
    console.log(`[plc] done: ${JSON.stringify(tally)}`);
    process.exit(0);
  }
}

if (MANUAL) {
  readline.createInterface({ input: process.stdin }).on('line', () => cycle());
} else {
  setInterval(cycle, INTERVAL);
}
// Heartbeat watchdog, as a real PLC program would have: warn when the vision heartbeat stops.
let lastBeat = -1;
let lastChange = Date.now();
let warned = false;
setInterval(() => {
  if (coils[C.heartbeat] !== lastBeat) { lastBeat = coils[C.heartbeat]; lastChange = Date.now(); warned = false; }
  else if (!warned && Date.now() - lastChange > 3000 && lastBeat !== -1) { warned = true; console.log('[plc] WARNING: vision heartbeat stopped for 3 s'); }
}, 500);
