/*
 * Camera sources beyond this device's own cameras.
 *
 * Smart and industrial cameras (Cognex In-Sight, Hikvision / HIKROBOT, Keyence, IP cameras,
 * phone IP-webcam apps) are reached through the VisionForge camera gateway (camera-gateway/),
 * a small service on the station PC that exposes them all through one HTTP API. The page asks
 * it for frames: continuously for the live view, and a fresh (optionally triggered) frame for
 * every inspection.
 */

const GATEWAY_KEY = 'visionforge.gateway.v1';

const gw = {
  switchButtons: document.querySelectorAll('[data-camera-source]'),
  devicePanel: document.querySelector('#deviceSource'),
  gatewayPanel: document.querySelector('#gatewaySource'),
  url: document.querySelector('#gatewayUrl'),
  check: document.querySelector('#checkGatewayButton'),
  camera: document.querySelector('#gatewayCamera'),
  trigger: document.querySelector('#gatewayTrigger'),
  interval: document.querySelector('#gatewayInterval'),
  help: document.querySelector('#gatewayHelp'),
  preview: document.querySelector('#gatewayPreview'),
  feed: document.querySelector('#gatewayFeed'),
};

let cameraSourceMode = 'device';
let gatewayCameras = [];

function loadGatewaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(GATEWAY_KEY) || 'null');
    if (saved?.url) gw.url.value = saved.url;
    if (saved?.interval !== undefined) gw.interval.value = String(saved.interval);
    if (saved?.trigger !== undefined) gw.trigger.checked = saved.trigger;
    if (saved?.mode) setCameraSourceMode(saved.mode);
  } catch { /* defaults */ }
}

function saveGatewaySettings() {
  try {
    localStorage.setItem(GATEWAY_KEY, JSON.stringify({ url: gatewayBase(), interval: Number(gw.interval.value), trigger: gw.trigger.checked, mode: cameraSourceMode }));
  } catch { /* session only */ }
}

function setCameraSourceMode(mode) {
  cameraSourceMode = mode;
  gw.switchButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cameraSource === mode)));
  gw.devicePanel.hidden = mode !== 'device';
  gw.gatewayPanel.hidden = mode !== 'gateway';
  // One preview at a time: the webcam video in device mode, the camera image in gateway mode.
  els.cameraSetupPreview.hidden = mode === 'gateway';
  gw.preview.hidden = mode !== 'gateway' || !state.gateway;
  els.refreshCameras.textContent = mode === 'gateway' ? 'Check gateway' : 'Refresh list';
  document.querySelector('#cameraDialogTitle').textContent = mode === 'gateway' ? 'Connect a smart or IP camera' : 'Configure camera';
}

const gatewayBase = () => gw.url.value.trim().replace(/\/+$/, '');

async function gatewayFetch(path) {
  let response;
  try {
    response = await fetch(`${gatewayBase()}${path}`, { cache: 'no-store' });
  } catch {
    throw new Error(`Cannot reach the camera gateway at ${gatewayBase()}. Start it on this PC (node gateway.js), check the address, and allow local network access if the browser asks.`);
  }
  if (!response.ok) {
    let message = `Gateway returned HTTP ${response.status}`;
    try { message = (await response.json()).error || message; } catch { /* keep status */ }
    throw new Error(message);
  }
  return response;
}

async function checkGateway() {
  gw.help.classList.remove('error');
  gw.help.textContent = 'Checking the gateway…';
  try {
    const health = await (await gatewayFetch('/api/health')).json();
    gatewayCameras = await (await gatewayFetch('/api/cameras')).json();
    const selected = gw.camera.value;
    gw.camera.replaceChildren(...(gatewayCameras.length
      ? gatewayCameras.map((c) => new Option(`${c.name}${c.vendor ? ` · ${c.vendor}` : ''} (${c.type})`, c.id))
      : [new Option('No cameras configured in cameras.json', '')]));
    if (gatewayCameras.some((c) => c.id === selected)) gw.camera.value = selected;
    gw.help.textContent = `Gateway ${health.version} is running with ${health.cameras} camera${health.cameras === 1 ? '' : 's'}. Select one and choose Connect camera.`;
    saveGatewaySettings();
    updateTriggerOption();
    return true;
  } catch (error) {
    gw.help.textContent = error.message;
    gw.help.classList.add('error');
    return false;
  }
}

function updateTriggerOption() {
  const camera = gatewayCameras.find((c) => c.id === gw.camera.value);
  gw.trigger.disabled = !camera?.canTrigger;
  gw.trigger.closest('label').classList.toggle('muted', !camera?.canTrigger);
}

// Fetches one frame; `trigger` asks trigger-capable cameras (Cognex Native Mode) to acquire first.
async function fetchGatewayFrame(trigger = false) {
  const g = state.gateway;
  const response = await gatewayFetch(`/api/cameras/${encodeURIComponent(g.camera.id)}/frame${trigger ? '?trigger=1' : ''}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  if (g.objectUrl) URL.revokeObjectURL(g.objectUrl);
  g.objectUrl = url;
  g.image = image;
  g.frameSource = response.headers.get('X-Frame-Source') || g.camera.type;
  g.frameTime = response.headers.get('X-Frame-Time');
  gw.feed.src = url;
  gw.preview.src = url;
  els.cameraFormat.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  els.cameraResolution.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  return image;
}

// Serialises frame requests so the live view never overlaps an inspection's triggered frame.
function gatewayFrame(trigger = false) {
  const g = state.gateway;
  const next = (g.pending || Promise.resolve()).catch(() => {}).then(() => fetchGatewayFrame(trigger));
  g.pending = next;
  return next;
}

// Used by the inspection engine for each inspection: always a fresh frame, triggered when set.
async function gatewayFrameForInspection() {
  const g = state.gateway;
  return gatewayFrame(g.trigger && g.camera.canTrigger);
}

function scheduleLiveView() {
  const g = state.gateway;
  if (!g) return;
  window.clearTimeout(g.timer);
  if (!g.interval) return;
  g.timer = window.setTimeout(async () => {
    if (state.gateway !== g) return;
    try {
      await gatewayFrame(false);
      if (g.failures) { g.failures = 0; els.cameraMode.textContent = 'LIVE VIEW'; }
    } catch (error) {
      g.failures = (g.failures || 0) + 1;
      els.cameraMode.textContent = 'NO FRAME';
      if (g.failures === 1) showToast(`Camera gateway: ${error.message}`, 'error');
    }
    scheduleLiveView();
  }, g.interval);
}

async function connectGateway() {
  if (!auth.can('ConfigureCamera')) { showToast('Requires the ConfigureCamera permission.', 'error'); return; }
  if (!gatewayCameras.length && !(await checkGateway())) return;
  const camera = gatewayCameras.find((c) => c.id === gw.camera.value);
  if (!camera) { showToast('Select a camera from the gateway first.', 'error'); return; }
  els.connectCamera.disabled = true;
  els.connectCamera.textContent = 'Connecting…';
  stopCamera({ quiet: true });
  state.gateway = { camera, trigger: gw.trigger.checked, interval: Number(gw.interval.value) };
  try {
    const image = await gatewayFrame(false);
    gw.feed.hidden = false;
    gw.preview.hidden = false;
    els.cameraPreview.classList.add('has-preview');
    els.capturedFrame.hidden = true;
    const label = (camera.vendor || camera.name).toUpperCase().slice(0, 18);
    setCameraState({ connected: true, label, format: `${image.naturalWidth} × ${image.naturalHeight}`, detail: state.gateway.interval ? 'LIVE VIEW' : 'IMAGE ON INSPECT', source: 'CAMERA GATEWAY' });
    els.cameraFrame.classList.remove('mirrored');
    saveGatewaySettings();
    scheduleLiveView();
    const how = state.gateway.trigger && camera.canTrigger ? 'Each Inspect triggers the camera and reads its image.' : 'Each Inspect reads the camera’s latest image.';
    showToast(`Connected to ${camera.name}. ${how}`);
    auth.audit('ConfigureCamera', 'Camera source', 'this device', `${camera.name} via gateway`, 'Connected');
  } catch (error) {
    state.gateway = null;
    gw.help.textContent = error.message;
    gw.help.classList.add('error');
    showToast(error.message, 'error');
  } finally {
    els.connectCamera.disabled = false;
    els.connectCamera.textContent = 'Connect camera';
  }
}

function stopGateway() {
  const g = state.gateway;
  if (!g) return;
  window.clearTimeout(g.timer);
  if (g.objectUrl) URL.revokeObjectURL(g.objectUrl);
  state.gateway = null;
  gw.feed.hidden = true;
  gw.feed.removeAttribute('src');
  gw.preview.hidden = true;
  gw.preview.removeAttribute('src');
  applyMirror();
}

gw.switchButtons.forEach((button) => button.addEventListener('click', () => {
  setCameraSourceMode(button.dataset.cameraSource);
  saveGatewaySettings();
  if (cameraSourceMode === 'gateway' && !gatewayCameras.length) checkGateway();
}));
gw.check.addEventListener('click', checkGateway);
gw.camera.addEventListener('change', updateTriggerOption);
gw.interval.addEventListener('change', () => {
  saveGatewaySettings();
  if (state.gateway) { state.gateway.interval = Number(gw.interval.value); els.cameraMode.textContent = state.gateway.interval ? 'LIVE VIEW' : 'IMAGE ON INSPECT'; scheduleLiveView(); }
});
gw.trigger.addEventListener('change', () => { saveGatewaySettings(); if (state.gateway) state.gateway.trigger = gw.trigger.checked; });
loadGatewaySettings();
