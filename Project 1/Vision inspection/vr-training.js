/*
 * VR training: a virtual copy of the assembly workstation for practising the recipe's work
 * instructions before working on the line. Runs in a WebXR headset (Meta Quest, Pico, Vision
 * Pro, …) and on a normal screen with the mouse.
 *
 * The station is built from the approved recipe the console stores in this browser: its
 * operations, pick bins, targets, standard times and rework texts (program.guide). Trainees
 * pick parts from bins, place them in the marked area and hold tool steps, with the same
 * projected highlights as the AR work guide (Guided mode) or without them (Assessment).
 * Wrong bins, wrong positions and skipped picks are counted, and every session is saved as a
 * training record that the console's AR work guide view lists.
 */

import * as THREE from 'three';

const PROGRAM_KEY = 'visionforge.program.v1';
const AUTH_KEY = 'visionforge.auth.v1';
const SESSION_KEY = 'visionforge.session.v1';
const TRAINING_KEY = 'visionforge.training.v1';
const HOLD_MS = 1500;
const REWORK_HOLD_MS = 2000;
const ROLE_LABELS = { operator: 'Operator', quality: 'Quality engineer', production: 'Production engineer', admin: 'Administrator' };
// Fixture plate on the bench, in metres: the camera view (0–1 × 0–1) maps onto it.
const PLATE = { x: 0, y: 0.909, z: -0.5, w: 0.56, d: 0.28 };
const SHELF = { y: 1.19, z: -0.8, w: 0.9 };
const PART_COLORS = [0xa9b4ba, 0xd8a440, 0x5fb3a6, 0xf2f2ee, 0x8f7fd1, 0xe07a5f];
const TONES = { target: 0x38e1ff, pick: 0xffc23d, pass: 0x3dff8a, fail: 0xff4545 };

const $ = (selector) => document.querySelector(selector);
const ui = {
  meta: $('#vrMeta'), mode: $('#vrMode'), rework: $('#vrRework'), start: $('#vrStart'), enter: $('#vrEnter'),
  status: $('#vrStatus'), results: $('#vrResults'), blocker: $('#vrBlocker'), hint: $('#vrHint'),
};
const loadJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/* ---------- Trainee and recipe ---------- */

// The trainee is whoever is signed in to the console in this browser (same session rules).
function currentUser() {
  const store = loadJson(AUTH_KEY);
  const session = loadJson(SESSION_KEY);
  const user = store?.users?.find((u) => u.id === session?.userId && u.active);
  const timeout = (store?.settings?.sessionTimeoutMin || 30) * 60000;
  return user && Date.now() - session.lastActive < timeout ? user : null;
}

const user = currentUser();
const program = loadJson(PROGRAM_KEY)?.program || null;
const guide = program?.guide || null;
const operations = guide?.operations || [];
const bins = guide?.bins || [];
const binById = (id) => bins.find((bin) => bin.id === id);

function block(title, text) {
  $('#blockerTitle').textContent = title;
  $('#blockerText').textContent = text;
  ui.blocker.hidden = false;
  ui.start.disabled = true;
}

if (!user) block('Sign in first', 'Sign in to the VisionForge console in this browser, then reopen VR training. Training records are kept under your name.');
else if (!operations.length) block('No work instructions', 'The approved recipe in this browser has no AR work instructions. Open the console, add operations in AR work guide, and save the recipe.');
ui.meta.textContent = user
  ? `${program?.product || '—'} · Recipe v${program?.version || '—'} · ${operations.length} operations · Trainee ${user.name} (${ROLE_LABELS[user.role] || user.role})`
  : 'Not signed in';

/* ---------- Scene: the workstation ---------- */

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26292d);
// Desktop view: standing at the bench, seeing the fixture, the bins and the monitor.
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 40);
camera.position.set(0, 1.72, 0.6);
camera.lookAt(0, 1.12, -0.62);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a40, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1.2, 3, 1.5);
scene.add(sun);

const mat = {
  alu: new THREE.MeshStandardMaterial({ color: 0xc8cdd1, metalness: 0.55, roughness: 0.35 }),
  top: new THREE.MeshStandardMaterial({ color: 0xf3f3f1, roughness: 0.7 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d969b, metalness: 0.7, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.6 }),
  device: new THREE.MeshStandardMaterial({ color: 0xe9ecee, roughness: 0.5 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xb9333a, roughness: 0.9 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.95 }),
};

function box(w, h, d, material, x, y, z, parent = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function textTexture(text, { width = 256, height = 64, color = '#ffffff', bg = 'rgba(0,0,0,0)', font = '600 34px "IBM Plex Mono", monospace' } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Room
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat.floor);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
box(6, 3, 0.05, mat.wall, 0, 1.5, -1.35);

// Workbench: aluminium profile frame with a white top (as at the real station)
const benchTop = box(1.2, 0.04, 0.7, mat.top, 0, 0.88, -0.55);
benchTop.userData = { kind: 'surface' };
[[-0.57, -0.23], [0.57, -0.23], [-0.57, -0.87], [0.57, -0.87]].forEach(([x, z]) => box(0.04, 0.86, 0.04, mat.alu, x, 0.43, z));
box(1.18, 0.04, 0.04, mat.alu, 0, 0.12, -0.23); box(1.18, 0.04, 0.04, mat.alu, 0, 0.12, -0.87);
[-0.57, 0.57].forEach((x) => box(0.04, 1.12, 0.04, mat.alu, x, 1.46, -0.87));
box(1.18, 0.05, 0.05, mat.alu, 0, 2.04, -0.87);
[-0.57, 0.57].forEach((x) => box(0.04, 0.04, 0.5, mat.alu, x, 2.0, -0.64));
box(1.18, 0.04, 0.04, mat.alu, 0, 2.0, -0.4);
box(SHELF.w + 0.26, 0.02, 0.2, mat.alu, 0, SHELF.y - 0.01, SHELF.z);
box(1.18, 0.03, 0.03, mat.alu, 0, 1.36, -0.87);

// Fixture plate, overhead projector + camera, monitor, torque controller, screwdriver
const plate = box(PLATE.w + 0.08, 0.008, PLATE.d + 0.07, mat.steel, PLATE.x, PLATE.y - 0.005, PLATE.z);
plate.userData = { kind: 'surface' };
box(0.3, 0.16, 0.2, mat.device, 0, 2.13, -0.62);
box(0.08, 0.06, 0.08, mat.dark, 0, 1.95, -0.55);
const cone = new THREE.Mesh(
  new THREE.ConeGeometry(0.42, 1.0, 4, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.018, side: THREE.DoubleSide, depthWrite: false }),
);
cone.position.set(0, 1.46, -0.55);
cone.rotation.y = Math.PI / 4;
scene.add(cone);

const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024;
hudCanvas.height = 600;
const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;
box(0.6, 0.37, 0.03, mat.dark, 0, 1.58, -0.85);
const monitor = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.334), new THREE.MeshBasicMaterial({ map: hudTexture }));
monitor.position.set(0, 1.58, -0.834);
monitor.userData = { kind: 'monitor' };
scene.add(monitor);

box(0.15, 0.21, 0.08, mat.dark, 0.44, 1.56, -0.83);
const torqueScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), new THREE.MeshBasicMaterial({ map: textTexture('0.010 Nm', { width: 256, height: 160, color: '#0d2b12', bg: '#7fe08a', font: '700 44px "IBM Plex Mono", monospace' }) }));
torqueScreen.position.set(0.44, 1.6, -0.789);
scene.add(torqueScreen);
const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.22, 16), mat.dark);
driver.rotation.z = Math.PI / 2.4;
driver.position.set(0.45, 0.93, -0.36);
scene.add(driver);

// Pick bins on the shelf, ordered like the recipe's bins across the bench
const binMeshes = new Map();
const binMaterial = () => new THREE.MeshStandardMaterial({ color: 0x1f5fd6, roughness: 0.45, emissive: 0x000000 });
bins.forEach((bin) => {
  const cu = bin.roi.x + bin.roi.w / 2;
  const x = Math.max(-0.5, Math.min(0.5, (cu - 0.5) * SHELF.w));
  const mesh = box(0.17, 0.09, 0.15, binMaterial(), x, SHELF.y + 0.045, SHELF.z);
  mesh.userData = { kind: 'bin', id: bin.id };
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.045), new THREE.MeshBasicMaterial({ map: textTexture(bin.name, { color: '#0b1a33', bg: '#ffffff' }), transparent: true }));
  label.position.set(x, SHELF.y + 0.05, SHELF.z + 0.077);
  scene.add(label);
  // A few parts in each bin
  for (let i = 0; i < 3; i += 1) box(0.04, 0.02, 0.04, new THREE.MeshStandardMaterial({ color: partColor(bin.id) }), x - 0.04 + i * 0.04, SHELF.y + 0.08, SHELF.z - 0.01);
  binMeshes.set(bin.id, mesh);
});

function partColor(binId) {
  const index = bins.findIndex((bin) => bin.id === binId);
  return PART_COLORS[(index < 0 ? 0 : index) % PART_COLORS.length];
}

/* ---------- Plate coordinates and highlights ---------- */

const roiCenter = (roi) => new THREE.Vector3(PLATE.x + (roi.x + roi.w / 2 - 0.5) * PLATE.w, PLATE.y, PLATE.z + (roi.y + roi.h / 2 - 0.5) * PLATE.d);
const toUv = (point) => ({ u: (point.x - PLATE.x) / PLATE.w + 0.5, v: (point.z - PLATE.z) / PLATE.d + 0.5 });

// Within the region, with a small tolerance (a real placement is never pixel-exact).
function inRoi({ u, v }, roi) {
  const tu = Math.max(0.03, roi.w * 0.15);
  const tv = Math.max(0.05, roi.h * 0.15);
  return u >= roi.x - tu && u <= roi.x + roi.w + tu && v >= roi.y - tv && v <= roi.y + roi.h + tv;
}

const highlightGroup = new THREE.Group();
const placedGroup = new THREE.Group();
scene.add(highlightGroup, placedGroup);

function highlight(roi, shape, tone, pulse = true) {
  const color = TONES[tone];
  const w = roi.w * PLATE.w;
  const d = roi.h * PLATE.d;
  const fill = new THREE.Mesh(
    shape === 'circle' ? new THREE.CircleGeometry(0.5, 40) : new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }),
  );
  // Drawn on top of placed parts like projected light, but at plate level so pointing at it is exact.
  fill.renderOrder = 5;
  fill.scale.set(w, d, 1);
  fill.rotation.x = -Math.PI / 2;
  const center = roiCenter(roi);
  fill.position.set(center.x, PLATE.y + 0.002, center.z);
  fill.userData.pulse = pulse;
  highlightGroup.add(fill);
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(shape === 'circle'
      ? Array.from({ length: 40 }, (_, i) => new THREE.Vector3(Math.cos((i / 40) * Math.PI * 2) * 0.5, Math.sin((i / 40) * Math.PI * 2) * 0.5, 0))
      : [new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)]),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
  edge.renderOrder = 6;
  edge.scale.copy(fill.scale);
  edge.rotation.copy(fill.rotation);
  edge.position.copy(fill.position);
  edge.position.y += 0.001;
  highlightGroup.add(edge);
}

function lightBin(id, tone) {
  binMeshes.forEach((mesh, binId) => mesh.material.emissive.setHex(binId === id && tone ? TONES[tone] : 0x000000));
  binMeshes.forEach((mesh) => { mesh.material.emissiveIntensity = 0.55; });
}

function placedPart(op) {
  const roi = op.target;
  const w = roi.w * PLATE.w;
  const d = roi.h * PLATE.d;
  const material = new THREE.MeshStandardMaterial({ color: partColor(op.binId), metalness: 0.3, roughness: 0.5 });
  const mesh = op.shape === 'circle'
    ? new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, 0.022, 32), material)
    : new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, d), material);
  const center = roiCenter(roi);
  // Later parts stack on top of earlier ones (a bushing sits on the base plate).
  mesh.position.set(center.x, PLATE.y + 0.007 + placedGroup.children.length * 0.004, center.z);
  mesh.userData = { kind: 'surface' };
  return mesh;
}

/* ---------- Pointers: mouse and XR controllers ---------- */

const raycaster = new THREE.Raycaster();
const interactables = [plate, benchTop, monitor, ...binMeshes.values()];
const mouse = { ndc: new THREE.Vector2(), inside: false };
const tempMatrix = new THREE.Matrix4();
const platePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLATE.y);

function hitFrom(source) {
  if (source === 'mouse') {
    if (!mouse.inside) return null;
    raycaster.setFromCamera(mouse.ndc, camera);
  } else {
    tempMatrix.identity().extractRotation(source.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(source.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  }
  const hit = raycaster.intersectObjects([...interactables, ...placedGroup.children], false)[0] || null;
  // Highlights are drawn at plate level on top of everything, so judge positions where the
  // pointer meets the plate plane, not on top of a part already placed.
  if (hit?.object.userData.kind === 'surface') {
    const onPlate = raycaster.ray.intersectPlane(platePlane, new THREE.Vector3());
    if (onPlate) hit.point = onPlate;
  }
  return hit;
}

const controllers = [0, 1].map((i) => {
  const controller = renderer.xr.getController(i);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x9fe8ff }));
  ray.name = 'ray';
  ray.scale.z = 1.5;
  controller.add(ray);
  controller.addEventListener('connected', (event) => { controller.userData.inputSource = event.data; });
  controller.addEventListener('disconnected', () => { controller.userData.inputSource = null; });
  controller.addEventListener('selectstart', () => selectStart(controller));
  controller.addEventListener('selectend', () => selectEnd(controller));
  scene.add(controller);
  return controller;
});

function haptic(source, intensity, ms) {
  if (source === 'mouse') return;
  try { source.userData.inputSource?.gamepad?.hapticActuators?.[0]?.pulse(intensity, ms); } catch { /* no haptics */ }
}

function updateMouse(event) {
  const r = canvas.getBoundingClientRect();
  mouse.ndc.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
  mouse.inside = true;
}
canvas.addEventListener('pointermove', updateMouse);
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('pointerdown', (event) => {
  if (renderer.xr.isPresenting || event.button !== 0) return;
  updateMouse(event);
  selectStart('mouse');
});
window.addEventListener('pointerup', () => { if (!renderer.xr.isPresenting) selectEnd('mouse'); });

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.01, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
reticle.rotation.x = -Math.PI / 2;
reticle.renderOrder = 10;
scene.add(reticle);
const holdRing = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.028, 40, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0x3dff8a, depthTest: false, side: THREE.DoubleSide }));
holdRing.rotation.x = -Math.PI / 2;
holdRing.renderOrder = 11;
holdRing.visible = false;
scene.add(holdRing);

/* ---------- Training session ---------- */

const tr = {
  running: false, finished: false, mode: 'guided', reworkScenario: true,
  index: 0, phase: 'idle', held: null, heldBy: null, hold: null,
  unitStart: 0, opStart: 0, errors: 0, ops: [], rework: null,
  message: 'Start training to begin.', tone: '', flashUntil: 0, flashBin: null,
};

const currentOp = () => operations[tr.index];

let audio = null;
function beep(ok) {
  try {
    audio ||= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = ok ? 'sine' : 'square';
    osc.frequency.value = ok ? 880 : 200;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.3));
  } catch { /* no audio */ }
}

function say(message, tone = '') {
  tr.message = message;
  tr.tone = tone;
  ui.status.className = `panel status ${tone}`;
  const title = !tr.running ? (tr.finished ? 'Training complete' : 'Ready')
    : tr.phase === 'rework' ? 'Rework · simulated inspection FAIL'
      : `${tr.index + 1}/${operations.length} · ${currentOp()?.title || ''}`;
  ui.status.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
  drawHud();
}

function mistake(message, source, binId = null) {
  tr.errors += 1;
  if (tr.phase !== 'rework' && tr.ops[tr.index]) tr.ops[tr.index].errors += 1;
  tr.flashUntil = performance.now() + 700;
  tr.flashBin = binId;
  beep(false);
  haptic(source, 1, 250);
  say(message, 'error');
}

function startTraining() {
  if (!user || !operations.length) return;
  placedGroup.clear();
  dropHeld();
  Object.assign(tr, {
    running: true, finished: false, mode: ui.mode.value, reworkScenario: ui.rework.checked,
    index: 0, hold: null, unitStart: performance.now(), errors: 0, rework: null,
    ops: operations.map((op) => ({ id: op.id, title: op.title, std: op.stdTime || 0, ms: 0, errors: 0 })),
  });
  ui.results.hidden = true;
  ui.start.textContent = 'Restart';
  document.body.classList.add('training');
  enterOp(0);
}

function enterOp(index) {
  tr.index = index;
  tr.opStart = performance.now();
  const op = currentOp();
  tr.phase = op.binId && binById(op.binId) ? 'pick' : 'hold';
  showGuidance();
  const bin = binById(op.binId);
  say(tr.phase === 'pick' ? `${op.instruction || op.title} Pick from ${bin.name} (${bin.part}).` : `${op.instruction || op.title} Hold on the area until the ring is complete.`);
}

// Guided mode shows the projector's highlights; Assessment leaves the trainee to remember them.
function showGuidance() {
  highlightGroup.clear();
  lightBin(null);
  if (!tr.running) return;
  if (tr.phase === 'rework') {
    highlight(tr.rework.roi, 'box', 'fail');
    return;
  }
  if (tr.mode !== 'guided') return;
  const op = currentOp();
  if (tr.phase === 'pick') lightBin(op.binId, 'pick');
  if (op.target) highlight(op.target, op.shape, 'target');
}

function grab(source) {
  const op = currentOp();
  const part = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), new THREE.MeshStandardMaterial({ color: partColor(op.binId) }));
  tr.held = part;
  tr.heldBy = source;
  if (source === 'mouse') scene.add(part);
  else { part.position.set(0, 0, -0.06); source.add(part); }
}

function dropHeld() {
  tr.held?.removeFromParent();
  tr.held = null;
  tr.heldBy = null;
}

function completeOp(source) {
  const op = currentOp();
  tr.ops[tr.index].ms = performance.now() - tr.opStart;
  if (op.target) placedGroup.add(placedPart(op));
  dropHeld();
  tr.hold = null;
  beep(true);
  haptic(source, 0.5, 80);
  highlightGroup.clear();
  if (op.target) highlight(op.target, op.shape, 'pass', false);
  lightBin(null);
  say('Done.', 'good');
  const next = tr.index + 1;
  window.setTimeout(() => {
    if (!tr.running || tr.index !== next - 1) return;
    if (next < operations.length) enterOp(next);
    else if (tr.reworkScenario) startRework();
    else finish();
  }, 650);
}

// A simulated final inspection fails on one step; the trainee follows its rework guidance.
function startRework() {
  const steps = (program.steps || []).filter((step) => step.enabled && step.roi && !(step.tool === 'pattern' && step.params?.locator === 'yes'));
  const withText = steps.filter((step) => guide.rework?.[step.id]);
  const pool = withText.length ? withText : steps;
  if (!pool.length) { finish(); return; }
  const step = pool[Math.floor(Math.random() * pool.length)];
  tr.rework = { stepId: step.id, name: step.name, roi: step.roi, text: guide.rework?.[step.id] || 'Correct the marked area.', start: performance.now() };
  tr.phase = 'rework';
  const defect = new THREE.Mesh(new THREE.CircleGeometry(0.012, 20), new THREE.MeshBasicMaterial({ color: 0x2a1c18 }));
  defect.rotation.x = -Math.PI / 2;
  const center = roiCenter(step.roi);
  defect.position.set(center.x, PLATE.y + 0.03, center.z);
  defect.userData = { kind: 'surface' };
  defect.name = 'defect';
  placedGroup.add(defect);
  showGuidance();
  beep(false);
  say(`Final inspection FAIL: ${step.name}. ${tr.rework.text} Hold on the marked area to rework it.`, 'error');
}

function finish() {
  const totalMs = performance.now() - tr.unitStart;
  const stdMs = tr.ops.reduce((sum, op) => sum + op.std * 1000, 0);
  const overTime = stdMs > 0 && totalMs > stdMs * 1.5;
  const passed = tr.mode === 'guided' ? true : tr.errors === 0 && !overTime;
  tr.running = false;
  tr.finished = true;
  document.body.classList.remove('training');
  tr.phase = 'idle';
  highlightGroup.clear();
  lightBin(null);
  const record = {
    id: `t${Date.now().toString(36)}`, at: new Date().toISOString(), user: user.name, userId: user.id, role: user.role,
    product: program.product, version: program.version, mode: tr.mode, rework: tr.rework ? { step: tr.rework.name, ms: Math.round(tr.rework.ms || performance.now() - tr.rework.start) } : null,
    totalMs: Math.round(totalMs), stdMs, errors: tr.errors, passed,
    ops: tr.ops.map((op) => ({ title: op.title, ms: Math.round(op.ms), std: op.std, errors: op.errors })),
  };
  try {
    const records = loadJson(TRAINING_KEY) || [];
    records.push(record);
    localStorage.setItem(TRAINING_KEY, JSON.stringify(records.slice(-200)));
  } catch { /* storage unavailable: shown here only */ }
  tr.record = record;
  beep(passed);
  say(passed ? `${tr.mode === 'guided' ? 'Guided run complete' : 'Assessment passed'} in ${secs(totalMs)} with ${tr.errors} error${tr.errors === 1 ? '' : 's'}.` : `Assessment not passed: ${tr.errors} error${tr.errors === 1 ? '' : 's'}${overTime ? ', over 1.5× the standard time' : ''}.`, passed ? 'good' : 'error');
  showResults(record);
}

function showResults(record) {
  const verdict = record.mode === 'guided' ? 'GUIDED RUN COMPLETE' : record.passed ? 'ASSESSMENT PASSED' : 'ASSESSMENT NOT PASSED';
  ui.results.innerHTML = `
    <h2>${esc(record.user)} · ${esc(record.product)} v${esc(record.version)}</h2>
    <p class="verdict ${record.passed ? 'pass' : 'fail'}">${verdict}</p>
    <table><thead><tr><th>OPERATION</th><th>TIME</th><th>STD</th><th>ERRORS</th></tr></thead><tbody>
    ${record.ops.map((op) => `<tr><td>${esc(op.title)}</td><td class="${op.std && op.ms > op.std * 1000 ? 'over' : ''}">${secs(op.ms)}</td><td>${op.std ? `${op.std} s` : '—'}</td><td class="${op.errors ? 'bad' : ''}">${op.errors}</td></tr>`).join('')}
    ${record.rework ? `<tr><td>Rework · ${esc(record.rework.step)}</td><td>${secs(record.rework.ms)}</td><td>—</td><td>—</td></tr>` : ''}
    <tr><td><strong>Total</strong></td><td>${secs(record.totalMs)}</td><td>${record.stdMs ? secs(record.stdMs) : '—'}</td><td class="${record.errors ? 'bad' : ''}">${record.errors}</td></tr>
    </tbody></table>
    <p class="hint">Saved to the training records in the console (AR work guide). ${record.mode === 'assessment' ? 'Assessment passes with no errors within 1.5× the standard time.' : 'Try Assessment mode when ready.'}</p>
    <div class="row"><button type="button" class="primary" id="againButton">Train again</button></div>`;
  ui.results.hidden = false;
  $('#againButton').addEventListener('click', startTraining);
}

function selectStart(source) {
  if (!tr.running) {
    // In the headset, pulling the trigger starts (or restarts) the session.
    if (source !== 'mouse') startTraining();
    return;
  }
  const hit = hitFrom(source);
  const kind = hit?.object.userData.kind;
  const op = currentOp();
  if (tr.phase === 'pick') {
    if (kind === 'bin') {
      if (hit.object.userData.id === op.binId) {
        grab(source);
        tr.phase = 'place';
        beep(true);
        haptic(source, 0.4, 60);
        say(`Part picked. Place it ${tr.mode === 'guided' ? 'in the highlighted area' : 'where it belongs'}.`);
      } else {
        mistake(`Wrong bin: ${binById(hit.object.userData.id)?.name}. This step needs ${binById(op.binId).name} (${binById(op.binId).part}).`, source, hit.object.userData.id);
      }
    } else if (kind === 'surface' && op.target && inRoi(toUv(hit.point), op.target)) {
      mistake(`Pick the part from ${binById(op.binId).name} first.`, source);
    }
    return;
  }
  if (tr.phase === 'place') {
    if (kind === 'surface') {
      if (!op.target || inRoi(toUv(hit.point), op.target)) completeOp(source);
      else mistake('Wrong position. Place the part in the marked area.', source);
    }
    return;
  }
  // Tool steps and rework: press and hold on the area.
  const roi = tr.phase === 'rework' ? tr.rework.roi : op.target;
  if (kind === 'surface' && (!roi || inRoi(toUv(hit.point), roi))) {
    tr.hold = { source, start: performance.now(), duration: tr.phase === 'rework' ? REWORK_HOLD_MS : HOLD_MS };
    say('Keep holding…');
  } else if (kind === 'surface') {
    mistake('Wrong area for this step.', source);
  } else if (kind === 'bin') {
    mistake('No part is needed for this step.', source, hit.object.userData.id);
  }
}

function selectEnd(source) {
  if (tr.hold && tr.hold.source === source) {
    tr.hold = null;
    holdRing.visible = false;
    say('Released too early. Hold until the ring is complete.');
  }
}

function updateHold(now) {
  if (!tr.hold) { holdRing.visible = false; return; }
  const hit = hitFrom(tr.hold.source);
  const roi = tr.phase === 'rework' ? tr.rework.roi : currentOp()?.target;
  if (hit?.object.userData.kind !== 'surface' || (roi && !inRoi(toUv(hit.point), roi))) {
    tr.hold = null;
    holdRing.visible = false;
    say('Moved off the area. Hold on the marked area until the ring is complete.');
    return;
  }
  const progress = Math.min(1, (now - tr.hold.start) / tr.hold.duration);
  holdRing.visible = true;
  holdRing.geometry.dispose();
  holdRing.geometry = new THREE.RingGeometry(0.02, 0.028, 40, 1, 0, Math.max(0.001, progress * Math.PI * 2));
  holdRing.position.set(hit.point.x, PLATE.y + 0.045, hit.point.z);
  if (progress < 1) return;
  const source = tr.hold.source;
  tr.hold = null;
  holdRing.visible = false;
  if (tr.phase === 'rework') {
    placedGroup.getObjectByName('defect')?.removeFromParent();
    highlightGroup.clear();
    highlight(tr.rework.roi, 'box', 'pass', false);
    tr.rework.ms = performance.now() - tr.rework.start;
    beep(true);
    say('Rework done. Re-inspection: PASS.', 'good');
    window.setTimeout(() => { if (tr.running) finish(); }, 900);
  } else {
    completeOp(source);
  }
}

/* ---------- In-world monitor (instructions, as on the station screen) ---------- */

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  String(text || '').split(/\s+/).forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

let hudDrawn = 0;
function drawHud() {
  hudDrawn = performance.now();
  const ctx = hudCanvas.getContext('2d');
  const W = hudCanvas.width;
  const H = hudCanvas.height;
  ctx.fillStyle = '#101416';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#4cae9f';
  ctx.font = '600 24px "IBM Plex Mono", monospace';
  ctx.fillText(`VISIONFORGE · VR TRAINING · ${tr.mode === 'guided' ? 'GUIDED' : 'ASSESSMENT'}`, 40, 56);
  ctx.fillStyle = '#8b978f';
  ctx.font = '500 22px "IBM Plex Sans", sans-serif';
  ctx.fillText(`${user?.name || 'Not signed in'} · ${program?.product || ''} v${program?.version || ''}`, 40, 92);
  let y = 160;
  const op = currentOp();
  if (tr.running) {
    const title = tr.phase === 'rework' ? `Rework: ${tr.rework.name}` : `${tr.index + 1}/${operations.length}  ${op.title}`;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 46px "IBM Plex Sans", sans-serif';
    ctx.fillText(title, 40, y);
    y += 56;
    ctx.font = '400 30px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#dfe8e6';
    wrapText(ctx, tr.phase === 'rework' ? tr.rework.text : op.instruction, W - 80).slice(0, 3).forEach((line) => { ctx.fillText(line, 40, y); y += 40; });
    if (tr.phase === 'pick' || tr.phase === 'place') {
      const bin = binById(op.binId);
      ctx.fillStyle = '#ffc23d';
      ctx.font = '700 32px "IBM Plex Sans", sans-serif';
      ctx.fillText(tr.phase === 'pick' ? `▶ Pick from ${bin.name} · ${bin.part}` : '▶ Place the part', 40, y + 10);
    }
    const elapsed = (performance.now() - (tr.phase === 'rework' ? tr.rework.start : tr.opStart)) / 1000;
    ctx.fillStyle = op?.stdTime && elapsed > op.stdTime && tr.phase !== 'rework' ? '#ffb020' : '#c1cbc3';
    ctx.font = '600 28px "IBM Plex Mono", monospace';
    ctx.fillText(`${elapsed.toFixed(1)} s${op?.stdTime && tr.phase !== 'rework' ? ` / ${op.stdTime} s` : ''}   ERRORS ${tr.errors}`, 40, H - 110);
    ctx.fillStyle = '#26302f';
    ctx.fillRect(40, H - 80, W - 80, 10);
    ctx.fillStyle = '#4cae9f';
    ctx.fillRect(40, H - 80, (W - 80) * ((tr.phase === 'rework' ? operations.length : tr.index) / operations.length), 10);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 44px "IBM Plex Sans", sans-serif';
    ctx.fillText(tr.finished ? (tr.record?.passed ? 'Training complete' : 'Not passed yet') : 'Ready to train', 40, y);
    y += 56;
    ctx.font = '400 30px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#dfe8e6';
    const text = tr.finished && tr.record
      ? `Time ${secs(tr.record.totalMs)} · ${tr.record.errors} errors. Pull the trigger to train again.`
      : `${operations.length} operations. Pull the trigger (or select Start training) to begin.`;
    wrapText(ctx, text, W - 80).forEach((line) => { ctx.fillText(line, 40, y); y += 40; });
  }
  ctx.fillStyle = tr.tone === 'error' ? '#ff6b5e' : tr.tone === 'good' ? '#3dff8a' : '#9fb8b6';
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  ctx.fillText(wrapText(ctx, tr.message, W - 80)[0] || '', 40, H - 30);
  hudTexture.needsUpdate = true;
}

/* ---------- Render loop ---------- */

function resize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(PLATE.y + 0.03));
renderer.setAnimationLoop((time) => {
  const now = performance.now();
  // Pulsing projected highlights; red flash on a mistake
  highlightGroup.children.forEach((child) => {
    if (child.isMesh && child.userData.pulse) child.material.opacity = 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(time / 240));
  });
  if (tr.flashUntil > now) {
    if (tr.flashBin) binMeshes.get(tr.flashBin)?.material.emissive.setHex(TONES.fail);
    scene.background.setHex(Math.sin(now / 60) > 0 ? 0x3a2224 : 0x26292d);
  } else if (tr.flashUntil) {
    tr.flashUntil = 0;
    scene.background.setHex(0x26292d);
    showGuidance();
  }
  // Pointer feedback: controller rays, reticle, and the part held by the mouse
  let reticleHit = null;
  if (renderer.xr.isPresenting) {
    controllers.forEach((controller) => {
      const hit = hitFrom(controller);
      controller.getObjectByName('ray').scale.z = hit ? hit.distance : 1.5;
      if (hit) reticleHit = hit;
    });
  } else {
    reticleHit = hitFrom('mouse');
    if (tr.held && tr.heldBy === 'mouse' && mouse.inside) {
      const point = new THREE.Vector3();
      raycaster.setFromCamera(mouse.ndc, camera);
      if (raycaster.ray.intersectPlane(planeY, point)) tr.held.position.copy(point);
    }
  }
  reticle.visible = Boolean(reticleHit);
  if (reticleHit) reticle.position.copy(reticleHit.point).add(new THREE.Vector3(0, 0.002, 0));
  updateHold(now);
  if (tr.running && now - hudDrawn > 250) drawHud();
  renderer.render(scene, camera);
});

/* ---------- Controls ---------- */

ui.start.addEventListener('click', startTraining);
ui.mode.addEventListener('change', () => { if (!tr.running) { tr.mode = ui.mode.value; drawHud(); } });

async function setupXr() {
  if (!navigator.xr) { ui.hint.textContent += ' No VR headset browser detected: training runs on this screen.'; return; }
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); } catch { supported = false; }
  if (!supported) { ui.hint.textContent += ' No VR headset detected: training runs on this screen.'; return; }
  ui.enter.hidden = false;
  ui.enter.addEventListener('click', async () => {
    if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await renderer.xr.setSession(session);
      ui.enter.textContent = 'Exit VR';
      session.addEventListener('end', () => { ui.enter.textContent = 'Enter VR'; resize(); });
    } catch (error) {
      ui.hint.textContent = `Could not start VR: ${error.message}`;
    }
  });
}
setupXr();
drawHud();

// Hooks for automated tests: where a bin or region appears on screen.
window.vrTraining = {
  state: tr,
  screenPoint(kind, id) {
    const point = kind === 'bin' ? binMeshes.get(id).position.clone().add(new THREE.Vector3(0, 0.045, 0)) : roiCenter(id);
    point.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((point.x + 1) / 2) * r.width, y: r.top + ((1 - point.y) / 2) * r.height };
  },
};
