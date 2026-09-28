/*
 * Image and reference-sample storage on the station PC.
 *
 *   <root>/images/YYYY-MM-DD/<PASS|FAIL|ERROR>/<HHMMSSmmm>_<part>.jpg  + .json (results, recipe, operator…)
 *   <root>/samples/<id>.jpg + .json                                    (Good / Defect references)
 *   <root>/settings.json                                               (retention days)
 *
 * Images are kept per result: PASS for `retentionPassDays`, FAIL and ERROR for
 * `retentionFailDays` (intent.md: configurable, never hard-coded). Expired folders are pruned
 * at start-up and every hour. Ids are validated so requests cannot escape the storage root.
 */

const fs = require('fs');
const path = require('path');

const RESULTS = ['PASS', 'FAIL', 'ERROR'];
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const IMAGE_ID = /^(\d{4}-\d{2}-\d{2})_(PASS|FAIL|ERROR)_([\w-]{1,80})$/;
const SAMPLE_ID = /^S[a-z0-9]{6,20}$/;
const DAY_MS = 86400000;

class StorageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class Storage {
  constructor({ path: root, retentionPassDays = 7, retentionFailDays = 90, maxImageMB = 10 }) {
    this.root = path.resolve(root);
    this.maxBytes = maxImageMB * 1024 * 1024;
    this.retention = { retentionPassDays, retentionFailDays };
    fs.mkdirSync(path.join(this.root, 'images'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'samples'), { recursive: true });
    try { Object.assign(this.retention, JSON.parse(fs.readFileSync(path.join(this.root, 'settings.json'), 'utf8'))); } catch { /* defaults */ }
  }

  start(log = () => {}) {
    const prune = () => this.prune().then((n) => n && log(`Retention removed ${n} image folder(s)`)).catch((e) => log(`Retention failed: ${e.message}`));
    prune();
    this.timer = setInterval(prune, 3600000);
  }

  stop() { clearInterval(this.timer); }

  static decode(dataUrl, maxBytes) {
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!match) throw new StorageError(400, 'image must be a JPEG or PNG data URL');
    const body = Buffer.from(match[2], 'base64');
    if (body.length > maxBytes) throw new StorageError(413, `image is larger than ${Math.round(maxBytes / 1048576)} MB`);
    return { body, ext: TYPES[match[1]], type: match[1] };
  }

  /* ---------- Inspection images ---------- */

  async saveImage(dataUrl, meta = {}) {
    const { body, ext } = Storage.decode(dataUrl, this.maxBytes);
    const result = RESULTS.includes(meta.result) ? meta.result : 'ERROR';
    const time = meta.time ? new Date(meta.time) : new Date();
    const date = time.toISOString().slice(0, 10);
    const stamp = time.toISOString().slice(11, 23).replace(/[:.]/g, '');
    const part = String(meta.partId || 'part').replace(/[^\w-]/g, '').slice(0, 40) || 'part';
    const base = `${stamp}_${part}`;
    const dir = path.join(this.root, 'images', date, result);
    await fs.promises.mkdir(dir, { recursive: true });
    const id = `${date}_${result}_${base}`;
    const record = { ...meta, id, result, time: time.toISOString(), file: `${base}.${ext}`, bytes: body.length, savedAt: new Date().toISOString() };
    await fs.promises.writeFile(path.join(dir, `${base}.${ext}`), body);
    await fs.promises.writeFile(path.join(dir, `${base}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  imagePaths(id) {
    const match = IMAGE_ID.exec(id || '');
    if (!match) throw new StorageError(400, 'invalid image id');
    const [, date, result, base] = match;
    const dir = path.join(this.root, 'images', date, result);
    return { dir, meta: path.join(dir, `${base}.json`) };
  }

  async imageMeta(id) {
    try { return JSON.parse(await fs.promises.readFile(this.imagePaths(id).meta, 'utf8')); }
    catch (error) { if (error instanceof StorageError) throw error; throw new StorageError(404, 'image not found (it may have expired)'); }
  }

  async imageFile(id) {
    const meta = await this.imageMeta(id);
    const file = path.join(this.imagePaths(id).dir, path.basename(meta.file));
    return { body: await fs.promises.readFile(file), type: meta.file.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }

  // Newest first; optional filters: date (YYYY-MM-DD), result, part text, limit.
  async listImages({ date, result, part, limit = 60 } = {}) {
    const imagesDir = path.join(this.root, 'images');
    let dates = (await fs.promises.readdir(imagesDir).catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    if (date) dates = dates.filter((d) => d === date);
    const records = [];
    for (const d of dates) {
      for (const r of RESULTS) {
        if (result && result !== r) continue;
        const dir = path.join(imagesDir, d, r);
        const files = (await fs.promises.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
        for (const f of files) {
          try {
            const record = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'));
            if (part && !String(record.partId || '').toLowerCase().includes(String(part).toLowerCase())) continue;
            delete record.steps; // details come from the single-image endpoint
            records.push(record);
          } catch { /* skip unreadable sidecar */ }
        }
      }
      if (records.length >= limit * 2) break;
    }
    return records.sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, Math.min(limit, 500));
  }

  /* ---------- Reference samples ---------- */

  async saveSample(dataUrl, meta = {}) {
    const { body, ext } = Storage.decode(dataUrl, this.maxBytes);
    const id = `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const label = meta.label === 'Defect' ? 'Defect' : 'Good';
    const record = {
      id, label,
      defectType: label === 'Defect' ? String(meta.defectType || 'Other').slice(0, 40) : null,
      note: String(meta.note || '').slice(0, 500),
      product: String(meta.product || '').slice(0, 60),
      recipe: String(meta.recipe || '').slice(0, 20),
      source: String(meta.source || '').slice(0, 60),
      author: String(meta.author || '').slice(0, 60),
      file: `${id}.${ext}`, bytes: body.length, created: new Date().toISOString(),
    };
    await fs.promises.writeFile(path.join(this.root, 'samples', record.file), body);
    await fs.promises.writeFile(path.join(this.root, 'samples', `${id}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  async listSamples() {
    const dir = path.join(this.root, 'samples');
    const files = (await fs.promises.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
    const records = [];
    for (const f of files) {
      try { records.push(JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
    }
    return records.sort((a, b) => (a.created < b.created ? 1 : -1));
  }

  async sampleRecord(id) {
    if (!SAMPLE_ID.test(id || '')) throw new StorageError(400, 'invalid sample id');
    try { return JSON.parse(await fs.promises.readFile(path.join(this.root, 'samples', `${id}.json`), 'utf8')); }
    catch { throw new StorageError(404, 'sample not found'); }
  }

  async sampleFile(id) {
    const record = await this.sampleRecord(id);
    return { body: await fs.promises.readFile(path.join(this.root, 'samples', path.basename(record.file))), type: record.file.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }

  async deleteSample(id) {
    const record = await this.sampleRecord(id);
    await fs.promises.rm(path.join(this.root, 'samples', path.basename(record.file)), { force: true });
    await fs.promises.rm(path.join(this.root, 'samples', `${id}.json`), { force: true });
    return record;
  }

  /* ---------- Retention and statistics ---------- */

  async setRetention({ retentionPassDays, retentionFailDays }) {
    const clampDays = (v, fallback) => (Number.isFinite(Number(v)) ? Math.min(3650, Math.max(1, Math.round(Number(v)))) : fallback);
    this.retention = { retentionPassDays: clampDays(retentionPassDays, this.retention.retentionPassDays), retentionFailDays: clampDays(retentionFailDays, this.retention.retentionFailDays) };
    await fs.promises.writeFile(path.join(this.root, 'settings.json'), JSON.stringify(this.retention, null, 2));
    await this.prune();
    return this.retention;
  }

  async prune(now = Date.now()) {
    const imagesDir = path.join(this.root, 'images');
    const dates = (await fs.promises.readdir(imagesDir).catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    let removed = 0;
    for (const d of dates) {
      // A day's folder expires once the whole day is older than the retention period.
      const ageDays = (now - (Date.parse(`${d}T00:00:00Z`) + DAY_MS)) / DAY_MS;
      for (const r of RESULTS) {
        const keep = r === 'PASS' ? this.retention.retentionPassDays : this.retention.retentionFailDays;
        const dir = path.join(imagesDir, d, r);
        if (ageDays >= keep && fs.existsSync(dir)) { await fs.promises.rm(dir, { recursive: true, force: true }); removed += 1; }
      }
      const left = await fs.promises.readdir(path.join(imagesDir, d)).catch(() => []);
      if (!left.length) await fs.promises.rm(path.join(imagesDir, d), { recursive: true, force: true });
    }
    return removed;
  }

  async stats() {
    const walk = async (dir) => {
      let files = 0, bytes = 0;
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { const s = await walk(full); files += s.files; bytes += s.bytes; }
        else if (!entry.name.endsWith('.json')) { files += 1; bytes += (await fs.promises.stat(full)).size; }
      }
      return { files, bytes };
    };
    const images = await walk(path.join(this.root, 'images'));
    const samples = await walk(path.join(this.root, 'samples'));
    return { root: this.root, images: images.files, imageBytes: images.bytes, samples: samples.files, sampleBytes: samples.bytes, ...this.retention };
  }
}

module.exports = { Storage, StorageError };
