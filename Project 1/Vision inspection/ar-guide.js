/*
 * AR work guide: projected work instructions for the station, in the style of LightGuide.
 *
 * - Assembly: the recipe's operations are shown one at a time. A projector above the bench
 *   lights up where to work and which bin to pick from (pick-to-light), with the instruction.
 * - Error-proofing: each operation names the inspection steps that prove it was done. The
 *   camera checks them continuously and the guide only moves on after consecutive passes;
 *   pressing Done (Space / foot pedal) on an unfinished operation is refused and counted.
 * - Results and rework: a failed inspection is projected onto the part (failing regions in
 *   red), then rework guidance walks through each failing step and re-inspects the part.
 *
 * The operations, bins and rework texts are part of the recipe (program.guide), so they are
 * versioned, approved and audited with it. Projector calibration is station hardware
 * configuration (ConfigureCamera) and is stored in this browser.
 *
 * Loaded before inspection.js: top-level code here must not touch pgm, TOOLS or other
 * inspection.js constants; inspection.js calls ensureGuide / initGuide / renderGuide.
 */

const PROJECTOR_KEY = 'visionforge.projector';
const GUIDE_STATS_KEY = 'visionforge.guide.stats';
const GUIDE_PREFS_KEY = 'visionforge.guide.prefs';
const AR_PASSES_NEEDED = 2;  // consecutive passing camera checks before an operation counts as done
const AR_SETTLE_MS = 1500;   // let the operator's hands leave the area before checking
const AR_TICK_MS = 600;
const AR_PASS_HOLD_MS = 800; // green confirmation before the next operation
const AR_UNIT_HOLD_MS = 2500;
const AR_RESULT_PASS_MS = 5000;
// Console preview area in camera-view coordinates: the camera image plus the bench below it.
const BENCH = { x0: -0.05, x1: 1.05, y0: -0.05, y1: 1.4 };

const gd = {
  ready: false,
  selectedOp: null,
  drawing: null,      // { kind: 'op' | 'bin', id }
  dragStart: null,
  draft: null,
  run: null,          // the active guided unit or rework
  checking: false,
  lastInspection: null,
  projectResults: true,
  projector: { win: null, lastSeen: 0, seq: -1 },
  calibrating: false,
  loop: 0,
};

const ge = {
  view: document.querySelector('#view-guide'),
  stage: document.querySelector('#arStage'),
  canvas: document.querySelector('#arCanvas'),
  drawHint: document.querySelector('#arDrawHint'),
  operator: document.querySelector('#arOperator'),
  editor: document.querySelector('#arEditor'),
  stats: document.querySelector('#arStats'),
  projectorState: document.querySelector('#arProjectorState'),
  openProjector: document.querySelector('#arOpenProjector'),
  calibrate: document.querySelector('#arCalibrate'),
  projectResults: document.querySelector('#arProjectResults'),
};

const arChannel = 'BroadcastChannel' in window ? new BroadcastChannel(AR_CHANNEL) : null;
const arId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const guide = () => pgm.program.guide;
const opById = (id) => guide().operations.find((op) => op.id === id);
const binById = (id) => guide().bins.find((bin) => bin.id === id);
const round4 = (roi) => Object.fromEntries(Object.entries(roi).map(([k, v]) => [k, Number(v.toFixed(4))]));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/* ---------- Recipe data ---------- */

function emptyGuide() {
  return { operations: [], bins: [], rework: {}, finalInspection: true };
}

// Work instructions for the simulated Component_A. Targets follow the simulated part's
// features; verification uses the default program's steps, found by name.
function defaultGuide(program) {
  const ids = (...names) => names.map((name) => program.steps.find((step) => step.name === name)?.id).filter(Boolean);
  const [locator, presence, leftHole, rightHole, label, surface] = ids('Part locator', 'Part presence', 'Hole Ø (left)', 'Hole present (right)', 'Label colour', 'Surface finish');
  const op = (title, instruction, target, shape, binId, verify, stdTime) => ({ id: arId('o'), title, instruction, target, shape, binId, verify, stdTime });
  const rework = {};
  if (locator) rework[locator] = 'Re-seat the base plate fully in the fixture, label pocket facing up.';
  if (presence) rework[presence] = 'Re-seat the base plate fully in the fixture; replace it if it is damaged.';
  if (leftHole) rework[leftHole] = 'Press out the bushing and fit a new one from Bin B until flush.';
  if (rightHole) rework[rightHole] = 'Clear the right bore of chips or burrs so it is fully open.';
  if (label) rework[label] = 'Peel off the label and apply a new one from Bin D, centred in the pocket.';
  if (surface) rework[surface] = 'Polish out the scratch or clean off the stain in the marked area.';
  return {
    bins: [
      { id: 'binA', name: 'Bin A', part: 'Base plate BP-100', roi: { x: 0.02, y: 1.1, w: 0.2, h: 0.22 } },
      { id: 'binB', name: 'Bin B', part: 'Bushing BU-10', roi: { x: 0.28, y: 1.1, w: 0.2, h: 0.22 } },
      { id: 'binC', name: 'Bin C', part: 'Cloth / deburr tool', roi: { x: 0.54, y: 1.1, w: 0.2, h: 0.22 } },
      { id: 'binD', name: 'Bin D', part: 'Label LB-3', roi: { x: 0.8, y: 1.1, w: 0.18, h: 0.22 } },
    ],
    operations: [
      op('Load base plate', 'Pick a base plate from Bin A and place it in the fixture, label pocket facing up.', { x: 0.14, y: 0.3, w: 0.72, h: 0.42 }, 'box', 'binA', [locator, presence].filter(Boolean), 12),
      op('Fit left bushing', 'Pick a bushing from Bin B and press it into the left hole until it is flush.', { x: 0.243, y: 0.461, w: 0.09, h: 0.18 }, 'circle', 'binB', ids('Hole Ø (left)'), 8),
      op('Clear right bore', 'Check the right bore and remove any chip or burr with the deburr tool from Bin C.', { x: 0.663, y: 0.461, w: 0.09, h: 0.18 }, 'circle', 'binC', ids('Hole present (right)'), 6),
      op('Apply label', 'Pick a label from Bin D and apply it in the centre pocket.', { x: 0.416, y: 0.355, w: 0.166, h: 0.295 }, 'box', 'binD', ids('Label colour'), 10),
      op('Wipe surface', 'Wipe the marked surface with the cloth from Bin C. It must be free of scratches and stains.', { x: 0.33, y: 0.4, w: 0.09, h: 0.16 }, 'box', 'binC', ids('Surface finish'), 6),
    ],
    rework,
    finalInspection: true,
  };
}

// Adds work instructions to a program that has none (recipes saved before this feature),
// and fills in fields so older or hand-edited data cannot break the guide.
function ensureGuide(program) {
  if (!program) return;
  if (!program.guide) program.guide = program.product === 'Component_A' ? defaultGuide(program) : emptyGuide();
  const g = program.guide;
  g.operations = Array.isArray(g.operations) ? g.operations : [];
  g.bins = Array.isArray(g.bins) ? g.bins : [];
  g.rework = g.rework && typeof g.rework === 'object' ? g.rework : {};
  if (typeof g.finalInspection !== 'boolean') g.finalInspection = true;
  g.operations.forEach((op) => {
    op.verify = Array.isArray(op.verify) ? op.verify : [];
    op.shape = op.shape === 'circle' ? 'circle' : 'box';
    op.stdTime = Number(op.stdTime) || 0;
  });
}

// Keeps the guide consistent when an inspection step is deleted from the recipe.
function forgetGuideStep(stepId) {
  const g = pgm.program.guide;
  if (!g) return;
  g.operations.forEach((op) => { op.verify = op.verify.filter((id) => id !== stepId); });
  delete g.rework[stepId];
}

// Audit-trail lines for recipe changes to the work instructions (see describeChanges).
function describeGuideChanges(before, after) {
  const changes = [];
  const a = before.guide || emptyGuide();
  const b = after.guide || emptyGuide();
  const stepName = (id) => after.steps.find((s) => s.id === id)?.name || before.steps.find((s) => s.id === id)?.name || 'removed step';
  const oldOps = new Map(a.operations.map((op) => [op.id, op]));
  const newOpIds = new Set(b.operations.map((op) => op.id));
  b.operations.forEach((op) => {
    const old = oldOps.get(op.id);
    if (!old) { changes.push(`AR: added operation “${op.title}”`); return; }
    if (old.title !== op.title) changes.push(`AR: renamed operation “${old.title}” → “${op.title}”`);
    if (old.instruction !== op.instruction) changes.push(`AR: “${op.title}” instruction changed`);
    if (JSON.stringify(old.target) !== JSON.stringify(op.target) || old.shape !== op.shape) changes.push(`AR: “${op.title}” highlight moved`);
    if (old.binId !== op.binId) changes.push(`AR: “${op.title}” pick bin ${binLabel(a, old.binId)} → ${binLabel(b, op.binId)}`);
    if (JSON.stringify(old.verify) !== JSON.stringify(op.verify)) changes.push(`AR: “${op.title}” verified by ${op.verify.map(stepName).join(', ') || 'operator confirmation only'}`);
    if (old.stdTime !== op.stdTime) changes.push(`AR: “${op.title}” standard time ${old.stdTime} → ${op.stdTime} s`);
  });
  a.operations.forEach((op) => { if (!newOpIds.has(op.id)) changes.push(`AR: removed operation “${op.title}”`); });
  if (a.operations.map((op) => op.id).filter((id) => newOpIds.has(id)).join() !== b.operations.map((op) => op.id).filter((id) => oldOps.has(id)).join()) changes.push('AR: operation order changed');
  const oldBins = new Map(a.bins.map((bin) => [bin.id, bin]));
  const newBinIds = new Set(b.bins.map((bin) => bin.id));
  b.bins.forEach((bin) => {
    const old = oldBins.get(bin.id);
    if (!old) changes.push(`AR: added ${bin.name} (${bin.part})`);
    else if (old.name !== bin.name || old.part !== bin.part || JSON.stringify(old.roi) !== JSON.stringify(bin.roi)) changes.push(`AR: ${bin.name} changed`);
  });
  a.bins.forEach((bin) => { if (!newBinIds.has(bin.id)) changes.push(`AR: removed ${bin.name}`); });
  const reworkIds = new Set([...Object.keys(a.rework), ...Object.keys(b.rework)]);
  reworkIds.forEach((id) => { if ((a.rework[id] || '') !== (b.rework[id] || '')) changes.push(`AR: rework guidance for “${stepName(id)}” changed`); });
  if (a.finalInspection !== b.finalInspection) changes.push(`AR: final inspection after assembly ${b.finalInspection ? 'on' : 'off'}`);
  return changes;
}

function binLabel(g, id) {
  const bin = g.bins.find((item) => item.id === id);
  return bin ? bin.name : 'none';
}

/* ---------- Projector link ---------- */

function loadCalibration() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROJECTOR_KEY) || 'null');
    if (Array.isArray(stored?.corners) && stored.corners.length === 4) return stored;
  } catch { /* default */ }
  return JSON.parse(JSON.stringify(AR_DEFAULT_CALIBRATION));
}

const projectorConnected = () => Date.now() - gd.projector.lastSeen < 5000;

function sendToProjector(message) {
  const payload = { ...message, from: 'console' };
  arChannel?.postMessage(payload);
  const win = gd.projector.win;
  // postMessage covers pages opened from file://, where BroadcastChannel may not connect.
  if (win && !win.closed) { try { win.postMessage(payload, '*'); } catch { /* window closed */ } }
}

function pushScene() {
  if (!gd.ready) return;
  sendToProjector({ type: 'scene', scene: buildScene(), calibration: loadCalibration(), calibrating: gd.calibrating, guide: { bins: guide().bins } });
}

async function openProjector() {
  let features = 'popup,width=1280,height=720';
  // Chrome's Window Management API can place the window straight on the projector screen.
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const other = details.screens.find((screen) => screen !== details.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* permission declined: open on this screen */ }
  }
  const win = window.open('projector.html', 'visionforge-projector', features);
  if (!win) { showToast('The browser blocked the projector window. Allow pop-ups for this page.', 'error'); return null; }
  gd.projector.win = win;
  showToast('Projector window opened. Move it to the projector and select Full screen in it.');
  return win;
}

function startCalibration() {
  if (!auth.can('ConfigureCamera')) { showToast('Requires the ConfigureCamera permission.', 'error'); return; }
  if (!projectorConnected()) openProjector();
  gd.calibrating = true;
  pushScene();
  renderOperator();
  showToast('Drag the four corners in the projector window onto the corners of the camera’s field of view.');
}

function handleProjectorMessage(message) {
  if (!message || message.from !== 'projector') return;
  // The same message can arrive by BroadcastChannel and by postMessage.
  if (typeof message.seq === 'number') {
    if (message.seq <= gd.projector.seq && message.type !== 'hello') return;
    gd.projector.seq = message.seq;
  }
  const wasConnected = projectorConnected();
  gd.projector.lastSeen = Date.now();
  if (message.type === 'hello') { gd.projector.seq = message.seq ?? -1; pushScene(); }
  if (message.type === 'done') pressDone();
  if (message.type === 'calibration') saveCalibration(message.calibration);
  if (message.type === 'calibration-cancel') { gd.calibrating = false; pushScene(); renderOperator(); }
  if (!wasConnected) renderProjectorState();
}

function saveCalibration(calibration) {
  if (!gd.calibrating || !auth.can('ConfigureCamera')) return;
  if (!Array.isArray(calibration?.corners) || calibration.corners.length !== 4 || calibration.corners.flat().some((v) => !Number.isFinite(v))) return;
  const old = loadCalibration();
  const next = { corners: calibration.corners.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]), panel: calibration.panel === 'top' ? 'top' : 'bottom' };
  try { localStorage.setItem(PROJECTOR_KEY, JSON.stringify(next)); } catch { showToast('Calibration kept for this session only; browser storage is unavailable.', 'error'); }
  const fmt = (c) => c.corners.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
  auth.audit('ConfigureProjector', 'Projector calibration', fmt(old), fmt(next), 'Corner calibration in the projector window');
  gd.calibrating = false;
  pushScene();
  renderOperator();
  showToast('Projector calibration saved.');
}

arChannel?.addEventListener('message', (event) => handleProjectorMessage(event.data));
window.addEventListener('message', (event) => {
  if (event.source !== gd.projector.win && event.origin !== location.origin) return;
  handleProjectorMessage(event.data);
});

/* ---------- Camera checks ---------- */

// Runs only the given inspection steps (plus the part locator) without recording a part.
// Returns null when the inspection engine is busy, so the caller simply tries again.
async function checkSteps(stepIds) {
  const missing = stepIds.filter((id) => !stepById(id));
  if (missing.length) return { ok: false, failing: [], text: 'A verification step was removed from the recipe' };
  if (busy) return null;
  const out = await exclusive(() => runProgramOnce({ record: false, stepIds, quiet: true }));
  if (!out) return null;
  const failing = stepIds.map((id) => ({ step: stepById(id), result: out.results[id] })).filter((item) => item.result?.status !== 'PASS');
  // Every verification step must PASS: SKIPPED (disabled, part not located) or ERROR never counts as done.
  return { ok: out.overall !== 'ERROR' && !failing.length, failing, text: failing.map(describeFailing).join(' · ') || (out.overall === 'ERROR' ? 'Inspection error' : '') };
}

function describeFailing({ step, result }) {
  if (!result) return `${step.name}: not run`;
  const limits = result.value !== null && result.value !== undefined ? ` (needs ${step.criteria.min}–${step.criteria.max} ${TOOLS[step.tool].unit})` : '';
  return `${step.name}: ${result.status === 'PASS' ? 'OK' : resultLabel(step, result)}${limits}`;
}

/* ---------- Guided run ---------- */

function loadStats() {
  try { return JSON.parse(localStorage.getItem(GUIDE_STATS_KEY) || '{}'); } catch { return {}; }
}

function updateStats(change) {
  const all = loadStats();
  const key = pgm.program.product;
  const s = all[key] || { units: 0, firstPass: 0, reworked: 0, unitMs: [], ops: {} };
  change(s);
  s.unitMs = s.unitMs.slice(-50);
  all[key] = s;
  try { localStorage.setItem(GUIDE_STATS_KEY, JSON.stringify(all)); } catch { /* session only */ }
}

let audioCtx = null;
function beep(ok) {
  try {
    audioCtx ||= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    osc.type = ok ? 'sine' : 'square';
    gain.gain.value = 0.06;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.15 : 0.35));
  } catch { /* no audio */ }
}

function currentItem(run = gd.run) {
  if (!run) return null;
  if (run.mode === 'assembly') {
    const op = guide().operations[run.index];
    return op ? { kind: 'op', op, verify: op.verify } : null;
  }
  const stepId = run.items?.[run.index];
  return stepId ? { kind: 'rework', step: stepById(stepId), verify: [stepId] } : null;
}

function startAssembly() {
  if (!auth.can('RunInspection')) { showToast('Requires the RunInspection permission.', 'error'); return; }
  if (!guide().operations.length) { showToast('This recipe has no work instructions yet. Add operations below.', 'error'); return; }
  if (pgm.drawing || gd.drawing) { showToast('Finish drawing the region first.', 'error'); return; }
  gd.lastInspection = null;
  gd.run = { mode: 'assembly', index: 0, unitStart: Date.now(), reworked: false, standalone: false };
  enterItem(0);
}

function enterItem(index) {
  const run = gd.run;
  run.index = index;
  run.itemStart = Date.now();
  run.passes = 0;
  run.status = 'working';
  run.message = '';
  arUpdate();
}

function stopRun() {
  if (!gd.run) return;
  gd.run = null;
  arUpdate();
}

function nextItem() {
  const run = gd.run;
  const count = run.mode === 'assembly' ? guide().operations.length : run.items.length;
  if (run.index + 1 < count) enterItem(run.index + 1);
  else finishUnit(run);
}

function completeItem(run) {
  const item = currentItem(run);
  const elapsed = Date.now() - run.itemStart;
  if (item.kind === 'op') updateStats((s) => { const o = s.ops[item.op.id] ||= { n: 0, ms: 0, errors: 0 }; o.n += 1; o.ms += elapsed; });
  run.status = 'pass';
  run.message = item.verify.length ? 'Verified by the camera' : 'Confirmed by the operator';
  arUpdate();
  beep(true);
  window.setTimeout(() => { if (gd.run === run && run.status === 'pass') nextItem(); }, AR_PASS_HOLD_MS);
}

// Done / foot pedal: an operation with camera checks is only accepted when they pass.
async function pressDone() {
  const run = gd.run;
  if (!run || run.status !== 'working') return;
  const item = currentItem(run);
  if (!item) return;
  if (!item.verify.length) { completeItem(run); return; }
  const index = run.index;
  let check = null;
  for (let tries = 0; !check && tries < 20; tries += 1) {
    check = await checkSteps(item.verify);
    if (!check) await new Promise((resolve) => { window.setTimeout(resolve, 100); });
  }
  if (gd.run !== run || run.index !== index || run.status !== 'working') return;
  if (check?.ok) { completeItem(run); return; }
  run.status = 'error';
  run.message = `Not complete · ${check?.text || 'the camera check did not run'}`;
  run.passes = 0;
  if (item.kind === 'op') updateStats((s) => { const o = s.ops[item.op.id] ||= { n: 0, ms: 0, errors: 0 }; o.errors += 1; });
  beep(false);
  arUpdate();
  window.setTimeout(() => {
    if (gd.run === run && run.index === index && run.status === 'error') { run.status = 'working'; arUpdate(); }
  }, 2500);
}

function previousItem() {
  const run = gd.run;
  if (!run || run.index === 0 || ['final', 'complete'].includes(run.status)) return;
  enterItem(run.index - 1);
}

// Continuous camera check of the current operation (auto-advance).
async function autoCheck() {
  const run = gd.run;
  if (!run || run.status !== 'working' || gd.checking || gd.calibrating) return;
  const item = currentItem(run);
  if (!item?.verify.length || Date.now() - run.itemStart < AR_SETTLE_MS) return;
  gd.checking = true;
  try {
    const index = run.index;
    const check = await checkSteps(item.verify);
    if (!check || gd.run !== run || run.index !== index || run.status !== 'working') return;
    if (check.ok) {
      run.passes += 1;
      run.message = `Camera check passed (${run.passes}/${AR_PASSES_NEEDED})`;
      if (run.passes >= AR_PASSES_NEEDED) { completeItem(run); return; }
    } else {
      run.passes = 0;
      run.message = `Waiting · ${check.text}`;
    }
    renderOperatorStatus();
  } finally {
    gd.checking = false;
  }
}

async function finishUnit(run) {
  // Without a final inspection a unit with no rework is complete when its last operation is.
  if (!guide().finalInspection && run.mode === 'assembly') { unitComplete(run); return; }
  run.status = 'final';
  run.message = 'Running the full inspection program';
  arUpdate();
  for (let waited = 0; busy && waited < 100; waited += 1) await new Promise((resolve) => { window.setTimeout(resolve, 100); });
  const out = await runProgram();
  if (gd.run !== run) return;
  if (!out) { blockRun(run, 'The inspection could not start. Try again.'); return; }
  if (out.overall === 'PASS') unitComplete(run);
  else if (out.overall === 'FAIL') startRework(out.results, run);
  else blockRun(run, `Inspection ERROR · the part cannot pass until the cause is fixed (${firstError(out.results)}).`);
}

function firstError(results) {
  const step = pgm.program.steps.find((s) => results[s.id]?.status === 'ERROR');
  return step ? `${step.name}: ${results[step.id].text}` : 'camera or program error';
}

function blockRun(run, message) {
  run.status = 'blocked';
  run.message = message;
  beep(false);
  arUpdate();
}

function unitComplete(run) {
  updateStats((s) => {
    s.units += 1;
    if (run.reworked) s.reworked += 1; else s.firstPass += 1;
    s.unitMs.push(Date.now() - run.unitStart);
  });
  run.status = 'complete';
  run.message = run.reworked ? 'Reworked and passed' : 'Passed first time';
  beep(true);
  arUpdate();
  window.setTimeout(() => {
    if (gd.run !== run) return;
    if (run.standalone) stopRun(); else startAssembly();
  }, AR_UNIT_HOLD_MS);
}

// Walks through each failing step of an inspection; each must pass its camera check, then the
// whole part is inspected again (recorded).
function startRework(results, run = null) {
  if (!auth.can('RunInspection')) { showToast('Requires the RunInspection permission.', 'error'); return; }
  const items = pgm.program.steps.filter((step) => step.enabled && results[step.id]?.status === 'FAIL').map((step) => step.id);
  if (!items.length) { showToast('No failing steps to rework. Errors must be fixed at the camera or recipe.', 'error'); return; }
  const target = run || { unitStart: Date.now(), standalone: true };
  // Keep where each step failed (after locator shift): later checks only re-run one step.
  const rects = Object.fromEntries(items.map((id) => [id, results[id]?.rect]));
  Object.assign(target, { mode: 'rework', items, rects, reworked: true });
  gd.run = target;
  gd.lastInspection = null;
  beep(false);
  enterItem(0);
}

/* ---------- Scene (what is projected) ---------- */

const resultRoi = (rect) => ({ x: rect.x / ANALYSIS_WIDTH, y: rect.y / ANALYSIS_HEIGHT, w: rect.w / ANALYSIS_WIDTH, h: rect.h / ANALYSIS_HEIGHT });

function binShapes(activeId) {
  return guide().bins.map((bin) => (bin.id === activeId
    ? { roi: bin.roi, shape: 'box', tone: 'pick', pulse: true, label: `PICK · ${bin.name}` }
    : { roi: bin.roi, shape: 'box', tone: 'dim', dashed: true, label: bin.name }));
}

// preview: the console also shows the layout of all operations while nothing is running.
function buildScene({ preview = false } = {}) {
  const g = guide();
  const run = gd.run;
  const n = g.operations.length;
  if (run) {
    const item = currentItem(run);
    if (['final', 'complete', 'blocked'].includes(run.status) || !item) {
      const tone = { final: 'target', complete: 'pass', blocked: 'error' }[run.status] || 'target';
      const title = { final: 'Inspecting part…', complete: 'Unit complete · PASS', blocked: 'Inspection ERROR' }[run.status] || '';
      return { shapes: [], panel: { eyebrow: run.mode === 'rework' ? 'REWORK' : 'ASSEMBLY', title, text: run.message, tone, progress: 1 } };
    }
    if (item.kind === 'op') {
      const tone = run.status === 'pass' ? 'pass' : run.status === 'error' ? 'fail' : 'target';
      const bin = binById(item.op.binId);
      const shapes = [...binShapes(run.status === 'working' ? item.op.binId : null)];
      if (item.op.target) shapes.push({ roi: item.op.target, shape: item.op.shape, tone, pulse: tone !== 'pass', label: `${run.index + 1} · ${item.op.title}` });
      return {
        shapes,
        panel: {
          eyebrow: `OPERATION ${run.index + 1} OF ${n}`, title: item.op.title, text: item.op.instruction,
          pick: bin ? `Pick from ${bin.name} · ${bin.part}` : '', status: run.message, tone,
          startedAt: run.itemStart, stdTime: item.op.stdTime, progress: run.index / n,
        },
      };
    }
    const shapes = run.items.map((id, i) => {
      const step = stepById(id);
      const rect = run.rects?.[id] || pgm.lastResults[id]?.rect;
      const roi = rect ? resultRoi(rect) : step?.roi;
      if (!roi) return null;
      if (i < run.index) return { roi, shape: 'box', tone: 'pass', outline: true };
      if (i === run.index) return { roi, shape: 'box', tone: run.status === 'pass' ? 'pass' : 'fail', pulse: run.status !== 'pass', label: `REWORK · ${step.name}` };
      return { roi, shape: 'box', tone: 'fail', dashed: true };
    }).filter(Boolean);
    return {
      shapes,
      panel: {
        eyebrow: `REWORK ${run.index + 1} OF ${run.items.length}`, title: item.step?.name || 'Removed step',
        text: g.rework[item.verify[0]] || 'Correct the marked area. The camera re-checks it automatically.',
        status: run.message, tone: run.status === 'pass' ? 'pass' : 'fail', startedAt: run.itemStart, progress: run.index / run.items.length,
      },
    };
  }
  const last = gd.lastInspection;
  if (last && gd.projectResults && (last.overall !== 'PASS' || Date.now() - last.at < AR_RESULT_PASS_MS)) {
    const shapes = pgm.program.steps.filter((step) => step.enabled && last.results[step.id]?.rect).map((step) => {
      const r = last.results[step.id];
      if (r.status === 'PASS') return { roi: resultRoi(r.rect), shape: 'box', tone: 'pass', outline: true };
      if (r.status === 'SKIPPED') return { roi: resultRoi(r.rect), shape: 'box', tone: 'dim', dashed: true };
      return { roi: resultRoi(r.rect), shape: 'box', tone: r.status === 'ERROR' ? 'error' : 'fail', pulse: true, label: `${step.name} · ${resultLabel(step, r)}` };
    });
    const failing = pgm.program.steps.filter((step) => ['FAIL', 'ERROR'].includes(last.results[step.id]?.status)).map((step) => step.name);
    return {
      shapes,
      panel: {
        eyebrow: `PART ${last.partId}`, title: `Inspection ${last.overall}`,
        text: last.overall === 'PASS' ? 'All steps passed.' : `Check: ${failing.join(', ')}`,
        tone: last.overall === 'PASS' ? 'pass' : last.overall === 'ERROR' ? 'error' : 'fail',
      },
    };
  }
  if (!preview) return { shapes: [], panel: { eyebrow: pgm.program.product.toUpperCase(), title: 'Ready', text: 'Start guided assembly on the station console.', tone: 'dim' } };
  // Layout view for editing: every operation, the selected one highlighted, and the bins.
  const shapes = binShapes(opById(gd.selectedOp)?.binId);
  g.operations.forEach((op, i) => {
    if (!op.target) return;
    const selected = op.id === gd.selectedOp;
    shapes.push({ roi: op.target, shape: op.shape, tone: selected ? 'target' : 'dim', dashed: !selected, label: `${i + 1}${selected ? ` · ${op.title}` : ''}` });
  });
  return { shapes, panel: null };
}

/* ---------- Console preview ---------- */

function previewMap(width, height) {
  return (u, v) => [((u - BENCH.x0) / (BENCH.x1 - BENCH.x0)) * width, ((v - BENCH.y0) / (BENCH.y1 - BENCH.y0)) * height];
}

function drawCameraInto(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  if (!els.capturedFrame.hidden && els.capturedFrame.naturalWidth) {
    drawCover(ctx, els.capturedFrame, els.capturedFrame.naturalWidth, els.capturedFrame.naturalHeight, w, h);
  } else if (state.gateway?.image?.naturalWidth) {
    const image = state.gateway.image;
    drawCover(ctx, image, image.naturalWidth, image.naturalHeight, w, h);
  } else if (state.cameraStream && els.webcam.videoWidth) {
    if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    drawCover(ctx, els.webcam, els.webcam.videoWidth, els.webcam.videoHeight, w, h);
  } else if (pgm.simImage) {
    drawSimulation(ctx, pgm.simImage, w, h);
  } else {
    ctx.fillStyle = '#152e3a';
    ctx.fillRect(0, 0, w, h);
    if (!gd.simLoading) { gd.simLoading = true; simulationImage().catch(() => {}); }
  }
  ctx.restore();
}

function drawPreview() {
  const canvas = ge.canvas;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  const map = previewMap(width, height);
  ctx.fillStyle = '#0a1317';
  ctx.fillRect(0, 0, width, height);
  // Bench grid
  ctx.strokeStyle = 'rgba(160, 200, 210, 0.07)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 22; gx += 1) { const [px] = map(BENCH.x0 + gx * 0.05, 0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke(); }
  for (let gy = 0; gy <= 29; gy += 1) { const [, py] = map(0, BENCH.y0 + gy * 0.05); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke(); }
  const [cx0, cy0] = map(0, 0);
  const [cx1, cy1] = map(1, 1);
  drawCameraInto(ctx, cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.strokeStyle = 'rgba(160, 200, 210, 0.5)';
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(160, 200, 210, 0.7)';
  ctx.font = `500 ${9 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillText('BENCH · PICK BINS', cx0, height - 8 * dpr);
  const scene = buildScene({ preview: true });
  arDrawShapes(ctx, scene.shapes, map, { scale: dpr * 0.85 });
  if (gd.draft) arDrawShapes(ctx, [{ roi: gd.draft, shape: 'box', tone: 'target', dashed: true }], map, { scale: dpr });
}

function previewLoop() {
  gd.loop = 0;
  if (!gd.ready || ge.view.hidden) return;
  drawPreview();
  gd.loop = window.requestAnimationFrame(previewLoop);
}

function onGuideShown() {
  if (!gd.ready) return;
  renderGuide();
  if (!gd.loop) gd.loop = window.requestAnimationFrame(previewLoop);
}

// Drawing an operation target or a bin on the workbench preview.
function stagePoint(event) {
  const r = ge.canvas.getBoundingClientRect();
  return {
    x: clamp(BENCH.x0 + ((event.clientX - r.left) / r.width) * (BENCH.x1 - BENCH.x0), BENCH.x0, BENCH.x1),
    y: clamp(BENCH.y0 + ((event.clientY - r.top) / r.height) * (BENCH.y1 - BENCH.y0), BENCH.y0, BENCH.y1),
  };
}

function startStageDrawing(kind, id) {
  if (!canEdit()) return;
  gd.drawing = { kind, id };
  ge.stage.classList.add('drawing');
  ge.drawHint.textContent = `Drag on the workbench to place the ${kind === 'bin' ? 'bin' : 'highlight'} · Esc to cancel`;
  ge.drawHint.hidden = false;
  ge.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function stopStageDrawing() {
  gd.drawing = null;
  gd.dragStart = null;
  gd.draft = null;
  ge.stage.classList.remove('drawing');
  ge.drawHint.hidden = true;
}

ge.canvas.addEventListener('pointerdown', (event) => {
  if (!gd.drawing) return;
  event.preventDefault();
  gd.dragStart = stagePoint(event);
  ge.canvas.setPointerCapture(event.pointerId);
});
ge.canvas.addEventListener('pointermove', (event) => {
  if (!gd.dragStart) return;
  const p = stagePoint(event);
  gd.draft = { x: Math.min(p.x, gd.dragStart.x), y: Math.min(p.y, gd.dragStart.y), w: Math.abs(p.x - gd.dragStart.x), h: Math.abs(p.y - gd.dragStart.y) };
});
ge.canvas.addEventListener('pointerup', () => {
  if (!gd.dragStart) return;
  const roi = gd.draft;
  const { kind, id } = gd.drawing;
  stopStageDrawing();
  if (!roi || roi.w < 0.01 || roi.h < 0.01) { showToast('Region too small. Drag a larger area.', 'error'); return; }
  const item = kind === 'bin' ? binById(id) : opById(id);
  if (!item) return;
  if (kind === 'bin') item.roi = round4(roi); else item.target = round4(roi);
  guideChanged();
  showToast(`${kind === 'bin' ? item.name : `“${item.title}”`} placed on the workbench.`);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && gd.drawing) { stopStageDrawing(); return; }
  // Space / Enter (or a foot pedal that sends them) confirms the current operation.
  if (!gd.run || ge.view.hidden || event.repeat) return;
  if (event.target.closest?.('input, textarea, select, button, [contenteditable]')) return;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); pressDone(); }
});

/* ---------- Rendering ---------- */

function arUpdate() {
  renderOperator();
  renderGuideSteps();
  renderStats();
  pushScene();
}

function renderProjectorState() {
  const connected = projectorConnected();
  ge.projectorState.classList.toggle('connected', connected);
  ge.projectorState.lastElementChild.textContent = connected ? 'Projector connected' : 'Projector not connected';
}

function renderOperator() {
  const run = gd.run;
  const g = guide();
  const calibrating = gd.calibrating ? '<div class="ar-callout"><strong>Calibrating the projector</strong><span>Drag the four corners in the projector window onto the corners of the camera’s field of view, then select Save there.</span><button type="button" class="secondary-button" data-ar="cancelCalibration">Cancel</button></div>' : '';
  if (!run) {
    const last = gd.lastInspection;
    const failing = last && last.overall === 'FAIL' ? pgm.program.steps.filter((s) => last.results[s.id]?.status === 'FAIL') : [];
    ge.operator.innerHTML = `
      <div class="card-heading"><div><span class="eyebrow">OPERATOR</span><h2>Ready</h2></div><span class="pass-pill ar-idle">IDLE</span></div>
      <div class="ar-op-body">
        ${calibrating}
        <p class="ar-lead">${escapeHtml(pgm.program.product)} · ${g.operations.length} operation${g.operations.length === 1 ? '' : 's'}${g.finalInspection ? ' · full inspection at the end' : ''}</p>
        <button type="button" class="primary-button ar-big" data-ar="start" data-permission="RunInspection" ${g.operations.length && auth.can('RunInspection') ? '' : 'disabled'}>Start guided assembly</button>
        ${failing.length ? `<div class="ar-callout fail"><strong>Part ${escapeHtml(last.partId)} failed</strong><span>${failing.map((s) => escapeHtml(s.name)).join(', ')}</span><button type="button" class="primary-button" data-ar="rework" ${auth.can('RunInspection') ? '' : 'disabled'}>Start rework guidance</button></div>` : ''}
        <p class="ar-hint">Each operation is checked by the camera and advances by itself. <b>Space</b>, <b>Enter</b> or a foot pedal confirms it as Done; it is refused while the camera check fails.</p>
      </div>`;
    return;
  }
  const item = currentItem(run);
  const scene = buildScene();
  const p = scene.panel;
  const statusClass = { working: '', pass: 'pass', error: 'fail', final: '', complete: 'pass', blocked: 'error' }[run.status];
  const canDone = run.status === 'working' && item;
  ge.operator.innerHTML = `
    <div class="card-heading"><div><span class="eyebrow">${escapeHtml(p.eyebrow)}</span><h2>${escapeHtml(p.title)}</h2></div><span class="pass-pill ${statusClass}">${escapeHtml({ working: 'IN PROGRESS', pass: 'DONE', error: 'NOT DONE', final: 'INSPECTING', complete: 'PASS', blocked: 'ERROR' }[run.status])}</span></div>
    <div class="ar-op-body">
      ${calibrating}
      ${p.text ? `<p class="ar-instruction">${escapeHtml(p.text)}</p>` : ''}
      ${p.pick ? `<p class="ar-pick"><i></i>${escapeHtml(p.pick)}</p>` : ''}
      ${item && run.status !== 'final' ? `<p class="ar-verify">${item.verify.length ? `Camera check: ${item.verify.map((id) => escapeHtml(stepById(id)?.name || 'removed step')).join(', ')}` : 'No camera check: press Done when finished'}</p>` : ''}
      <p class="ar-status ${statusClass}" id="arStatus">${escapeHtml(run.message || '')}</p>
      <div class="ar-progress"><span id="arTimer"></span><i><em style="width:${Math.round((p.progress || 0) * 100)}%"></em></i></div>
      <div class="ar-actions">
        <button type="button" class="secondary-button" data-ar="back" ${run.index > 0 && canDone ? '' : 'disabled'}>Back</button>
        <button type="button" class="secondary-button danger" data-ar="stop">Stop</button>
        ${run.status === 'blocked' ? '<button type="button" class="primary-button ar-big" data-ar="retry">Inspect again</button>' : `<button type="button" class="primary-button ar-big" data-ar="done" ${canDone ? '' : 'disabled'}>Done <small>Space</small></button>`}
      </div>
    </div>`;
  renderTimer();
}

function renderOperatorStatus() {
  const el = ge.operator.querySelector('#arStatus');
  if (el && gd.run) el.textContent = gd.run.message;
}

function renderTimer() {
  const el = ge.operator.querySelector('#arTimer');
  const run = gd.run;
  if (!el || !run || !run.itemStart) return;
  const item = currentItem(run);
  const elapsed = Date.now() - run.itemStart;
  const std = item?.kind === 'op' ? item.op.stdTime : 0;
  el.textContent = std ? `${seconds(elapsed)} / standard ${std} s` : seconds(elapsed);
  el.classList.toggle('over', Boolean(std) && elapsed > std * 1500 && run.status === 'working');
}

function renderGuideSteps() {
  const list = ge.editor.querySelector('#arOpList');
  if (!list) return;
  const run = gd.run?.mode === 'assembly' ? gd.run : null;
  list.querySelectorAll('li[data-op]').forEach((li, i) => {
    li.classList.toggle('active', Boolean(run) && run.index === i);
    li.classList.toggle('done', Boolean(run) && (i < run.index || (i === run.index && ['pass', 'final', 'complete'].includes(run.status))));
  });
}

function opEditor(op) {
  if (!op) return '<div class="editor-empty"><strong>No operation selected</strong><p>Add an operation or select one to edit its instruction, highlight, pick bin and camera check.</p></div>';
  const g = guide();
  const t = op.target || { x: 0, y: 0, w: 0, h: 0 };
  const num = (key, value) => `<label>${key.toUpperCase()}<input type="number" step="0.01" data-target="${key}" value="${value}" /></label>`;
  return `
    <label>Title<input type="text" data-op-field="title" value="${escapeHtml(op.title)}" maxlength="60" /></label>
    <label>Instruction <small class="field-hint">projected next to the part</small><textarea data-op-field="instruction" rows="3" maxlength="240">${escapeHtml(op.instruction)}</textarea></label>
    <div class="ar-two">
      <label>Standard time (s)<input type="number" min="0" step="1" data-op-field="stdTime" value="${op.stdTime}" /></label>
      <label>Highlight<select data-op-field="shape"><option value="box" ${op.shape === 'box' ? 'selected' : ''}>Rectangle</option><option value="circle" ${op.shape === 'circle' ? 'selected' : ''}>Circle</option></select></label>
    </div>
    <fieldset><legend>Where to work <small>· camera-view coordinates</small></legend>
      <div class="roi-fields">${num('x', t.x)}${num('y', t.y)}${num('w', t.w)}${num('h', t.h)}</div>
      <div class="ar-row"><button type="button" class="secondary-button" data-edit="drawOp">Draw on workbench</button><button type="button" class="secondary-button" data-edit="useRoi" ${op.verify.length ? '' : 'disabled'}>Use check region</button></div>
    </fieldset>
    <label>Pick from (pick-to-light)<select data-op-field="binId"><option value="">No pick</option>${g.bins.map((bin) => `<option value="${bin.id}" ${bin.id === op.binId ? 'selected' : ''}>${escapeHtml(bin.name)} · ${escapeHtml(bin.part)}</option>`).join('')}</select></label>
    <fieldset><legend>Error-proofing · camera check</legend>
      <div class="ar-checks">${pgm.program.steps.map((step) => `<label class="toggle"><input type="checkbox" data-verify="${step.id}" ${op.verify.includes(step.id) ? 'checked' : ''} /> ${escapeHtml(step.name)} <small>${escapeHtml(TOOLS[step.tool].label)}${step.enabled ? '' : ' · disabled'}</small></label>`).join('')}</div>
      <small class="field-hint">The operation is done when all checked steps pass ${AR_PASSES_NEEDED}× in a row. With none checked, the operator confirms it with Done.</small>
    </fieldset>`;
}

function renderGuideEditor() {
  const g = guide();
  if (!opById(gd.selectedOp)) gd.selectedOp = g.operations[0]?.id ?? null;
  const locked = !canEdit();
  const recipeState = pgm.dirty ? 'DRAFT · UNSAVED' : pgm.pending ? 'CHANGE PENDING APPROVAL' : 'APPROVED';
  ge.editor.innerHTML = `
    <div class="card-heading program-heading">
      <div><span class="eyebrow">WORK INSTRUCTIONS · PART OF THE RECIPE</span>
        <h2>${escapeHtml(pgm.program.product)} · Recipe v${escapeHtml(pgm.program.version)} <span class="program-state ${pgm.dirty || pgm.pending ? 'draft' : ''}">${recipeState}</span></h2></div>
      <button type="button" class="secondary-button" data-ar="goSave">${pgm.dirty ? 'Save or submit in Inspection program →' : 'Open Inspection program →'}</button>
    </div>
    ${locked ? '<p class="permission-note">Your role can run guided assembly, but changing work instructions needs the <b>ModifyRecipe</b> permission.</p>' : ''}
    <div class="ar-edit-grid${locked ? ' locked' : ''}">
      <div>
        <h3>Operations <span>${g.operations.length}</span></h3>
        <ol id="arOpList" class="ar-op-list">${g.operations.map((op, i) => `
          <li data-op="${op.id}" class="${op.id === gd.selectedOp ? 'selected' : ''}">
            <button type="button" class="step-select" data-select-op="${op.id}"><span class="step-number">${String(i + 1).padStart(2, '0')}</span>
              <span class="step-name"><strong>${escapeHtml(op.title)}</strong><small>${escapeHtml([binById(op.binId)?.name, op.verify.length ? `${op.verify.length} camera check${op.verify.length > 1 ? 's' : ''}` : 'operator confirms', op.stdTime ? `${op.stdTime} s` : ''].filter(Boolean).join(' · '))}</small></span></button>
            <span class="step-order"><button type="button" data-edit="up" data-id="${op.id}" aria-label="Move up">▲</button><button type="button" data-edit="down" data-id="${op.id}" aria-label="Move down">▼</button></span>
            <button type="button" class="step-remove" data-edit="removeOp" data-id="${op.id}" aria-label="Remove operation">×</button>
          </li>`).join('') || '<li class="empty">No operations yet.</li>'}</ol>
        <button type="button" class="secondary-button" data-edit="addOp">+ Add operation</button>
        <label class="toggle ar-final"><input type="checkbox" data-guide-field="finalInspection" ${g.finalInspection ? 'checked' : ''} /> Run the full inspection when the unit is complete</label>
      </div>
      <div class="step-editor">${opEditor(opById(gd.selectedOp))}</div>
      <div>
        <h3>Pick bins <span>${g.bins.length}</span></h3>
        <div class="ar-bins">${g.bins.map((bin) => `
          <div class="ar-bin"><input type="text" data-bin="${bin.id}" data-bin-field="name" value="${escapeHtml(bin.name)}" aria-label="Bin name" maxlength="20" />
            <input type="text" data-bin="${bin.id}" data-bin-field="part" value="${escapeHtml(bin.part)}" aria-label="Part in bin" maxlength="40" />
            <button type="button" class="secondary-button" data-edit="drawBin" data-id="${bin.id}" title="Place on the workbench">Place</button>
            <button type="button" class="step-remove" data-edit="removeBin" data-id="${bin.id}" aria-label="Remove bin">×</button></div>`).join('') || '<p class="panel-hint">No bins. Add one and place it on the workbench below the camera view.</p>'}</div>
        <button type="button" class="secondary-button" data-edit="addBin">+ Add bin</button>
        <h3 class="ar-rework-head">Rework guidance</h3>
        <p class="panel-hint">Shown and projected for each failing step of a rejected part.</p>
        <div class="ar-rework">${pgm.program.steps.map((step) => `<label>${escapeHtml(step.name)}<textarea rows="2" maxlength="200" data-rework="${step.id}" placeholder="Correct the marked area.">${escapeHtml(g.rework[step.id] || '')}</textarea></label>`).join('')}</div>
      </div>
    </div>`;
  if (locked) ge.editor.querySelectorAll('.ar-edit-grid input, .ar-edit-grid select, .ar-edit-grid textarea, .ar-edit-grid button[data-edit]').forEach((control) => { control.disabled = true; });
  renderGuideSteps();
}

function renderStats() {
  const s = loadStats()[pgm.program.product];
  const ops = guide().operations;
  if (!s?.units && !Object.keys(s?.ops || {}).length) {
    ge.stats.innerHTML = '<div class="card-heading"><div><span class="eyebrow">GUIDED ASSEMBLY · THIS STATION</span><h2>Operation times and errors</h2></div></div><p class="ar-empty">No guided units yet. Times and refused Done presses are recorded per operation.</p>';
    return;
  }
  const avgUnit = s.unitMs.length ? s.unitMs.reduce((a, b) => a + b, 0) / s.unitMs.length : 0;
  ge.stats.innerHTML = `
    <div class="card-heading"><div><span class="eyebrow">GUIDED ASSEMBLY · THIS STATION</span><h2>Operation times and errors</h2></div><button type="button" class="text-button" data-ar="resetStats">Reset</button></div>
    <div class="ar-kpis">
      <div><span>UNITS</span><strong>${s.units}</strong></div>
      <div><span>FIRST-PASS YIELD</span><strong>${s.units ? ((s.firstPass / s.units) * 100).toFixed(1) : '—'}%</strong></div>
      <div><span>REWORKED</span><strong>${s.reworked}</strong></div>
      <div><span>AVG. UNIT TIME</span><strong>${avgUnit ? seconds(avgUnit) : '—'}</strong></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>OPERATION</th><th>DONE</th><th>AVG. TIME</th><th>STANDARD</th><th>REFUSED DONE</th></tr></thead>
      <tbody>${ops.map((op) => {
        const o = s.ops[op.id];
        const avg = o?.n ? o.ms / o.n : 0;
        const over = avg && op.stdTime && avg > op.stdTime * 1000;
        return `<tr><td><strong>${escapeHtml(op.title)}</strong></td><td>${o?.n || 0}</td><td class="${over ? 'ar-over' : ''}">${avg ? seconds(avg) : '—'}</td><td>${op.stdTime ? `${op.stdTime} s` : '—'}</td><td>${o?.errors || 0}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function renderGuide() {
  if (!gd.ready) return;
  ensureGuide(pgm.program);
  // A recipe change (approve, discard) can remove the operation or step being run.
  if (gd.run && !currentItem(gd.run) && !['final', 'complete', 'blocked'].includes(gd.run.status)) gd.run = null;
  renderOperator();
  renderGuideEditor();
  renderStats();
  renderProjectorState();
  pushScene();
}

/* ---------- Editing ---------- */

function guideChanged() {
  markDirty();
  renderHeader();
  renderGuideEditor();
  pushScene();
}

ge.editor.addEventListener('click', (event) => {
  const select = event.target.closest('[data-select-op]');
  if (select) { gd.selectedOp = select.dataset.selectOp; renderGuideEditor(); pushScene(); return; }
  const ar = event.target.closest('[data-ar]');
  if (ar?.dataset.ar === 'goSave') {
    showView('program');
    if (pgm.dirty) window.setTimeout(() => pe.reason.focus(), 300);
    return;
  }
  const button = event.target.closest('[data-edit]');
  if (!button || !canEdit()) return;
  const g = guide();
  const id = button.dataset.id;
  const op = opById(gd.selectedOp);
  switch (button.dataset.edit) {
    case 'addOp': {
      const fresh = { id: arId('o'), title: `Operation ${g.operations.length + 1}`, instruction: '', target: { x: 0.4, y: 0.35, w: 0.2, h: 0.3 }, shape: 'box', binId: '', verify: [], stdTime: 10 };
      g.operations.push(fresh);
      gd.selectedOp = fresh.id;
      break;
    }
    case 'removeOp': {
      const removed = opById(id);
      if (!removed || !window.confirm(`Remove operation “${removed.title}”?`)) return;
      g.operations = g.operations.filter((item) => item.id !== id);
      break;
    }
    case 'up':
    case 'down': {
      const i = g.operations.findIndex((item) => item.id === id);
      const j = button.dataset.edit === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= g.operations.length) return;
      [g.operations[i], g.operations[j]] = [g.operations[j], g.operations[i]];
      break;
    }
    case 'drawOp': if (op) startStageDrawing('op', op.id); return;
    case 'useRoi': {
      const step = op && stepById(op.verify[0]);
      if (!step) return;
      op.target = { ...step.roi };
      break;
    }
    case 'addBin': {
      const n = g.bins.length;
      g.bins.push({ id: arId('b'), name: `Bin ${String.fromCharCode(65 + (n % 26))}`, part: 'Part number', roi: { x: Math.min(0.85, 0.02 + n * 0.26), y: 1.1, w: 0.18, h: 0.2 } });
      break;
    }
    case 'removeBin': {
      const bin = binById(id);
      if (!bin || !window.confirm(`Remove ${bin.name}? Operations that pick from it will no longer light a bin.`)) return;
      g.bins = g.bins.filter((item) => item.id !== id);
      g.operations.forEach((item) => { if (item.binId === id) item.binId = ''; });
      break;
    }
    case 'drawBin': startStageDrawing('bin', id); return;
    default: return;
  }
  guideChanged();
});

ge.editor.addEventListener('change', (event) => {
  if (!canEdit()) return;
  const el = event.target;
  const g = guide();
  const op = opById(gd.selectedOp);
  if (el.dataset.opField && op) {
    const key = el.dataset.opField;
    if (key === 'stdTime') op.stdTime = Math.max(0, Math.round(Number(el.value) || 0));
    else if (key === 'title') op.title = el.value.trim() || op.title;
    else op[key] = key === 'instruction' ? el.value.trim() : el.value;
  } else if (el.dataset.target && op) {
    const value = Number(el.value);
    if (!Number.isFinite(value)) return;
    op.target = { ...(op.target || { x: 0, y: 0, w: 0.1, h: 0.1 }), [el.dataset.target]: Number(value.toFixed(4)) };
  } else if (el.dataset.verify && op) {
    const id = el.dataset.verify;
    op.verify = el.checked ? pgm.program.steps.map((s) => s.id).filter((sid) => sid === id || op.verify.includes(sid)) : op.verify.filter((sid) => sid !== id);
  } else if (el.dataset.binField) {
    const bin = binById(el.dataset.bin);
    if (!bin) return;
    bin[el.dataset.binField] = el.value.trim() || bin[el.dataset.binField];
  } else if (el.dataset.rework) {
    const text = el.value.trim();
    if (text) g.rework[el.dataset.rework] = text; else delete g.rework[el.dataset.rework];
  } else if (el.dataset.guideField === 'finalInspection') {
    g.finalInspection = el.checked;
  } else {
    return;
  }
  guideChanged();
});

ge.operator.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ar]');
  if (!button) return;
  switch (button.dataset.ar) {
    case 'start': startAssembly(); break;
    case 'done': pressDone(); break;
    case 'back': previousItem(); break;
    case 'stop': stopRun(); showToast('Guided assembly stopped.'); break;
    case 'retry': if (gd.run) finishUnit(gd.run); break;
    case 'rework': if (gd.lastInspection) startRework(gd.lastInspection.results); break;
    case 'cancelCalibration': gd.calibrating = false; pushScene(); renderOperator(); break;
    default: break;
  }
});

ge.stats.addEventListener('click', (event) => {
  if (event.target.closest('[data-ar="resetStats"]') && window.confirm('Reset guided-assembly statistics for this product?')) {
    const all = loadStats();
    delete all[pgm.program.product];
    try { localStorage.setItem(GUIDE_STATS_KEY, JSON.stringify(all)); } catch { /* session only */ }
    renderStats();
  }
});

ge.openProjector.addEventListener('click', () => { openProjector(); });
ge.calibrate.addEventListener('click', startCalibration);
ge.projectResults.addEventListener('change', () => {
  gd.projectResults = ge.projectResults.checked;
  try { localStorage.setItem(GUIDE_PREFS_KEY, JSON.stringify({ projectResults: gd.projectResults })); } catch { /* session only */ }
  pushScene();
});

// Every recorded inspection (Live inspection, Run inspection, or the guide's final check).
document.addEventListener('visionforge:inspection', (event) => {
  const { overall, results, record, partial, partId } = event.detail;
  if (!record || partial || !gd.ready) return;
  if (gd.run) return; // the guided run handles its own final inspection
  gd.lastInspection = { overall, results, partId, at: Date.now() };
  renderOperator();
  pushScene();
});

auth.onChange(() => {
  if (!gd.ready) return;
  if (!auth.user) { gd.run = null; gd.calibrating = false; gd.lastInspection = null; stopStageDrawing(); }
  renderGuide();
});

function initGuide() {
  try { gd.projectResults = JSON.parse(localStorage.getItem(GUIDE_PREFS_KEY) || '{}').projectResults !== false; } catch { /* default on */ }
  ge.projectResults.checked = gd.projectResults;
  gd.ready = true;
  renderGuide();
  window.setInterval(() => {
    autoCheck();
    renderTimer();
    renderProjectorState();
    // Keep the projector current (timers, expired result projection, a reopened window).
    if (projectorConnected() || gd.projector.win) pushScene();
  }, AR_TICK_MS);
  if (!ge.view.hidden) onGuideShown();
}
