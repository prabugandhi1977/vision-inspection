/*
 * Projector window for the AR work guide. Open it from the console (AR work guide → Open
 * projector window), move it to the projector above the bench and switch to full screen.
 *
 * It draws what the console sends (highlight shapes in camera-view coordinates and an
 * instruction panel) through a 4-corner homography, so the light lands on the real part.
 * Calibration is started from the console (ConfigureCamera) and saved there.
 */

const canvas = document.querySelector('#projection');
const ctx = canvas.getContext('2d');
const calibPanel = document.querySelector('#calibPanel');
const panelButton = document.querySelector('#panelButton');

const clone = (value) => JSON.parse(JSON.stringify(value));
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(AR_CHANNEL) : null;

let seq = 0;
let scene = null;
let bins = [];
let calibration = clone(AR_DEFAULT_CALIBRATION);
let calibrating = false;
let draft = null;
let lastMessage = 0;
let dragCorner = null;
let lastCorner = 0;

function toConsole(message) {
  const payload = { ...message, from: 'projector', seq: seq++ };
  channel?.postMessage(payload);
  try { if (window.opener && !window.opener.closed) window.opener.postMessage(payload, '*'); } catch { /* console closed */ }
}

function receive(message) {
  if (!message || message.from !== 'console' || message.type !== 'scene') return;
  lastMessage = Date.now();
  scene = message.scene;
  bins = message.guide?.bins || [];
  if (message.calibration?.corners?.length === 4) calibration = message.calibration;
  if (message.calibrating && !calibrating) {
    calibrating = true;
    draft = clone(calibration);
    calibPanel.hidden = false;
    panelButton.textContent = `Instruction panel: ${draft.panel}`;
  } else if (!message.calibrating && calibrating) {
    calibrating = false;
    draft = null;
    calibPanel.hidden = true;
  }
}

channel?.addEventListener('message', (event) => receive(event.data));
window.addEventListener('message', (event) => { if (event.source === window.opener || event.origin === location.origin) receive(event.data); });
toConsole({ type: 'hello' });
window.setInterval(() => toConsole({ type: 'alive' }), 2000);

/* ---------- Drawing ---------- */

function wrap(text, maxWidth) {
  const lines = [];
  let line = '';
  String(text || '').split(/\s+/).forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

function drawPanel(panel, W, H, scale, position) {
  if (!panel) return;
  const color = AR_COLORS[panel.tone] || AR_COLORS.target;
  const ph = H * 0.19;
  const top = position === 'top' ? H * 0.01 : H - ph - H * 0.01;
  const left = W * 0.03;
  const width = W * 0.94;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(left, top, width, ph);
  ctx.fillStyle = color;
  ctx.fillRect(left, top, 8 * scale, ph);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(left, top, width, ph);
  ctx.globalAlpha = 1;
  const x = left + 24 * scale;
  let y = top + 22 * scale;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.font = `600 ${13 * scale}px "IBM Plex Mono", monospace`;
  ctx.fillText(panel.eyebrow || '', x, y);
  // Timer against the standard time, on the right.
  if (panel.startedAt) {
    const elapsed = (Date.now() - panel.startedAt) / 1000;
    const over = panel.stdTime && elapsed > panel.stdTime * 1.5;
    ctx.textAlign = 'right';
    ctx.fillStyle = over ? AR_COLORS.error : '#d8e6e4';
    ctx.font = `600 ${22 * scale}px "IBM Plex Mono", monospace`;
    ctx.fillText(`${elapsed.toFixed(0)} s${panel.stdTime ? ` / ${panel.stdTime} s` : ''}`, left + width - 20 * scale, y);
    ctx.textAlign = 'left';
  }
  y += 22 * scale;
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${30 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillText(panel.title || '', x, y);
  y += 40 * scale;
  ctx.font = `400 ${19 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = '#e8f1ef';
  const textWidth = width * (panel.pick ? 0.6 : 0.92);
  wrap(panel.text, textWidth).slice(0, 2).forEach((line) => { ctx.fillText(line, x, y); y += 25 * scale; });
  if (panel.pick) {
    ctx.fillStyle = AR_COLORS.pick;
    ctx.font = `700 ${21 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.textAlign = 'right';
    wrap(`▶ ${panel.pick}`, width * 0.34).slice(0, 2).forEach((line, i) => ctx.fillText(line, left + width - 20 * scale, top + (62 + i * 26) * scale));
    ctx.textAlign = 'left';
  }
  if (panel.status) {
    ctx.fillStyle = panel.tone === 'fail' ? AR_COLORS.fail : '#9fb8b6';
    ctx.font = `500 ${14 * scale}px "IBM Plex Mono", monospace`;
    ctx.fillText(wrap(panel.status, width * 0.9)[0] || '', x, top + ph - 26 * scale);
  }
  if (typeof panel.progress === 'number') {
    ctx.fillStyle = '#1d2b30';
    ctx.fillRect(left + 8 * scale, top + ph - 5 * scale, width - 8 * scale, 5 * scale);
    ctx.fillStyle = color;
    ctx.fillRect(left + 8 * scale, top + ph - 5 * scale, (width - 8 * scale) * panel.progress, 5 * scale);
  }
  ctx.restore();
}

function drawCalibration(W, H, scale) {
  const px = draft.corners.map(([x, y]) => [x * W, y * H]);
  const map = arHomography(px);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1 * scale;
  for (let i = 1; i < 10; i += 1) { line(map, i / 10, 0, i / 10, 1); }
  for (let j = 1; j < 5; j += 1) { line(map, 0, j / 5, 1, j / 5); }
  ctx.setLineDash([8 * scale, 8 * scale]);
  line(map, 0, 1, 0, 1.4); line(map, 1, 1, 1, 1.4); line(map, 0, 1.4, 1, 1.4);
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3 * scale;
  arShapePath(ctx, { roi: { x: 0, y: 0, w: 1, h: 1 }, shape: 'box' }, map);
  ctx.stroke();
  ctx.restore();
  arDrawShapes(ctx, bins.map((bin) => ({ roi: bin.roi, shape: 'box', tone: 'pick', dashed: true, label: bin.name })), map, { scale });
  ctx.save();
  ['TOP LEFT', 'TOP RIGHT', 'BOTTOM RIGHT', 'BOTTOM LEFT'].forEach((label, i) => {
    const [x, y] = px[i];
    ctx.strokeStyle = i === lastCorner ? '#38e1ff' : '#fff';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath(); ctx.arc(x, y, 16 * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 26 * scale, y); ctx.lineTo(x + 26 * scale, y); ctx.moveTo(x, y - 26 * scale); ctx.lineTo(x, y + 26 * scale); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${12 * scale}px "IBM Plex Mono", monospace`;
    ctx.fillText(label, x + 20 * scale, y + (i < 2 ? 30 : -22) * scale);
  });
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${18 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  const [cx, cy] = map(0.5, 0.5);
  ctx.textAlign = 'center';
  ctx.fillText('CAMERA FIELD OF VIEW', cx, cy);
  ctx.restore();
}

function line(map, u0, v0, u1, v1) {
  const [x0, y0] = map(u0, v0);
  const [x1, y1] = map(u1, v1);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function frame(now) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const scale = Math.max(1, H / 720);
  if (calibrating && draft) {
    drawCalibration(W, H, scale);
  } else if (Date.now() - lastMessage > 5000) {
    ctx.fillStyle = '#5d7178';
    ctx.font = `500 ${16 * scale}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('VisionForge projector · waiting for the station console', W / 2, H / 2);
    ctx.textAlign = 'left';
  } else if (scene) {
    const map = arHomography(calibration.corners.map(([x, y]) => [x * W, y * H]));
    arDrawShapes(ctx, scene.shapes || [], map, { now, scale: scale * 1.4 });
    drawPanel(scene.panel, W, H, scale, calibration.panel);
  }
  window.requestAnimationFrame(frame);
}
window.requestAnimationFrame(frame);

/* ---------- Calibration ---------- */

function pointerPos(event) {
  return [event.clientX / window.innerWidth, event.clientY / window.innerHeight];
}

canvas.addEventListener('pointerdown', (event) => {
  if (!calibrating) return;
  const [x, y] = pointerPos(event);
  let best = -1;
  let bestDist = Infinity;
  draft.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot((cx - x) * window.innerWidth, (cy - y) * window.innerHeight);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  if (bestDist > 60) return;
  dragCorner = best;
  lastCorner = best;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (dragCorner === null) return;
  const [x, y] = pointerPos(event);
  draft.corners[dragCorner] = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
});
canvas.addEventListener('pointerup', () => { dragCorner = null; });

panelButton.addEventListener('click', () => {
  draft.panel = draft.panel === 'top' ? 'bottom' : 'top';
  panelButton.textContent = `Instruction panel: ${draft.panel}`;
});
document.querySelector('#resetButton').addEventListener('click', () => { draft = clone(AR_DEFAULT_CALIBRATION); panelButton.textContent = `Instruction panel: ${draft.panel}`; });
document.querySelector('#cancelButton').addEventListener('click', () => toConsole({ type: 'calibration-cancel' }));
document.querySelector('#saveButton').addEventListener('click', () => toConsole({ type: 'calibration', calibration: draft }));

/* ---------- Operator input and window chrome ---------- */

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

document.querySelector('#fullscreenButton').addEventListener('click', toggleFullscreen);
document.querySelector('#doneButton').addEventListener('click', () => toConsole({ type: 'done' }));
document.addEventListener('keydown', (event) => {
  if (event.target.closest('button')) return;
  if (calibrating && event.key.startsWith('Arrow')) {
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) / Math.max(window.innerWidth, window.innerHeight);
    const [x, y] = draft.corners[lastCorner];
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    draft.corners[lastCorner] = [Math.min(1, Math.max(0, x + dx)), Math.min(1, Math.max(0, y + dy))];
    return;
  }
  if (event.key === 'f' || event.key === 'F') toggleFullscreen();
  else if ((event.key === ' ' || event.key === 'Enter') && !calibrating && !event.repeat) { event.preventDefault(); toConsole({ type: 'done' }); }
});

let idleTimer = 0;
document.addEventListener('pointermove', () => {
  document.body.classList.add('show-ui');
  document.body.classList.remove('idle');
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => { document.body.classList.remove('show-ui'); if (!calibrating) document.body.classList.add('idle'); }, 2500);
});
