/*
 * Station integration: PLC inspection trigger, image storage and reference samples.
 *
 * All three go through the VisionForge gateway on the station PC (camera-gateway/):
 *  - PLC:     Server-Sent Events deliver PLC triggers; the result is posted back and the gateway
 *             writes PASS / FAIL / ERROR and Complete to the PLC over Modbus TCP.
 *  - Images:  each recorded inspection is stored with its results (all, or FAIL/ERROR only).
 *  - Samples: Good / Defect reference images to compare with the part on the line.
 * Without a gateway (e.g. the online demo) images and samples are kept in this browser
 * (IndexedDB, newest 300 images) so the workflow can still be tried.
 */

const PLC_AUTO_KEY = 'visionforge.plcAuto';
const PIN_KEY = 'visionforge.pinnedSample';
const LOCAL_IMAGE_CAP = 300;

const st = {
  health: null,          // gateway /api/health, or null when no gateway answers
  events: null,          // EventSource for PLC events
  plc: { configured: false },
  auto: false,
  selectedSample: null,
  archive: [],
  samples: [],
  warnedStorage: false,
};

const se = {
  plcChip: document.querySelector('#plcChip'),
  plcDot: document.querySelector('#plcDot'),
  plcAuto: document.querySelector('#plcAuto'),
  plcStatusText: document.querySelector('#plcStatusText'),
  archiveStorage: document.querySelector('#archiveStorage'),
  samplesStorage: document.querySelector('#samplesStorage'),
  archiveFilters: document.querySelector('#archiveFilters'),
  archiveResult: document.querySelector('#archiveResult'),
  archiveDate: document.querySelector('#archiveDate'),
  archivePart: document.querySelector('#archivePart'),
  archiveGrid: document.querySelector('#archiveGrid'),
  imageDialog: document.querySelector('#imageDialog'),
  imageDialogTitle: document.querySelector('#imageDialogTitle'),
  imageDialogBody: document.querySelector('#imageDialogBody'),
  sampleForm: document.querySelector('#sampleForm'),
  sampleLabel: document.querySelector('#sampleLabel'),
  sampleDefect: document.querySelector('#sampleDefect'),
  defectTypeField: document.querySelector('#defectTypeField'),
  sampleNote: document.querySelector('#sampleNote'),
  sampleFilter: document.querySelector('#sampleFilter'),
  sampleGrid: document.querySelector('#sampleGrid'),
  compareSample: document.querySelector('#compareSample'),
  compareSampleCaption: document.querySelector('#compareSampleCaption'),
  compareLive: document.querySelector('#compareLive'),
  refreshLive: document.querySelector('#refreshLive'),
  pinSample: document.querySelector('#pinSample'),
  deleteSample: document.querySelector('#deleteSample'),
  pinned: document.querySelector('#pinnedSample'),
};

const escHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const useGateway = () => Boolean(st.health?.storage);

/* ---------- Gateway requests ---------- */

async function stationRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${gatewayBase()}${path}`, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(`Cannot reach the station gateway at ${gatewayBase()}.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Gateway returned HTTP ${response.status}`);
  return data;
}

async function checkStation() {
  try {
    const response = await fetch(`${gatewayBase()}/api/health`, { cache: 'no-store' });
    st.health = response.ok ? await response.json() : null;
  } catch {
    st.health = null;
  }
  renderStorageLabels();
  connectPlcEvents();
  if (useGateway()) pushRetention().catch(() => {});
  return st.health;
}

/* ---------- PLC trigger ---------- */

function connectPlcEvents() {
  st.events?.close();
  st.events = null;
  if (!st.health?.plc || !auth.user) { st.plc = { configured: Boolean(st.health?.plc), connected: false }; renderPlc(); return; }
  const asStation = st.auto && auth.can('RunInspection') ? 1 : 0;
  const events = new EventSource(`${gatewayBase()}/api/plc/events?station=${asStation}`);
  st.events = events;
  events.addEventListener('status', (event) => { st.plc = JSON.parse(event.data); renderPlc(); });
  events.addEventListener('trigger', (event) => onPlcTrigger(JSON.parse(event.data)));
  events.onerror = () => { st.plc = { ...st.plc, connected: false, gatewayLost: true }; renderPlc(); };
}

async function onPlcTrigger(trigger) {
  if (!st.auto || !auth.can('RunInspection')) return;
  // A manual inspection may still be finishing: wait briefly rather than refusing the part.
  const waitStart = Date.now();
  while (busy && Date.now() - waitStart < 1500) await new Promise((r) => setTimeout(r, 40));
  let result = 'ERROR';
  try {
    const run = await runProgram({ record: true, plc: trigger });
    result = run?.overall || 'ERROR';
  } catch { result = 'ERROR'; }
  try {
    await stationRequest('POST', '/api/plc/result', { id: trigger.id, result });
  } catch (error) {
    showToast(`PLC result not delivered: ${error.message}`, 'error');
  }
}

function setPlcAuto(on, { announce = true } = {}) {
  st.auto = Boolean(on) && auth.can('RunInspection');
  se.plcAuto.checked = st.auto;
  try { localStorage.setItem(PLC_AUTO_KEY, st.auto ? 'on' : 'off'); } catch { /* session only */ }
  connectPlcEvents();
  if (announce) {
    auth.audit('RunInspection', 'PLC trigger mode', st.auto ? 'off' : 'on', st.auto ? 'on' : 'off', 'Changed on Live inspection');
    showToast(st.auto ? 'Inspecting on PLC trigger. Keep this page open on the station PC.' : 'PLC trigger mode off: the PLC gets ERROR if it triggers.');
  }
}

function renderPlc() {
  const p = st.plc || {};
  let chip; let tone;
  if (!st.health) { chip = 'No gateway'; tone = 'off'; }
  else if (!st.health.plc) { chip = 'Not configured'; tone = 'off'; }
  else if (p.gatewayLost) { chip = 'Gateway lost'; tone = 'bad'; }
  else if (!p.connected) { chip = 'Disconnected'; tone = 'bad'; }
  else if (p.state === 'busy') { chip = 'Inspecting'; tone = 'busy'; }
  else if (p.state === 'complete') { chip = 'Result sent'; tone = 'ok'; }
  else if (p.ready) { chip = 'Ready'; tone = 'ok'; }
  else { chip = st.auto ? 'Connected' : 'Connected · station off'; tone = 'warn'; }
  se.plcChip.textContent = chip;
  se.plcDot.className = `plc-dot ${tone}`;
  const last = p.lastResult ? ` · last part ${p.lastResult.partNumber ?? '—'}: ${p.lastResult.result}` : '';
  se.plcStatusText.textContent = !st.health ? 'Station gateway not running' : !st.health.plc ? 'No PLC configured in the gateway' : `PLC ${p.host || ''} · ${chip}${p.count ? ` · ${p.count} parts` : ''}${last}`;
  se.plcStatusText.className = `plc-status ${tone}`;
  se.plcAuto.disabled = !st.health?.plc || !auth.can('RunInspection');
}

/* ---------- Browser fallback storage (IndexedDB) ---------- */

const localDb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('visionforge', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('images', { keyPath: 'id' });
        db.createObjectStore('samples', { keyPath: 'id' });
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  },
  async tx(store, mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = work(t.objectStore(store));
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => reject(t.error);
    });
  },
  put(store, value) { return this.tx(store, 'readwrite', (s) => s.put(value)); },
  del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
  get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
  all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
};
const objectUrls = new Map();
const blobUrl = (key, blob) => { if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(blob)); return objectUrls.get(key); };
const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

async function pruneLocal() {
  const images = await localDb.all('images');
  const { retentionPassDays, retentionFailDays } = auth.settings;
  const now = Date.now();
  const expired = images.filter((r) => now - Date.parse(r.meta.time) > (r.meta.result === 'PASS' ? retentionPassDays : retentionFailDays) * 86400000);
  const overflow = images.filter((r) => !expired.includes(r)).sort((a, b) => (a.meta.time < b.meta.time ? 1 : -1)).slice(LOCAL_IMAGE_CAP);
  for (const r of [...expired, ...overflow]) await localDb.del('images', r.id);
}

/* ---------- Image storage ---------- */

async function saveInspectionImage({ acquired, overall, results, cycle, partId, source, plc }) {
  const policy = auth.settings.saveImages || 'all';
  if (policy === 'off' || (policy === 'fail' && overall === 'PASS')) return;
  const dataUrl = acquired.hires().toDataURL('image/jpeg', 0.85);
  const steps = pgm.program.steps.filter((step) => results[step.id]).map((step) => {
    const r = results[step.id];
    return {
      name: step.name, tool: TOOLS[step.tool].label, status: r.status, label: resultLabel(step, r), text: r.text || '',
      rect: r.rect ? { x: r.rect.x / ANALYSIS_WIDTH, y: r.rect.y / ANALYSIS_HEIGHT, w: r.rect.w / ANALYSIS_WIDTH, h: r.rect.h / ANALYSIS_HEIGHT } : null,
      limits: `${step.criteria.min} – ${step.criteria.max} ${TOOLS[step.tool].unit}`.trim(),
    };
  });
  const meta = {
    partId, result: overall, time: new Date().toISOString(), product: pgm.program.product, recipe: `v${pgm.program.version}${pgm.dirty ? ' (draft)' : ''}`,
    station: auth.settings.stationName, operator: auth.user?.name || '—', source, cycleMs: Math.round(cycle * 1000),
    plc: plc ? { trigger: plc.id, partNumber: plc.partNumber, recipe: plc.recipe } : null, steps,
  };
  try {
    if (useGateway()) await stationRequest('POST', '/api/images', { image: dataUrl, meta });
    else {
      const id = `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      await localDb.put('images', { id, meta: { ...meta, id }, blob: await dataUrlToBlob(dataUrl) });
      await pruneLocal();
    }
  } catch (error) {
    if (!st.warnedStorage) { st.warnedStorage = true; showToast(`Inspection image not stored: ${error.message}`, 'error'); }
    return;
  }
  st.warnedStorage = false;
  if (currentView === 'archive') loadArchive();
}

async function listImages(filter) {
  if (useGateway()) {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    return (await stationRequest('GET', `/api/images?${q}`)).map((m) => ({ ...m, url: `${gatewayBase()}/api/images/${m.id}/file` }));
  }
  const records = await localDb.all('images');
  return records.map((r) => ({ ...r.meta, url: blobUrl(r.id, r.blob) }))
    .filter((m) => (!filter.result || m.result === filter.result) && (!filter.date || m.time.startsWith(filter.date)) && (!filter.part || String(m.partId).toLowerCase().includes(filter.part.toLowerCase())))
    .sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 60);
}

async function imageDetail(id) {
  if (useGateway()) return { ...(await stationRequest('GET', `/api/images/${encodeURIComponent(id)}`)), url: `${gatewayBase()}/api/images/${id}/file` };
  const r = await localDb.get('images', id);
  return { ...r.meta, url: blobUrl(r.id, r.blob) };
}

async function pushRetention() {
  const { retentionPassDays, retentionFailDays } = auth.settings;
  if (useGateway()) await stationRequest('POST', '/api/storage/retention', { retentionPassDays, retentionFailDays });
  else await pruneLocal();
}

async function renderStorageLabels() {
  let text = 'Storage: this browser (demo, newest 300 images)';
  if (useGateway()) {
    try {
      const s = await stationRequest('GET', '/api/storage');
      text = `Station PC: ${s.images} images · ${(s.imageBytes / 1048576).toFixed(1)} MB · keep PASS ${s.retentionPassDays} d, FAIL/ERROR ${s.retentionFailDays} d`;
    } catch { text = 'Station PC storage (details unavailable)'; }
  }
  se.archiveStorage.textContent = text;
  se.samplesStorage.textContent = useGateway() ? 'Samples stored on the station PC' : 'Samples stored in this browser (demo)';
}

/* ---------- Image archive view ---------- */

async function loadArchive() {
  se.archiveGrid.innerHTML = '<p class="empty">Loading…</p>';
  try {
    st.archive = await listImages({ result: se.archiveResult.value, date: se.archiveDate.value, part: se.archivePart.value.trim() });
  } catch (error) {
    se.archiveGrid.innerHTML = `<p class="empty">${escHtml(error.message)}</p>`;
    return;
  }
  se.archiveGrid.innerHTML = st.archive.map((m) => `
    <button type="button" class="archive-item" data-image="${escHtml(m.id)}">
      <img src="${escHtml(m.url)}" alt="" loading="lazy" />
      <span class="archive-meta"><strong>${escHtml(m.partId)}</strong><span class="result-chip ${m.result === 'PASS' ? 'pass-chip' : 'fail-chip'}">● ${m.result}</span></span>
      <small>${new Date(m.time).toLocaleString('en-GB')} · ${escHtml(m.recipe || '')}${m.plc ? ` · PLC part ${escHtml(m.plc.partNumber)}` : ''}</small>
    </button>`).join('') || '<p class="empty">No stored images match. Run an inspection, or change the filters.</p>';
  renderStorageLabels();
}

async function openImage(id) {
  let m;
  try { m = await imageDetail(id); } catch (error) { showToast(error.message, 'error'); return; }
  se.imageDialogTitle.textContent = `${m.partId} · ${m.result}`;
  const boxes = (m.steps || []).filter((s) => s.rect).map((s, i) => `<div class="stored-roi ${s.status.toLowerCase()}" style="left:${s.rect.x * 100}%;top:${s.rect.y * 100}%;width:${s.rect.w * 100}%;height:${s.rect.h * 100}%"><span>${String(i + 1).padStart(2, '0')}</span></div>`).join('');
  se.imageDialogBody.innerHTML = `
    <div class="stored-image"><img src="${escHtml(m.url)}" alt="Stored inspection image of ${escHtml(m.partId)}" />${boxes}</div>
    <dl class="stored-meta">
      <div><dt>TIME</dt><dd>${new Date(m.time).toLocaleString('en-GB')}</dd></div>
      <div><dt>RECIPE</dt><dd>${escHtml(m.product)} ${escHtml(m.recipe)}</dd></div>
      <div><dt>OPERATOR</dt><dd>${escHtml(m.operator)}</dd></div>
      <div><dt>SOURCE</dt><dd>${escHtml(m.source)}${m.plc ? ` · PLC part ${escHtml(m.plc.partNumber)}` : ''}</dd></div>
      <div><dt>CYCLE</dt><dd>${m.cycleMs} ms</dd></div>
      <div><dt>STATION</dt><dd>${escHtml(m.station)}</dd></div>
    </dl>
    <table class="stored-steps"><thead><tr><th>#</th><th>STEP</th><th>RESULT</th><th>MEASURED</th><th>LIMITS</th></tr></thead>
      <tbody>${(m.steps || []).map((s, i) => `<tr><td>${String(i + 1).padStart(2, '0')}</td><td>${escHtml(s.name)}<small>${escHtml(s.tool)}</small></td><td><span class="result-chip ${s.status === 'PASS' ? 'pass-chip' : 'fail-chip'}">${s.status}</span></td><td>${escHtml(s.label)}</td><td>${escHtml(s.limits)}</td></tr>`).join('')}</tbody></table>
    <div class="modal-actions">
      <button type="button" class="secondary-button" data-close-modal>Close</button>
      <button type="button" class="primary-button" id="imageToSample" ${auth.can('ModifyRecipe') ? '' : 'disabled title="Requires the ModifyRecipe permission"'}>Save as reference sample</button>
    </div>`;
  se.imageDialogBody.querySelector('#imageToSample').addEventListener('click', async () => {
    const dataUrl = await urlToDataUrl(m.url);
    await saveSample(dataUrl, { label: m.result === 'PASS' ? 'Good' : 'Defect', defectType: m.result === 'PASS' ? null : 'Other', note: `From ${m.partId} (${m.result}) ${new Date(m.time).toLocaleString('en-GB')}`, source: `archive ${m.id}` });
    se.imageDialog.hidden = true;
  });
  se.imageDialog.hidden = false;
}

async function urlToDataUrl(url) {
  // no-store: the same image may be cached from a plain <img> load without CORS headers.
  const blob = await (await fetch(url, { cache: 'no-store' })).blob();
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
}

/* ---------- Reference samples ---------- */

async function listSamplesAll() {
  if (useGateway()) return (await stationRequest('GET', '/api/samples')).map((m) => ({ ...m, url: `${gatewayBase()}/api/samples/${m.id}/file`, where: 'gateway' }));
  return (await localDb.all('samples')).map((r) => ({ ...r.meta, url: blobUrl(r.id, r.blob), where: 'local' })).sort((a, b) => (a.created < b.created ? 1 : -1));
}

async function saveSample(dataUrl, meta) {
  if (!auth.can('ModifyRecipe')) { showToast('Requires the ModifyRecipe permission.', 'error'); return null; }
  const full = { ...meta, product: pgm.program.product, recipe: `v${pgm.program.version}`, author: auth.user.name };
  let record;
  try {
    if (useGateway()) record = await stationRequest('POST', '/api/samples', { image: dataUrl, meta: full });
    else {
      const id = `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      record = { id, label: full.label === 'Defect' ? 'Defect' : 'Good', defectType: full.label === 'Defect' ? full.defectType : null, note: full.note || '', product: full.product, recipe: full.recipe, source: full.source || '', author: full.author, created: new Date().toISOString() };
      await localDb.put('samples', { id, meta: record, blob: await dataUrlToBlob(dataUrl) });
    }
  } catch (error) { showToast(`Sample not saved: ${error.message}`, 'error'); return null; }
  auth.audit('ModifyRecipe', 'Reference sample', '—', `${record.label}${record.defectType ? ` · ${record.defectType}` : ''} ${record.id}`, record.note || 'Added');
  showToast(`${record.label === 'Good' ? 'Golden' : `${record.defectType} defect`} sample saved.`);
  if (currentView === 'samples') loadSamples(record.id);
  return record;
}

async function loadSamples(selectId) {
  try { st.samples = await listSamplesAll(); } catch (error) { se.sampleGrid.innerHTML = `<p class="empty">${escHtml(error.message)}</p>`; return; }
  const filter = se.sampleFilter.querySelector('[aria-pressed="true"]')?.dataset.filter || '';
  const shown = st.samples.filter((m) => !filter || m.label === filter);
  se.sampleGrid.innerHTML = shown.map((m) => `
    <button type="button" class="sample-item${st.selectedSample?.id === m.id ? ' selected' : ''}" data-sample="${escHtml(m.id)}">
      <img src="${escHtml(m.url)}" alt="" loading="lazy" />
      <span class="sample-label ${m.label === 'Good' ? 'good' : 'defect'}">${m.label === 'Good' ? 'Good' : escHtml(m.defectType || 'Defect')}</span>
      <small>${escHtml(m.note || '—')}</small>
    </button>`).join('') || '<p class="empty">No samples yet. Save the current camera frame as a Good or Defect reference.</p>';
  renderStorageLabels();
  if (selectId) selectSample(selectId);
}

function selectSample(id) {
  const m = st.samples.find((s) => s.id === id);
  if (!m) return;
  st.selectedSample = m;
  se.sampleGrid.querySelectorAll('.sample-item').forEach((el) => el.classList.toggle('selected', el.dataset.sample === id));
  se.compareSample.src = m.url;
  se.compareSampleCaption.textContent = `${m.label === 'Good' ? 'Good (golden)' : `Defect · ${m.defectType}`}${m.note ? ` — ${m.note}` : ''} · ${m.author || ''}`;
  se.pinSample.disabled = false;
  se.deleteSample.disabled = !auth.can('ModifyRecipe');
  refreshLiveFrame();
}

async function currentFrameDataUrl() {
  const acquired = await acquireImage();
  return acquired.hires().toDataURL('image/jpeg', 0.9);
}

async function refreshLiveFrame() {
  try { se.compareLive.src = await currentFrameDataUrl(); } catch (error) { showToast(`No live frame: ${error.message}`, 'error'); }
}

function renderPinned() {
  let pinned = null;
  try { pinned = JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch { /* none */ }
  se.pinned.hidden = !pinned;
  if (!pinned) return;
  se.pinned.innerHTML = `<div class="pinned-head"><span class="eyebrow">REFERENCE SAMPLE</span><button type="button" class="text-button" id="unpinSample">Unpin</button></div>
    <img src="${escHtml(pinned.url)}" alt="Pinned reference sample" /><small>${escHtml(pinned.caption)}</small>`;
  se.pinned.querySelector('#unpinSample').addEventListener('click', () => { try { localStorage.removeItem(PIN_KEY); } catch { /* ignore */ } renderPinned(); });
}

/* ---------- Events ---------- */

se.plcAuto.addEventListener('change', () => setPlcAuto(se.plcAuto.checked));
se.archiveFilters.addEventListener('submit', (event) => { event.preventDefault(); loadArchive(); });
se.archiveGrid.addEventListener('click', (event) => { const item = event.target.closest('[data-image]'); if (item) openImage(item.dataset.image); });
se.sampleLabel.addEventListener('change', () => { se.defectTypeField.hidden = se.sampleLabel.value !== 'Defect'; });
se.sampleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const dataUrl = await currentFrameDataUrl();
    const record = await saveSample(dataUrl, { label: se.sampleLabel.value, defectType: se.sampleLabel.value === 'Defect' ? se.sampleDefect.value : null, note: se.sampleNote.value.trim(), source: 'camera frame' });
    if (record) se.sampleNote.value = '';
  } catch (error) { showToast(`Sample not saved: ${error.message}`, 'error'); }
});
se.sampleFilter.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  se.sampleFilter.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  loadSamples();
});
se.sampleGrid.addEventListener('click', (event) => { const item = event.target.closest('[data-sample]'); if (item) selectSample(item.dataset.sample); });
se.refreshLive.addEventListener('click', refreshLiveFrame);
se.pinSample.addEventListener('click', () => {
  const m = st.selectedSample;
  if (!m) return;
  try { localStorage.setItem(PIN_KEY, JSON.stringify({ id: m.id, url: m.url, caption: se.compareSampleCaption.textContent })); } catch { /* session only */ }
  renderPinned();
  showToast('Sample pinned next to Live inspection.');
});
se.deleteSample.addEventListener('click', async () => {
  const m = st.selectedSample;
  if (!m || !auth.can('ModifyRecipe')) return;
  try {
    if (m.where === 'gateway') await stationRequest('DELETE', `/api/samples/${m.id}`);
    else await localDb.del('samples', m.id);
  } catch (error) { showToast(error.message, 'error'); return; }
  auth.audit('ModifyRecipe', 'Reference sample', `${m.label}${m.defectType ? ` · ${m.defectType}` : ''} ${m.id}`, 'deleted', 'Deleted from the library');
  st.selectedSample = null;
  se.compareSample.removeAttribute('src');
  se.compareSampleCaption.textContent = 'Select a sample';
  se.pinSample.disabled = true;
  se.deleteSample.disabled = true;
  showToast('Sample deleted.');
  loadSamples();
});
document.addEventListener('viewshown', (event) => {
  if (event.detail === 'archive') loadArchive();
  if (event.detail === 'samples') loadSamples();
});
function onUserChange() {
  if (!auth.user) { st.events?.close(); st.events = null; renderPlc(); return; }
  let saved = false;
  try { saved = localStorage.getItem(PLC_AUTO_KEY) === 'on'; } catch { /* default off */ }
  setPlcAuto(saved, { announce: false });
  renderPlc();
}
auth.onChange(onUserChange);
// A saved session may have been restored before this script loaded.
if (auth.user) onUserChange();
gw.check.addEventListener('click', () => setTimeout(checkStation, 300));

renderPinned();
checkStation();
setInterval(() => { if (!st.health) checkStation(); }, 30000);
