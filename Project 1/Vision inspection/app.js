const els = {
  total: document.querySelector('#totalCount'),
  passRate: document.querySelector('#passRate'),
  fail: document.querySelector('#failCount'),
  cycle: document.querySelector('#cycleTime'),
  partId: document.querySelector('#partId'),
  elapsed: document.querySelector('#elapsedTime'),
  table: document.querySelector('#recentTable'),
  runControl: document.querySelector('#runControl'),
  simulate: document.querySelector('#simulateButton'),
  toast: document.querySelector('#toast'),
  cameraFrame: document.querySelector('#cameraFrame'),
  webcam: document.querySelector('#webcamFeed'),
  capturedFrame: document.querySelector('#capturedFrame'),
  cameraStatus: document.querySelector('#cameraStatus'),
  cameraIndicator: document.querySelector('#cameraIndicator'),
  cameraSource: document.querySelector('#cameraSource'),
  cameraFormat: document.querySelector('#cameraFormat'),
  cameraMode: document.querySelector('#cameraMode'),
  openCamera: document.querySelector('#openCameraButton'),
  cameraDialog: document.querySelector('#cameraDialog'),
  closeCamera: document.querySelector('#closeCameraButton'),
  cameraBackdrop: document.querySelector('#cameraDialogBackdrop'),
  cameraSelect: document.querySelector('#cameraSelect'),
  refreshCameras: document.querySelector('#refreshCameraButton'),
  connectCamera: document.querySelector('#connectCameraButton'),
  disconnectCamera: document.querySelector('#disconnectCameraButton'),
  cameraConnectionState: document.querySelector('#cameraConnectionState'),
  cameraResolution: document.querySelector('#cameraResolution'),
  cameraHelp: document.querySelector('#cameraHelp'),
  cameraPreview: document.querySelector('#cameraPreview'),
  cameraSetupPreview: document.querySelector('#cameraSetupPreview'),
  capture: document.querySelector('#captureButton'),
  mirror: document.querySelector('#mirrorToggle'),
  cameraFacing: document.querySelector('#cameraFacing'),
};

let state = { running: true, total: 12450, fails: 240, part: 1248, cameraStream: null, mirror: true, gateway: null };

try { state.mirror = localStorage.getItem('visionforge.mirror') !== 'false'; } catch { /* keep default */ }

// Webcams deliver an un-mirrored image; mirroring makes the view move the same way as the person.
// The same flip is applied to captured frames and analysed images so ROIs match what is shown.
function applyMirror() {
  els.mirror.checked = state.mirror;
  els.cameraFrame.classList.toggle('mirrored', state.mirror);
  els.cameraPreview.classList.toggle('mirrored', state.mirror);
}

function drawCameraFrame(ctx, width, height) {
  ctx.save();
  if (state.mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(els.webcam, 0, 0, width, height);
  ctx.restore();
}

const showToast = (message, type = '') => {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.className = 'toast'; }, 3000);
};

const clock = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const padPart = (number) => `A${String(number).padStart(6, '0')}`;

function refreshMetrics(cycle) {
  const pass = state.total - state.fails;
  const rate = ((pass / state.total) * 100).toFixed(2);
  els.total.textContent = state.total.toLocaleString('en-US');
  els.fail.textContent = state.fails.toLocaleString('en-US');
  els.passRate.innerHTML = `${rate}<sup>%</sup>`;
  els.cycle.innerHTML = `${cycle.toFixed(2)}<sup>s</sup>`;
}

function addPart() {
  if (!state.running) { showToast('Line is paused. Resume production to simulate a part.', 'error'); return; }
  const isPass = Math.random() > 0.16;
  const cycle = 1.25 + Math.random() * .25;
  const id = padPart(++state.part);
  state.total += 1;
  if (!isPass) state.fails += 1;
  els.partId.textContent = id;
  els.elapsed.textContent = `${cycle.toFixed(2)} sec`;
  refreshMetrics(cycle);
  const resultClass = isPass ? 'pass-chip' : 'fail-chip';
  const result = isPass ? 'PASS' : 'FAIL';
  const row = document.createElement('tr');
  row.innerHTML = `<td>${clock()}</td><td><strong>${id}</strong></td><td><span class="result-chip ${resultClass}">● ${result}</span></td><td>v1.2</td><td>${cycle.toFixed(2)}s</td><td><button aria-label="View part ${id}">›</button></td>`;
  els.table.prepend(row);
  if (els.table.children.length > 4) els.table.lastElementChild.remove();
  showToast(`${id}: ${result} · inspection recorded`, isPass ? '' : 'error');
}

function setCameraState({ connected, label = 'SIMULATED', format = '1920 × 1200', detail = 'AWAITING CAMERA', source = 'WEB CAMERA' }) {
  els.cameraFrame.classList.toggle('has-webcam', connected);
  els.cameraStatus.textContent = label;
  els.cameraIndicator.style.color = connected ? '#45d2af' : '#94a8af';
  els.cameraSource.textContent = connected ? source : 'SIMULATION';
  els.cameraFormat.textContent = format;
  els.cameraMode.textContent = detail;
  els.cameraConnectionState.textContent = connected ? 'Connected' : 'Not connected';
  els.cameraResolution.textContent = connected ? format : '—';
}

function stopCamera() {
  if (typeof stopGateway === 'function') stopGateway();
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  els.webcam.srcObject = null;
  els.cameraSetupPreview.srcObject = null;
  els.cameraPreview.classList.remove('has-preview');
  els.capturedFrame.hidden = true;
  els.capturedFrame.removeAttribute('src');
  setCameraState({ connected: false });
}

function resetCameraHelp() {
  els.cameraHelp.classList.remove('error');
  els.cameraHelp.textContent = 'For a stable production setup, use a dedicated USB/industrial camera and lock its focus, lighting, and physical position.';
}

function describeCameraError(error) {
  const name = error?.name || 'UnknownError';
  const messages = {
    NotAllowedError: {
      status: 'Permission required',
      detail: 'Camera permission is blocked. Click the camera/lock icon beside the local app address, allow camera access for this site, then reconnect.',
    },
    NotReadableError: {
      status: 'Camera is busy',
      detail: 'Another application is using the camera. Close Teams, Zoom, Windows Camera, or any other camera app, then reconnect.',
    },
    NotFoundError: {
      status: 'Camera not found',
      detail: 'No usable camera was found. Reconnect the device, then select Refresh list.',
    },
    OverconstrainedError: {
      status: 'Selected camera unavailable',
      detail: 'The selected camera is no longer available under this device ID. Select Refresh list, choose the camera again, and reconnect.',
    },
    SecurityError: {
      status: 'Secure context required',
      detail: 'Open the local app at http://127.0.0.1:4173 or http://localhost:4173; camera input is blocked from file previews and unsecured remote pages.',
    },
    AbortError: {
      status: 'Camera start interrupted',
      detail: 'The camera driver interrupted startup. Disconnect and reconnect the camera, then try again.',
    },
  };
  return messages[name] || {
    status: 'Connection failed',
    detail: `The camera could not start (${name}). Check the camera connection and try again.`,
  };
}

// `facing` ('environment' = rear, 'user' = front) picks the lens on phones and tablets.
async function requestCameraStream(deviceId, facing) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (facing) video.facingMode = { ideal: facing };
  else if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

// Samples the live stream and reports whether it is delivering only black frames
// (privacy shutter closed, camera kill-switch key, or vendor privacy mode enabled).
async function isStreamBlack(video, samples = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < samples; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let brightest = 0;
    for (let p = 0; p < data.length; p += 4) brightest = Math.max(brightest, data[p], data[p + 1], data[p + 2]);
    if (brightest > 24) return false;
  }
  return true;
}

async function refreshCameraList() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    els.cameraConnectionState.textContent = 'Browser does not support camera input';
    return;
  }
  const selected = els.cameraSelect.value;
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  els.cameraSelect.replaceChildren();
  if (!cameras.length) {
    els.cameraSelect.add(new Option('No web camera detected', ''));
    return;
  }
  cameras.forEach((camera, index) => {
    const label = camera.label || `Web camera ${index + 1} (allow access to identify)`;
    els.cameraSelect.add(new Option(label, camera.deviceId));
  });
  if (cameras.some((camera) => camera.deviceId === selected)) els.cameraSelect.value = selected;
}

async function connectCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('This browser does not support web camera capture.', 'error');
    return;
  }
  els.connectCamera.disabled = true;
  els.connectCamera.textContent = 'Connecting…';
  els.cameraConnectionState.textContent = 'Requesting access';
  resetCameraHelp();
  try {
    const selectedId = els.cameraSelect.value;
    const facing = els.cameraFacing.value;
    const stream = await requestCameraStream(selectedId, facing);
    if (typeof stopGateway === 'function') stopGateway();
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = stream;
    els.webcam.srcObject = stream;
    els.cameraSetupPreview.srcObject = stream;
    await els.webcam.play();
    await els.cameraSetupPreview.play().catch(() => {});
    const settings = stream.getVideoTracks()[0]?.getSettings() || {};
    const format = settings.width && settings.height ? `${settings.width} × ${settings.height}` : 'LIVE STREAM';
    const device = (await navigator.mediaDevices.enumerateDevices()).find((item) => item.deviceId === settings.deviceId);
    const label = (device?.label || 'WEB CAMERA').replace(/^.*?\s/, '').toUpperCase().slice(0, 18) || 'WEB CAMERA';
    els.capturedFrame.hidden = true;
    // A rear camera looks away from the user, so mirroring would reverse the part.
    const rear = facing === 'environment' || settings.facingMode === 'environment';
    if (rear && state.mirror) { state.mirror = false; applyMirror(); }
    setCameraState({ connected: true, label: rear ? 'REAR CAMERA' : label, format, detail: 'LIVE PREVIEW', source: rear ? 'PHONE CAMERA' : 'WEB CAMERA' });
    els.cameraPreview.classList.add('has-preview');
    await refreshCameraList();
    if (await isStreamBlack(els.webcam)) {
      els.cameraConnectionState.textContent = 'Connected · no image';
      els.cameraMode.textContent = 'BLACK FRAMES';
      els.cameraHelp.textContent = 'The camera is connected but sending only black frames. Open the privacy shutter on the camera, press the camera on/off key (often F8, F9, or F10), and turn off camera privacy mode in your laptop vendor app (for example Lenovo Vantage), then reconnect.';
      els.cameraHelp.classList.add('error');
      showToast('Camera is sending black frames. Check the privacy shutter or camera key.', 'error');
      return;
    }
    showToast(`Camera connected at ${format}. Confirm the live image, then close this panel to inspect it.`);
  } catch (error) {
    const diagnosis = describeCameraError(error);
    els.cameraConnectionState.textContent = diagnosis.status;
    els.cameraHelp.textContent = diagnosis.detail;
    els.cameraHelp.classList.add('error');
    showToast(diagnosis.detail, 'error');
  } finally {
    els.connectCamera.disabled = false;
    els.connectCamera.textContent = 'Connect camera';
  }
}

function captureFrame() {
  if (state.gateway?.image) {
    const image = state.gateway.image;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    els.capturedFrame.src = canvas.toDataURL('image/png');
    els.capturedFrame.hidden = false;
    els.cameraStatus.textContent = 'FRAME CAPTURED';
    els.cameraMode.textContent = 'READY TO INSPECT';
    showToast('Frame captured from the smart camera. Inspections use it until you reconnect.');
    return;
  }
  if (!state.cameraStream || !els.webcam.videoWidth) {
    showToast('Connect a web camera before capturing an inspection image.', 'error');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = els.webcam.videoWidth;
  canvas.height = els.webcam.videoHeight;
  drawCameraFrame(canvas.getContext('2d'), canvas.width, canvas.height);
  els.capturedFrame.src = canvas.toDataURL('image/jpeg', 0.92);
  els.capturedFrame.hidden = false;
  els.cameraStatus.textContent = 'FRAME CAPTURED';
  els.cameraMode.textContent = 'READY TO INSPECT';
  showToast('Inspection frame captured from the live web camera.');
}

function openCameraDialog() {
  els.cameraDialog.hidden = false;
  refreshCameraList().catch(() => { els.cameraConnectionState.textContent = 'Unable to list cameras'; });
}

els.runControl.addEventListener('click', () => {
  state.running = !state.running;
  els.runControl.innerHTML = state.running ? '<span>Ⅱ</span> Pause line' : '<span>▶</span> Resume line';
  const status = document.querySelector('.running-status strong');
  const dot = document.querySelector('.pulse');
  status.textContent = state.running ? 'RUNNING' : 'PAUSED';
  status.style.color = state.running ? '' : '#d37a42';
  dot.style.background = state.running ? '' : '#e79c57';
  dot.style.boxShadow = state.running ? '' : '0 0 0 5px #fff0de';
  showToast(state.running ? 'Production line resumed safely.' : 'Production line paused. PLC notified.');
});

els.simulate.addEventListener('click', addPart);
els.openCamera.addEventListener('click', openCameraDialog);
els.closeCamera.addEventListener('click', () => { els.cameraDialog.hidden = true; });
els.cameraBackdrop.addEventListener('click', () => { els.cameraDialog.hidden = true; });
els.refreshCameras.addEventListener('click', () => (cameraSourceMode === 'gateway' ? checkGateway() : refreshCameraList().catch(() => showToast('Unable to refresh the camera list.', 'error'))));
els.connectCamera.addEventListener('click', () => (cameraSourceMode === 'gateway' ? connectGateway() : connectCamera()));
els.disconnectCamera.addEventListener('click', () => { stopCamera(); showToast('Camera disconnected. Inspection view returned to simulation.'); });
els.capture.addEventListener('click', captureFrame);
els.mirror.addEventListener('change', () => {
  state.mirror = els.mirror.checked;
  try { localStorage.setItem('visionforge.mirror', String(state.mirror)); } catch { /* session only */ }
  applyMirror();
});
applyMirror();
window.addEventListener('beforeunload', stopCamera);

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelector('.nav-item.active').classList.remove('active');
    item.classList.add('active');
    if (item.getAttribute('href') === '#dashboard') window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.querySelector(item.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelector('#detailsButton').addEventListener('click', () => showToast('Inspection A001247: all enabled steps passed.'));
document.querySelector('#allResults').addEventListener('click', () => showToast('Traceability archive is ready for filtered review.'));
document.querySelector('#periodButton').addEventListener('click', () => showToast('Showing defect distribution for Shift 1.'));
document.querySelector('#notifications').addEventListener('click', () => showToast('2 notifications: retention review and scheduled calibration.'));
document.querySelector('#helpButton').addEventListener('click', () => showToast('Operator help: acknowledge alarms or contact your line lead.'));
