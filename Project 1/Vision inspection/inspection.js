/*
 * Inspection program: configurable tools, ROIs, and pass criteria.
 *
 * Follows the job structure used by industrial smart cameras and vision
 * controllers (Cognex In-Sight EasyBuilder, Keyence CV-X, Omron FH):
 *   acquire image → locate part (fixture) → run inspection tools → judge limits → output.
 * All tools run on real pixels from the captured frame, the live camera, or the
 * simulated part. ROIs are stored as fractions of the camera view (0–1).
 */

const ANALYSIS_WIDTH = 640;
const ANALYSIS_HEIGHT = 320; // matches the 2:1 camera view
const STORAGE_KEY = 'visionforge.program.v1';

const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink', 'Brown', 'White', 'Grey', 'Black'];
const FACE_API = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15';
const HIRES_SCALE = 2; // face detection works on a 1280 × 640 copy of the view

const thresholdParam ={ key: 'threshold', label: 'Grey threshold (0–255)', type: 'number', min: 0, max: 255, step: 1 };
const polarityParam = { key: 'polarity', label: 'Count pixels that are', type: 'select', options: [['bright', 'Brighter than threshold'], ['dark', 'Darker than threshold']] };

const TOOLS = {
  pattern: {
    label: 'Pattern match', group: 'Locate', icon: '⌖', unit: 'score', digits: 2, teach: true,
    summary: 'Finds a taught feature and reports its match score. As a locator, it shifts later ROIs to follow the part.',
    refs: 'Cognex PatMax · Keyence Pattern Search · Omron Search',
    params: [
      { key: 'searchMargin', label: 'Search range (% of ROI)', type: 'number', min: 0, max: 150, step: 5 },
      { key: 'locator', label: 'Use as part locator', type: 'select', options: [['yes', 'Yes · shift later ROIs'], ['no', 'No']] },
    ],
    defaults: { searchMargin: 40, locator: 'yes' }, criteria: { min: 0.8, max: 1 },
  },
  brightness: {
    label: 'Brightness', group: 'Presence', icon: '☼', unit: 'grey', digits: 0,
    summary: 'Average grey level in the ROI (0 = black, 255 = white).',
    refs: 'Cognex Brightness · Omron Color Data',
    params: [], defaults: {}, criteria: { min: 60, max: 220 },
  },
  pixelCount: {
    label: 'Pixel count', group: 'Presence', icon: '▦', unit: '%', digits: 1,
    summary: 'Share of ROI pixels brighter or darker than the threshold. Use for part presence or fill level.',
    refs: 'Cognex Pixel Count · Keyence Area · Omron Area',
    params: [thresholdParam, polarityParam], defaults: { threshold: 128, polarity: 'bright' }, criteria: { min: 30, max: 100 },
  },
  blob: {
    label: 'Blob count', group: 'Count', icon: '⁘', unit: 'blobs', digits: 0,
    summary: 'Counts connected regions after thresholding. Use for holes, pins, or missing components.',
    refs: 'Cognex Blob · Keyence Blob · Omron Labeling',
    params: [thresholdParam, { ...polarityParam, label: 'Blobs are' }, { key: 'minArea', label: 'Minimum blob area (px)', type: 'number', min: 1, max: 100000, step: 1 }],
    defaults: { threshold: 60, polarity: 'dark', minArea: 30 }, criteria: { min: 1, max: 1 },
  },
  edgeWidth: {
    label: 'Edge width', group: 'Measure', icon: '↔', unit: 'mm', digits: 2,
    summary: 'Caliper along the ROI centre line: distance between the first and last edge, converted with the calibration.',
    refs: 'Cognex Caliper · Keyence Edge Width · Omron Edge Width',
    params: [
      { key: 'direction', label: 'Scan direction', type: 'select', options: [['horizontal', 'Horizontal'], ['vertical', 'Vertical']] },
      { key: 'edgeContrast', label: 'Minimum edge contrast (grey)', type: 'number', min: 5, max: 255, step: 1 },
    ],
    defaults: { direction: 'horizontal', edgeContrast: 40 }, criteria: { min: 9.7, max: 10.3 },
  },
  color: {
    label: 'Color match', group: 'Color', icon: '◐', unit: '%', digits: 1, teach: true,
    summary: 'Similarity of the ROI average colour to the taught reference colour.',
    refs: 'Keyence Color Inspection · Omron Color Data',
    params: [], defaults: {}, criteria: { min: 90, max: 100 },
  },
  colorId: {
    label: 'Color identify', group: 'Color', icon: '◉', unit: '%', digits: 0,
    summary: 'Names the dominant colour in the ROI (red, blue, green…). Set an expected colour to require it; the value is the share of the ROI in that colour.',
    refs: 'Keyence Color Area · Omron Color Data',
    params: [{ key: 'expected', label: 'Expected colour', type: 'select', options: [['any', 'Any · report the colour only'], ...COLOR_NAMES.map((c) => [c, c])] }],
    defaults: { expected: 'any' }, criteria: { min: 50, max: 100 },
  },
  faceId: {
    label: 'Face ID', group: 'Identify', icon: '☺', unit: '%', digits: 0, enroll: true, fixed: true,
    summary: 'Detects faces in the ROI and names enrolled people; others are reported as Unknown. The value is the match confidence. Enroll each person first.',
    refs: 'Deep-learning face recognition · face-api.js 128-D descriptors',
    params: [{
      key: 'expected', label: 'Pass when', type: 'select',
      options: (step) => [['anyEnrolled', 'Any enrolled person is recognised'], ['anyFace', 'Any face is present'],
        ...(step.reference?.people || []).map((p) => [`person:${p.name}`, `${p.name} is recognised`])],
    }],
    defaults: { expected: 'anyEnrolled' }, criteria: { min: 45, max: 100 },
  },
  anomaly: {
    label: 'AI anomaly', group: 'AI', icon: '✦', unit: '', digits: 0, learn: true, fixed: true,
    summary: 'Learns what good parts look like from examples and scores how unusual a new part is (0 = typical, 100 = limit of normal variation). A heatmap shows where the anomaly is. No rules to write: learn about 20 good parts.',
    refs: 'Cognex Red Analyze (VisionPro Deep Learning) · MVTec HALCON Anomaly Detection · Keyence IV3 AI',
    params: [], defaults: {}, criteria: { min: 0, max: 100 },
  },
  contrast: {
    label: 'Surface contrast', group: 'Defect', icon: '≋', unit: 'σ', digits: 1,
    summary: 'Grey-level standard deviation. Scratches, stains, and dents raise it above a clean surface.',
    refs: 'Cognex Contrast · Omron Defect',
    params: [], defaults: {}, criteria: { min: 0, max: 25 },
  },
};

const pgm = {
  program: null,     // working copy (may contain unsaved edits)
  approved: null,    // last saved version, restored by "Discard changes"
  audit: [],
  selectedId: null,
  dirty: false,
  role: 'quality',
  drawing: false,
  lastResults: {},   // step id → result from the latest run
  simImage: null,
};

const pe = {
  roiLayer: document.querySelector('#roiLayer'),
  drawHint: document.querySelector('#drawHint'),
  overall: document.querySelector('#overallResult'),
  inspect: document.querySelector('#inspectButton'),
  run: document.querySelector('#runInspectionButton'),
  product: document.querySelector('#programProduct'),
  version: document.querySelector('#programVersion'),
  state: document.querySelector('#programState'),
  role: document.querySelector('#roleSelect'),
  permissionNote: document.querySelector('#permissionNote'),
  card: document.querySelector('#recipes'),
  library: document.querySelector('#toolLibrary'),
  stepList: document.querySelector('#stepList'),
  stepCount: document.querySelector('#stepCount'),
  editor: document.querySelector('#stepEditor'),
  pxPerMm: document.querySelector('#pxPerMm'),
  reason: document.querySelector('#changeReason'),
  save: document.querySelector('#saveRecipeButton'),
  revert: document.querySelector('#revertRecipeButton'),
  auditList: document.querySelector('#auditList'),
  auditCount: document.querySelector('#auditCount'),
  resultPill: document.querySelector('#resultPill'),
  resultPart: document.querySelector('#resultPart'),
  resultMeta: document.querySelector('#resultMeta'),
  resultCycle: document.querySelector('#resultCycle'),
  resultChecks: document.querySelector('#resultChecks'),
  statusRecipe: document.querySelector('.running-status b'),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const canEdit = () => pgm.role !== 'operator';
const stepById = (id) => pgm.program.steps.find((step) => step.id === id);
const formatValue = (tool, value) => (value === null || value === undefined || Number.isNaN(value) ? '—' : Number(value).toFixed(TOOLS[tool].digits));

function makeStep(tool, name, roi, overrides = {}) {
  const def = TOOLS[tool];
  return {
    id: newId(), name, tool, enabled: true, roi, fixed: Boolean(def.fixed),
    params: { ...def.defaults, ...(overrides.params || {}) },
    criteria: { ...def.criteria, ...(overrides.criteria || {}) },
    reference: null,
  };
}

// Default program for the simulated Component_A. Limits were set from the
// simulated part so that a good part passes with margin.
function defaultProgram() {
  return {
    product: 'Component_A',
    version: '1.2',
    pxPerMm: 3.086,
    steps: [
      makeStep('pattern', 'Part locator', { x: 0.40, y: 0.33, w: 0.20, h: 0.34 }, { criteria: { min: 0.7, max: 1 } }),
      makeStep('pixelCount', 'Part presence', { x: 0.14, y: 0.30, w: 0.72, h: 0.42 }, { params: { threshold: 100, polarity: 'bright' }, criteria: { min: 40, max: 100 } }),
      makeStep('edgeWidth', 'Hole Ø (left)', { x: 0.254, y: 0.531, w: 0.068, h: 0.04 }, { criteria: { min: 9.7, max: 10.3 } }),
      makeStep('blob', 'Hole present (right)', { x: 0.648, y: 0.44, w: 0.12, h: 0.22 }, { params: { threshold: 40, polarity: 'dark', minArea: 30 }, criteria: { min: 1, max: 1 } }),
      makeStep('color', 'Label colour', { x: 0.45, y: 0.43, w: 0.10, h: 0.15 }),
      makeStep('contrast', 'Surface finish', { x: 0.345, y: 0.42, w: 0.055, h: 0.12 }, { criteria: { min: 0, max: 12 } }),
    ],
  };
}

/* ---------- Image acquisition ---------- */

// Places a scratch/stain at a random spot on the part (only while "Add defect" is on).
const DEFECT_SPOTS = [[272, 160], [500, 165], [380, 246], [150, 240], [640, 150]];
function updateSimulatedDefect() {
  const group = document.querySelector('#simDefect');
  if (!pgm.simDefect) { group.setAttribute('display', 'none'); return 'none'; }
  const [x, y] = DEFECT_SPOTS[Math.floor(Math.random() * DEFECT_SPOTS.length)];
  const angle = Math.round(Math.random() * 160 - 80);
  const kind = Math.floor(Math.random() * 3); // 0 scratch, 1 stain, 2 both
  group.setAttribute('display', 'inline');
  group.setAttribute('transform', `translate(${x} ${y}) rotate(${angle})`);
  group.querySelector('.sim-scratch').setAttribute('display', kind === 1 ? 'none' : 'inline');
  group.querySelector('.sim-stain').setAttribute('display', kind === 0 ? 'none' : 'inline');
  return `${x},${y},${angle},${kind}`;
}

async function simulationImage() {
  const key = updateSimulatedDefect();
  if (pgm.simImage && pgm.simKey === key) return pgm.simImage;
  pgm.simKey = key;
  const svg = document.querySelector('.inspection-art svg').cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '760');
  svg.setAttribute('height', '330');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  pgm.simImage = img;
  return img;
}

function drawCover(ctx, source, sw, sh, width, height) {
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

// Small, realistic part-to-part variation (position, lighting, sensor noise) so learning and
// limits are exercised as on a real line.
function simulationVariation() {
  return { dx: (Math.random() - 0.5) * 0.008, dy: (Math.random() - 0.5) * 0.012, brightness: 0.97 + Math.random() * 0.06, noise: 2.5 };
}

function addSensorNoise(ctx, width, height, sigma) {
  const pixels = ctx.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 2;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(pixels, 0, 0);
}

function drawSimulation(ctx, img, width, height, variation = { dx: 0, dy: 0, brightness: 1, noise: 0 }) {
  const gradient = ctx.createRadialGradient(width * 0.49, height * 0.45, 0, width * 0.49, height * 0.45, width * 0.55);
  gradient.addColorStop(0, '#385360');
  gradient.addColorStop(0.52, '#152e3a');
  gradient.addColorStop(1, '#0b202e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // Same placement as .inspection-art (inset 2.5% 4%, SVG "meet" fit).
  const bx = width * 0.04;
  const by = height * 0.025;
  const bw = width - 2 * bx;
  const bh = height - 2 * by;
  const scale = Math.min(bw / 760, bh / 330);
  ctx.filter = `brightness(${variation.brightness})`;
  ctx.drawImage(img, bx + (bw - 760 * scale) / 2 + variation.dx * width, by + (bh - 330 * scale) / 2 + variation.dy * height, 760 * scale, 330 * scale);
  ctx.filter = 'none';
  if (variation.noise) addSensorNoise(ctx, width, height, variation.noise);
}

// Returns what the operator sees in the camera view, as a 640 × 320 image, so
// ROIs drawn on screen map one-to-one onto analysed pixels. `hires` is the same
// view at twice the resolution, used by face recognition.
async function acquireImage({ ideal = false } = {}) {
  let draw;
  let source = 'SIMULATION';
  if (!els.capturedFrame.hidden && els.capturedFrame.naturalWidth) {
    const frame = els.capturedFrame;
    draw = (ctx, w, h) => drawCover(ctx, frame, frame.naturalWidth, frame.naturalHeight, w, h);
    source = 'CAPTURED FRAME';
  } else if (state.cameraStream) {
    if (!els.webcam.videoWidth) throw new Error('Camera is connected but has not delivered a frame.');
    // Grab one video frame so both resolutions analyse the same instant.
    const still = document.createElement('canvas');
    still.width = els.webcam.videoWidth;
    still.height = els.webcam.videoHeight;
    drawCameraFrame(still.getContext('2d'), still.width, still.height);
    draw = (ctx, w, h) => drawCover(ctx, still, still.width, still.height, w, h);
    source = 'LIVE CAMERA';
  } else {
    const img = await simulationImage();
    const variation = ideal ? undefined : simulationVariation();
    draw = (ctx, w, h) => drawSimulation(ctx, img, w, h, variation);
  }
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_WIDTH;
  canvas.height = ANALYSIS_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  draw(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  let hires = null;
  return {
    image: ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT),
    source,
    hires: () => {
      if (!hires) {
        hires = document.createElement('canvas');
        hires.width = ANALYSIS_WIDTH * HIRES_SCALE;
        hires.height = ANALYSIS_HEIGHT * HIRES_SCALE;
        draw(hires.getContext('2d'), hires.width, hires.height);
      }
      return hires;
    },
  };
}

/* ---------- Colour naming ---------- */

function colorName(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (v < 0.2) return 'Black';
  if (s < 0.25) return v > 0.8 ? 'White' : v < 0.3 ? 'Black' : 'Grey';
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return 'Red';
  if (h < 40) return v < 0.6 ? 'Brown' : 'Orange';
  if (h < 70) return 'Yellow';
  if (h < 165) return 'Green';
  if (h < 195) return 'Cyan';
  if (h < 255) return 'Blue';
  if (h < 290) return 'Purple';
  return 'Pink';
}

/* ---------- Face recognition (loaded on first use) ---------- */

let faceApiReady = null;
let gpuVerified = false; // GPU result cross-checked on the CPU once this session
const FACE_DETECT_PASSES = [
  { inputSize: 416, scoreThreshold: 0.5 },
  { inputSize: 608, scoreThreshold: 0.4 },
  { inputSize: 800, scoreThreshold: 0.35 },
];
// On WebGL the first inference at each input size can return wrong results (no face, or a
// descriptor that matches nobody) while shaders compile. Run every network at every input
// size used before the first real detection.
async function warmUpFaceModels() {
  const blank = document.createElement('canvas');
  blank.width = 160;
  blank.height = 160;
  const ctx = blank.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 160, 160);
  for (let round = 0; round < 2; round += 1) {
    for (const options of FACE_DETECT_PASSES) await faceapi.detectAllFaces(blank, new faceapi.TinyFaceDetectorOptions(options));
    await faceapi.detectFaceLandmarksTiny(blank);
    await faceapi.computeFaceDescriptor(blank);
  }
}

function loadFaceApi() {
  if (!faceApiReady) {
    showToast('Loading face recognition models (about 7 MB, first use only)…');
    faceApiReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${FACE_API}/dist/face-api.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Face recognition library could not be loaded. Check the internet connection.'));
      document.head.append(script);
    }).then(() => {
      const url = `${FACE_API}/model/`;
      return Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
      ]);
    }).then(warmUpFaceModels);
    faceApiReady.catch(() => { faceApiReady = null; });
  }
  return faceApiReady;
}

async function detectFaces(acquired, rect) {
  await loadFaceApi();
  const crop = document.createElement('canvas');
  crop.width = rect.w * HIRES_SCALE;
  crop.height = rect.h * HIRES_SCALE;
  crop.getContext('2d').drawImage(acquired.hires(), rect.x * HIRES_SCALE, rect.y * HIRES_SCALE, crop.width, crop.height, 0, 0, crop.width, crop.height);
  // The detector resizes the whole ROI to `inputSize`, so small (distant) or turned faces can
  // vanish at the fast setting. Only when nothing is found, retry at higher resolution and a
  // slightly lower score threshold.
  const detect = async () => {
    for (const options of FACE_DETECT_PASSES) {
      const found = await faceapi
        .detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions(options))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
      if (found.length) return found;
    }
    return [];
  };
  let faces = await detect();
  let engine = faceapi.tf.getBackend() === 'webgl' ? 'GPU' : 'CPU';
  // Some GPU drivers return no detections on WebGL. The first time the GPU finds no face,
  // cross-check once on the CPU (several seconds): if the CPU finds a face the GPU is unreliable
  // and the CPU is used from then on; otherwise the GPU is trusted for the rest of the session.
  if (!faces.length && engine === 'GPU' && !gpuVerified) {
    gpuVerified = true;
    await faceapi.tf.setBackend('cpu');
    await faceapi.tf.ready();
    faces = await detect();
    engine = 'CPU check';
    if (faces.length) {
      showToast('Face detection switched to CPU mode: the graphics driver missed faces (slower but reliable).');
    } else {
      await faceapi.tf.setBackend('webgl');
      await faceapi.tf.ready();
    }
  }
  const result = faces.map((f) => {
    const box = f.detection.box;
    return {
      descriptor: f.descriptor,
      score: f.detection.score,
      sizePx: box.width, // face width in the high-resolution view
      // Face box as a fraction of the camera view, for the overlay.
      box: {
        x: (rect.x + box.x / HIRES_SCALE) / ANALYSIS_WIDTH,
        y: (rect.y + box.y / HIRES_SCALE) / ANALYSIS_HEIGHT,
        w: box.width / HIRES_SCALE / ANALYSIS_WIDTH,
        h: box.height / HIRES_SCALE / ANALYSIS_HEIGHT,
      },
    };
  });
  result.engine = engine;
  return result;
}

// Confidence = (1 − descriptor distance) × 100. The face-api.js model separates people at a
// distance of about 0.55–0.6, i.e. 40–45% confidence.
const AMBIGUITY_MARGIN = 6; // % points: closer than this to a second person → Unknown

function bestMatch(descriptor, people) {
  const scores = people.map((person) => ({
    name: person.name,
    confidence: Math.max(0, ...person.descriptors.map((d) => (1 - faceapi.euclideanDistance(descriptor, d)) * 100)),
  })).sort((a, b) => b.confidence - a.confidence);
  const [best = { name: 'Unknown', confidence: 0 }, second] = scores;
  return { ...best, ambiguous: Boolean(second && best.confidence - second.confidence < AMBIGUITY_MARGIN) };
}

/* ---------- AI anomaly detection (MobileNetV2 features, PatchCore-style) ---------- */

// A pretrained MobileNetV2 (ImageNet, width 0.35, bundled in models/) turns the ROI into a
// 14 × 14 grid of patch features. Learning stores the features of good parts; a new part is
// scored by how far each patch is from the nearest good patch at the same or a neighbouring
// position. Scores are normalised by the spread among the good parts (leave-one-out), so
// 100 = the limit of normal variation seen during learning.
const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const AI_MODEL_URL = 'models/mobilenet_v2_035/model.json';
const AI_INPUT = 224;
const AI_GRID = 14;
const AI_DIMS = 64;          // feature channels kept per patch (fixed random subset of 240)
const AI_MIN_SAMPLES = 3;
const AI_MAX_SAMPLES = 30;
// Deterministic channel subset so stored samples stay comparable across sessions.
const AI_CHANNELS = (() => {
  const all = Array.from({ length: 240 }, (_, i) => i);
  let seed = 20260927;
  for (let i = all.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const j = seed % (i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, AI_DIMS).sort((a, b) => a - b);
})();

let aiReady = null;
function loadAiModel() {
  if (!aiReady) {
    showToast('Loading AI model (MobileNetV2, about 2 MB)…');
    aiReady = (window.tf ? Promise.resolve() : new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TFJS_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error('TensorFlow.js could not be loaded. Check the internet connection.'));
      document.head.append(script);
    })).then(async () => {
      const base = await tf.loadLayersModel(AI_MODEL_URL);
      const model = tf.model({ inputs: base.inputs, outputs: [base.getLayer('block_6_expand_relu').output, base.getLayer('block_13_expand_relu').output] });
      // First WebGL inferences can be wrong while shaders compile; warm up before real use.
      for (let i = 0; i < 2; i += 1) tf.tidy(() => model.predict(tf.zeros([1, AI_INPUT, AI_INPUT, 3])).forEach((t) => t.dataSync()));
      return model;
    });
    aiReady.catch(() => { aiReady = null; });
  }
  return aiReady;
}

// The ROI is scaled so its short side fills the network input (224 px) and covered by
// overlapping square tiles along its long side, so wide or tall ROIs keep full detail.
function tileLayout(rect) {
  const scale = AI_INPUT / (Math.min(rect.w, rect.h) * HIRES_SCALE);
  const horizontal = rect.w >= rect.h;
  const long = Math.max(rect.w, rect.h) * HIRES_SCALE * scale;
  const count = Math.max(1, Math.ceil(long / AI_INPUT - 0.05));
  const starts = Array.from({ length: count }, (_, k) => (count === 1 ? 0 : (k * (long - AI_INPUT)) / (count - 1)));
  // Global grid along the long axis, in feature cells (16 input px per cell).
  const cellPx = AI_INPUT / AI_GRID;
  return { scale, horizontal, long, count, starts, cellPx, cells: Math.max(AI_GRID, Math.round(long / cellPx)) };
}

// Returns { data: Float32Array(tiles × 14 × 14 × AI_DIMS), layout } of patch features for the ROI.
async function extractPatchFeatures(acquired, rect) {
  const model = await loadAiModel();
  const layout = tileLayout(rect);
  const source = acquired.hires();
  const tiles = layout.starts.map((start) => {
    const tile = document.createElement('canvas');
    tile.width = AI_INPUT;
    tile.height = AI_INPUT;
    const size = AI_INPUT / layout.scale; // tile size in high-resolution pixels
    const sx = rect.x * HIRES_SCALE + (layout.horizontal ? start / layout.scale : 0);
    const sy = rect.y * HIRES_SCALE + (layout.horizontal ? 0 : start / layout.scale);
    tile.getContext('2d').drawImage(source, sx, sy, size, size, 0, 0, AI_INPUT, AI_INPUT);
    return tile;
  });
  // One tile per inference: the input shape then always matches the warmed-up shape
  // (a new batch size would trigger fresh WebGL shader compilation and a wrong first result).
  const perTile = AI_GRID * AI_GRID * AI_DIMS;
  const data = new Float32Array(tiles.length * perTile);
  for (let k = 0; k < tiles.length; k += 1) {
    const features = tf.tidy(() => {
      const x = tf.browser.fromPixels(tiles[k]).toFloat().div(127.5).sub(1).expandDims(0);
      const [mid, deep] = model.predict(x);                         // 28×28×96, 14×14×144
      const combined = tf.concat([tf.avgPool(mid, 2, 2, 'valid'), deep], 3); // 14×14×240
      const local = tf.avgPool(combined, 3, 1, 'same');             // neighbourhood context
      return tf.gather(local, AI_CHANNELS, 3);
    });
    data.set(await features.data(), k * perTile);
    features.dispose();
  }
  return { data, layout };
}

// Samples are stored quantised to bytes (base64) to keep recipes small.
const AI_SCALE = 32; // features after ReLU/pooling are small positive numbers
function encodeSample(features) {
  const bytes = Uint8Array.from(features.data, (v) => clamp(Math.round(v * AI_SCALE), 0, 255));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
const decodedSamples = new Map();
function decodeSample(encoded) {
  if (!decodedSamples.has(encoded)) {
    const binary = atob(encoded);
    decodedSamples.set(encoded, Float32Array.from(binary, (c) => c.charCodeAt(0) / AI_SCALE));
  }
  return decodedSamples.get(encoded);
}

// Per-patch anomaly map: distance from each patch to the nearest good patch within ±1 cell.
function anomalyMap(features, samples) {
  const tiles = features.length / (AI_GRID * AI_GRID * AI_DIMS);
  const map = new Float32Array(tiles * AI_GRID * AI_GRID);
  for (let tile = 0; tile < tiles; tile += 1) {
  const base = tile * AI_GRID * AI_GRID;
  for (let r = 0; r < AI_GRID; r += 1) {
    for (let c = 0; c < AI_GRID; c += 1) {
      const at = (base + r * AI_GRID + c) * AI_DIMS;
      let best = Infinity;
      for (const sample of samples) {
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= AI_GRID || cc >= AI_GRID) continue;
            const other = (base + rr * AI_GRID + cc) * AI_DIMS;
            let d = 0;
            for (let k = 0; k < AI_DIMS; k += 1) {
              const diff = features[at + k] - sample[other + k];
              d += diff * diff;
              if (d >= best) break;
            }
            if (d < best) best = d;
          }
        }
      }
      map[base + r * AI_GRID + c] = Math.sqrt(best);
    }
  }
  }
  return map;
}

// Merges per-tile maps into one grid over the whole ROI (max where tiles overlap).
function mergeTileMaps(map, layout) {
  const rows = AI_GRID;
  const cols = layout.cells;
  const merged = new Float32Array(rows * cols);
  layout.starts.forEach((start, tile) => {
    const shift = Math.round(start / layout.cellPx);
    for (let r = 0; r < AI_GRID; r += 1) {
      for (let c = 0; c < AI_GRID; c += 1) {
        const v = map[tile * AI_GRID * AI_GRID + r * AI_GRID + c];
        // Along the long axis the tile's cells are offset by its start position.
        const [gr, gc] = layout.horizontal ? [r, c + shift] : [c, r + shift];
        const index = gr * cols + Math.min(cols - 1, gc);
        merged[index] = Math.max(merged[index], v);
      }
    }
  });
  return { merged, width: layout.horizontal ? cols : rows, height: layout.horizontal ? rows : cols, horizontal: layout.horizontal, cols };
}

// Scale reference: leave-one-out scores of the good samples. A sample scoring more than
// 2.5 × the median is a gross outlier (e.g. a bad part shown by mistake) and is excluded;
// limit = the larger of mean + 3σ and 1.15 × the maximum of the remaining scores.
function learnThreshold(encodedSamples) {
  const samples = encodedSamples.map(decodeSample);
  const scores = samples.map((sample, i) => Math.max(...anomalyMap(sample, samples.filter((_, j) => j !== i))));
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const outliers = scores.map((v, i) => (v > 2.5 * median ? i : -1)).filter((i) => i >= 0);
  const kept = scores.filter((_, i) => !outliers.includes(i));
  const { mean, std } = stats(kept);
  return { limit: Math.max(mean + 3 * std, Math.max(...kept) * 1.15, 1e-6), mean, spread: std, outliers };
}

function heatmapImage(map, layout, limit) {
  const grid = mergeTileMaps(map, layout);
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(grid.width, grid.height);
  grid.merged.forEach((v, index) => {
    // merged is stored long-axis-major as rows × cols; transpose for vertical ROIs.
    const r = Math.floor(index / grid.cols);
    const c = index % grid.cols;
    const i = grid.horizontal ? r * grid.width + c : c * grid.width + r;
    const t = clamp(v / limit, 0, 2); // 1 = limit of normal
    const a = clamp((t - 0.6) / 0.6, 0, 1);
    pixels.data[i * 4] = 255;
    pixels.data[i * 4 + 1] = Math.round(clamp(1.6 - t, 0, 1) * 200);
    pixels.data[i * 4 + 2] = 40;
    pixels.data[i * 4 + 3] = Math.round(a * 190);
  });
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

/* ---------- Pixel helpers ---------- */

function roiRect(roi, offset = { dx: 0, dy: 0 }) {
  const x = Math.round(roi.x * ANALYSIS_WIDTH + offset.dx);
  const y = Math.round(roi.y * ANALYSIS_HEIGHT + offset.dy);
  const x0 = clamp(x, 0, ANALYSIS_WIDTH);
  const y0 = clamp(y, 0, ANALYSIS_HEIGHT);
  const x1 = clamp(x + Math.round(roi.w * ANALYSIS_WIDTH), 0, ANALYSIS_WIDTH);
  const y1 = clamp(y + Math.round(roi.h * ANALYSIS_HEIGHT), 0, ANALYSIS_HEIGHT);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function greyRegion(image, rect) {
  const grey = new Float32Array(rect.w * rect.h);
  const { data, width } = image;
  for (let j = 0; j < rect.h; j += 1) {
    for (let i = 0; i < rect.w; i += 1) {
      const p = ((rect.y + j) * width + rect.x + i) * 4;
      grey[j * rect.w + i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
  }
  return grey;
}

function meanColor(image, rect) {
  const sum = [0, 0, 0];
  const { data, width } = image;
  for (let j = 0; j < rect.h; j += 1) {
    for (let i = 0; i < rect.w; i += 1) {
      const p = ((rect.y + j) * width + rect.x + i) * 4;
      sum[0] += data[p]; sum[1] += data[p + 1]; sum[2] += data[p + 2];
    }
  }
  const n = rect.w * rect.h;
  return sum.map((v) => v / n);
}

function downsample(grey, w, h, f) {
  const dw = Math.floor(w / f);
  const dh = Math.floor(h / f);
  const out = new Float32Array(dw * dh);
  for (let j = 0; j < dh; j += 1) {
    for (let i = 0; i < dw; i += 1) {
      let s = 0;
      for (let v = 0; v < f; v += 1) for (let u = 0; u < f; u += 1) s += grey[(j * f + v) * w + i * f + u];
      out[j * dw + i] = s / (f * f);
    }
  }
  return { data: out, w: dw, h: dh };
}

function stats(values) {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return { mean, std: Math.sqrt(sq / values.length) };
}

/* ---------- Tools ---------- */

const RUNNERS = {
  brightness(image, rect) {
    const { mean } = stats(greyRegion(image, rect));
    return { value: mean, text: `mean grey ${mean.toFixed(0)}` };
  },

  contrast(image, rect) {
    const { std } = stats(greyRegion(image, rect));
    return { value: std, text: `σ ${std.toFixed(1)} grey levels` };
  },

  pixelCount(image, rect, step) {
    const grey = greyRegion(image, rect);
    const { threshold, polarity } = step.params;
    let count = 0;
    for (const v of grey) if (polarity === 'dark' ? v < threshold : v >= threshold) count += 1;
    const pct = (count / grey.length) * 100;
    return { value: pct, text: `${pct.toFixed(1)}% ${polarity} pixels` };
  },

  blob(image, rect, step) {
    const grey = greyRegion(image, rect);
    const { threshold, polarity, minArea } = step.params;
    const w = rect.w;
    const mask = new Uint8Array(grey.length);
    grey.forEach((v, i) => { mask[i] = (polarity === 'dark' ? v < threshold : v >= threshold) ? 1 : 0; });
    const seen = new Uint8Array(grey.length);
    const stack = [];
    let blobs = 0;
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || seen[start]) continue;
      let area = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        area += 1;
        const x = p % w;
        const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const n of neighbours) {
          if (n >= 0 && n < mask.length && mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      if (area >= minArea) blobs += 1;
    }
    return { value: blobs, text: `${blobs} blob${blobs === 1 ? '' : 's'} ≥ ${minArea} px` };
  },

  edgeWidth(image, rect, step, context) {
    const grey = greyRegion(image, rect);
    const horizontal = step.params.direction !== 'vertical';
    const length = horizontal ? rect.w : rect.h;
    const across = horizontal ? rect.h : rect.w;
    const centre = Math.floor(across / 2);
    const lines = [centre - 1, centre, centre + 1].filter((l) => l >= 0 && l < across);
    const profile = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      let s = 0;
      for (const l of lines) s += horizontal ? grey[l * rect.w + i] : grey[i * rect.w + l];
      profile[i] = s / lines.length;
    }
    // Gradient along the profile; an edge is a run of strong gradient. Its position is the
    // gradient peak refined to sub-pixel precision with a parabola (standard caliper method).
    const gradient = new Float32Array(length);
    for (let i = 1; i < length - 1; i += 1) gradient[i] = Math.abs(profile[i + 1] - profile[i - 1]);
    const edges = [];
    for (let i = 1; i < length - 1; i += 1) {
      if (gradient[i] < step.params.edgeContrast) continue;
      const last = edges[edges.length - 1];
      if (last && i - last.end <= 1) last.end = i; else edges.push({ start: i, end: i });
    }
    const position = (edge) => {
      let peak = edge.start;
      for (let i = edge.start; i <= edge.end; i += 1) if (gradient[i] > gradient[peak]) peak = i;
      const a = gradient[peak - 1] ?? 0;
      const c = gradient[peak + 1] ?? 0;
      const curvature = a - 2 * gradient[peak] + c;
      return peak + (curvature < 0 ? clamp(0.5 * (a - c) / curvature, -0.5, 0.5) : 0);
    };
    if (edges.length < 2) return { value: null, fail: `${edges.length} edge found; need 2`, text: 'edges not found' };
    const first = position(edges[0]);
    const last = position(edges[edges.length - 1]);
    const px = last - first;
    const mm = px / context.pxPerMm;
    return { value: mm, text: `${mm.toFixed(2)} mm (${px.toFixed(1)} px)` };
  },

  color(image, rect, step) {
    if (!step.reference?.rgb) return { error: 'Reference colour not taught. Select Teach reference.' };
    const rgb = meanColor(image, rect);
    const distance = Math.hypot(rgb[0] - step.reference.rgb[0], rgb[1] - step.reference.rgb[1], rgb[2] - step.reference.rgb[2]);
    const similarity = Math.max(0, 100 - (distance / 441.7) * 100 * 4);
    const name = colorName(...rgb);
    return { value: similarity, label: `${name} · ${similarity.toFixed(1)}%`, text: `${name} · rgb(${rgb.map((v) => v.toFixed(0)).join(', ')}) · reference ${colorName(...step.reference.rgb)}` };
  },

  colorId(image, rect, step) {
    const counts = Object.fromEntries(COLOR_NAMES.map((c) => [c, 0]));
    const { data, width } = image;
    for (let j = 0; j < rect.h; j += 1) {
      for (let i = 0; i < rect.w; i += 1) {
        const p = ((rect.y + j) * width + rect.x + i) * 4;
        counts[colorName(data[p], data[p + 1], data[p + 2])] += 1;
      }
    }
    const total = rect.w * rect.h;
    const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const [dominant, dominantCount] = ranked[0];
    const expected = step.params.expected;
    const share = ((expected === 'any' ? dominantCount : counts[expected]) / total) * 100;
    const breakdown = ranked.slice(0, 3).map(([c, n]) => `${c} ${((n / total) * 100).toFixed(0)}%`).join(', ');
    const label = expected === 'any' || expected === dominant ? `${dominant} · ${share.toFixed(0)}%` : `${dominant} (expected ${expected} ${share.toFixed(0)}%)`;
    return { value: share, label, text: breakdown };
  },

  async anomaly(image, rect, step, context, acquired) {
    const samples = step.reference?.samples || [];
    if (samples.length < AI_MIN_SAMPLES) return { error: `Learn at least ${AI_MIN_SAMPLES} good parts first (${samples.length} learned; 20 recommended).` };
    const features = await extractPatchFeatures(acquired, rect);
    const decoded = samples.map(decodeSample);
    if (decoded.some((sample) => sample.length !== features.data.length)) return { error: 'The ROI size changed since learning. Select Clear and learn the good parts again.' };
    const map = anomalyMap(features.data, decoded);
    const { limit } = step.reference.threshold;
    const value = (Math.max(...map) / limit) * 100;
    const verdict = value <= step.criteria.max ? 'Normal' : 'Anomaly';
    return { value, label: `${verdict} · ${value.toFixed(0)}`, text: `anomaly score ${value.toFixed(0)} (limit ${step.criteria.max}) · ${samples.length} good parts learned`, heatmap: heatmapImage(map, features.layout, limit * step.criteria.max / 100) };
  },

  async faceId(image, rect, step, context, acquired) {
    const people = step.reference?.people || [];
    const expected = step.params.expected;
    if (expected !== 'anyFace' && !people.length) return { error: 'No one is enrolled. Enter a name and select Enroll face.' };
    const faces = await detectFaces(acquired, rect);
    if (!faces.length) return { value: 0, label: 'No face', text: `No face detected in the ROI (${faces.engine})`, faces: [] };
    const minimum = step.criteria.min;
    const named = faces.map((face) => {
      const match = people.length ? bestMatch(face.descriptor, people) : { name: 'Unknown', confidence: 0 };
      const recognised = match.confidence >= minimum && !match.ambiguous;
      return { box: face.box, name: recognised ? match.name : 'Unknown', confidence: match.confidence, recognised };
    });
    let value;
    if (expected === 'anyFace') value = 100;
    else if (expected.startsWith('person:')) {
      const wanted = expected.slice(7);
      value = Math.max(0, ...named.filter((f) => f.name === wanted).map((f) => f.confidence));
    } else value = Math.max(0, ...named.filter((f) => f.recognised).map((f) => f.confidence));
    const label = named.map((f) => (f.recognised ? `${f.name} ${f.confidence.toFixed(0)}%` : 'Unknown')).join(', ');
    return { value, label, text: `${faces.length} face${faces.length === 1 ? '' : 's'}: ${label} (${faces.engine})`, faces: named };
  },

  pattern(image, rect, step) {
    const ref = step.reference;
    if (!ref?.template) return { error: 'Pattern not taught. Select Teach reference.' };
    const f = ref.factor;
    const margin = (step.params.searchMargin / 100);
    const search = {
      x: clamp(Math.round(rect.x - rect.w * margin), 0, ANALYSIS_WIDTH),
      y: clamp(Math.round(rect.y - rect.h * margin), 0, ANALYSIS_HEIGHT),
    };
    search.w = clamp(Math.round(rect.x + rect.w * (1 + margin)), 0, ANALYSIS_WIDTH) - search.x;
    search.h = clamp(Math.round(rect.y + rect.h * (1 + margin)), 0, ANALYSIS_HEIGHT) - search.y;
    const region = downsample(greyRegion(image, search), search.w, search.h, f);
    const t = ref.template;
    const tw = ref.tw;
    const th = ref.th;
    if (region.w < tw || region.h < th) return { error: 'Search area is smaller than the taught pattern.' };
    const tStats = stats(t);
    if (tStats.std < 1) return { error: 'Taught pattern has no detail. Teach it on a textured feature.' };
    let best = { score: -1, x: 0, y: 0 };
    const cols = region.w - tw + 1;
    const scores = new Float32Array(cols * (region.h - th + 1)).fill(-1);
    for (let y = 0; y <= region.h - th; y += 1) {
      for (let x = 0; x <= region.w - tw; x += 1) {
        let sum = 0; let sumSq = 0; let cross = 0;
        for (let j = 0; j < th; j += 1) {
          const row = (y + j) * region.w + x;
          for (let i = 0; i < tw; i += 1) {
            const v = region.data[row + i];
            sum += v; sumSq += v * v; cross += v * t[j * tw + i];
          }
        }
        const n = tw * th;
        const mean = sum / n;
        const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
        if (std < 1) continue;
        const score = (cross / n - mean * tStats.mean) / (std * tStats.std);
        scores[y * cols + x] = score;
        if (score > best.score) best = { score, x, y };
      }
    }
    // Sub-pixel refinement: fit a parabola through the peak and its neighbours in x and y,
    // so the offset is not limited to the coarse search grid (f pixels).
    const at = (x, y) => scores[y * cols + x];
    const refine = (minus, centre, plus) => {
      const curvature = minus - 2 * centre + plus;
      return minus > -1 && plus > -1 && curvature < 0 ? clamp(0.5 * (minus - plus) / curvature, -0.5, 0.5) : 0;
    };
    const rows = region.h - th + 1;
    const subX = best.x > 0 && best.x < cols - 1 ? refine(at(best.x - 1, best.y), best.score, at(best.x + 1, best.y)) : 0;
    const subY = best.y > 0 && best.y < rows - 1 ? refine(at(best.x, best.y - 1), best.score, at(best.x, best.y + 1)) : 0;
    const score = Math.max(0, best.score);
    const foundX = search.x + (best.x + subX) * f;
    const foundY = search.y + (best.y + subY) * f;
    const offset = { dx: foundX - ref.x, dy: foundY - ref.y };
    return { value: score, offset, text: `score ${score.toFixed(2)} · offset ${offset.dx.toFixed(1)}, ${offset.dy.toFixed(1)} px` };
  },
};

function teachStep(step, image) {
  const rect = roiRect(step.roi);
  if (rect.w < 4 || rect.h < 4) throw new Error('ROI is outside the image.');
  if (step.tool === 'color') {
    step.reference = { rgb: meanColor(image, rect), taughtAt: new Date().toISOString() };
    return;
  }
  const f = Math.max(1, Math.ceil(Math.max(rect.w, rect.h) / 40));
  const t = downsample(greyRegion(image, rect), rect.w, rect.h, f);
  step.reference = { template: Array.from(t.data, (v) => Math.round(v)), tw: t.w, th: t.h, factor: f, x: rect.x, y: rect.y, taughtAt: new Date().toISOString() };
}

/* ---------- Running the program ---------- */

function judge(step, outcome) {
  if (outcome.error) return { status: 'ERROR', value: null, text: outcome.error };
  if (outcome.fail) return { status: 'FAIL', value: outcome.value, text: outcome.fail };
  const { min, max } = step.criteria;
  const ok = outcome.value >= min && outcome.value <= max;
  return { status: ok ? 'PASS' : 'FAIL', value: outcome.value, label: outcome.label, text: outcome.text, offset: outcome.offset, faces: outcome.faces, heatmap: outcome.heatmap };
}

// Short result for display: a name (colour, person) when the tool gives one, else the value.
function resultLabel(step, result) {
  if (result.label) return result.label;
  if (result.value !== null && result.value !== undefined) return `${formatValue(step.tool, result.value)} ${TOOLS[step.tool].unit}`;
  return result.status;
}

// One inspection or enrollment at a time: overlapping runs would share the detector and
// could switch its GPU/CPU backend mid-run.
let busy = false;
async function exclusive(task) {
  if (busy) { showToast('Still working on the previous inspection. Please wait.'); return null; }
  busy = true;
  [pe.inspect, pe.run].forEach((button) => { button.disabled = true; });
  try {
    return await task();
  } finally {
    busy = false;
    [pe.inspect, pe.run].forEach((button) => { button.disabled = false; });
  }
}

const runProgram = (options) => exclusive(() => runProgramOnce(options));

async function runProgramOnce({ record = true } = {}) {
  const started = performance.now();
  const results = {};
  let overall = 'PASS';
  let source = '—';
  const enabled = pgm.program.steps.filter((step) => step.enabled);
  try {
    if (!enabled.length) throw new Error('No enabled inspection steps in this recipe.');
    const acquired = await acquireImage();
    source = acquired.source;
    let offset = { dx: 0, dy: 0 };
    let lostPart = null;
    for (const step of pgm.program.steps) {
      if (!step.enabled) { results[step.id] = { status: 'SKIPPED', value: null, text: 'Step disabled' }; continue; }
      if (lostPart && !step.fixed) { results[step.id] = { status: 'SKIPPED', value: null, text: `Part not located by “${lostPart}”` }; continue; }
      const t0 = performance.now();
      const rect = roiRect(step.roi, step.fixed ? undefined : offset);
      let result;
      if (rect.w < 4 || rect.h < 4) {
        result = { status: 'ERROR', value: null, text: 'ROI is outside the image' };
      } else {
        try {
          result = judge(step, await RUNNERS[step.tool](acquired.image, rect, step, pgm.program, acquired));
        } catch (error) {
          result = { status: 'ERROR', value: null, text: error.message };
        }
      }
      result.ms = performance.now() - t0;
      result.rect = rect;
      results[step.id] = result;
      if (step.tool === 'pattern' && step.params.locator === 'yes') {
        if (result.status === 'PASS') offset = { dx: offset.dx + result.offset.dx, dy: offset.dy + result.offset.dy };
        else lostPart = step.name;
      }
    }
    const statuses = Object.values(results).map((r) => r.status);
    overall = statuses.includes('ERROR') ? 'ERROR' : statuses.includes('FAIL') ? 'FAIL' : 'PASS';
    if (lostPart && overall === 'PASS') overall = 'FAIL';
  } catch (error) {
    overall = 'ERROR';
    showToast(`Inspection error: ${error.message}`, 'error');
  }
  const cycle = (performance.now() - started) / 1000;
  pgm.lastResults = results;
  renderOverlay();
  renderStepList();
  renderEditor();
  showOverall(overall, results, cycle, source, record);
  return { overall, results, cycle };
}

function showOverall(overall, results, cycle, source, record) {
  const cls = overall.toLowerCase();
  pe.overall.className = `result-indicator ${cls}`;
  pe.overall.querySelector('strong').innerHTML = `<i></i> ${overall}`;
  els.cameraMode.textContent = `${source} · ${overall}`;
  if (!record) return;

  const id = padPart(++state.part);
  state.total += 1;
  if (overall !== 'PASS') state.fails += 1;
  refreshMetrics(Math.max(cycle, 0.01));
  els.partId.textContent = id;
  els.elapsed.textContent = `${cycle.toFixed(2)} sec`;

  const version = versionLabel();
  pe.resultPill.textContent = overall;
  pe.resultPill.className = `pass-pill ${cls}`;
  pe.resultPart.textContent = id;
  pe.resultMeta.textContent = `${clock()} · ${pgm.program.product} · ${source.toLowerCase()}`;
  pe.resultCycle.textContent = `${cycle.toFixed(2)}s`;
  pe.resultChecks.innerHTML = pgm.program.steps.map((step, index) => {
    const r = results[step.id] || { status: 'ERROR', text: 'Not run' };
    const def = TOOLS[step.tool];
    const limits = `${step.criteria.min} – ${step.criteria.max} ${def.unit}`;
    const detail = r.label || (r.value !== null && r.value !== undefined) ? `${escapeHtml(resultLabel(step, r))} <em>${limits}</em>` : escapeHtml(r.text);
    const mark = { PASS: '✓', FAIL: '×', ERROR: '!', SKIPPED: '–' }[r.status];
    return `<div class="check ${r.status.toLowerCase()}"><span class="check-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(step.name)}</strong><small>${detail}</small></div><b>${r.status}</b><i>${mark}</i></div>`;
  }).join('');

  const chip = overall === 'PASS' ? 'pass-chip' : 'fail-chip';
  const row = document.createElement('tr');
  row.innerHTML = `<td>${clock()}</td><td><strong>${id}</strong></td><td><span class="result-chip ${chip}">● ${overall}</span></td><td>${version}</td><td>${cycle.toFixed(2)}s</td><td><button aria-label="View part ${id}">›</button></td>`;
  els.table.prepend(row);
  if (els.table.children.length > 4) els.table.lastElementChild.remove();
  const enabledSteps = pgm.program.steps.filter((step) => step.enabled);
  const passed = enabledSteps.filter((step) => results[step.id]?.status === 'PASS').length;
  // Name the first failing steps so the operator can see why without opening the details.
  const problems = enabledSteps
    .filter((step) => results[step.id] && ['FAIL', 'ERROR'].includes(results[step.id].status))
    .slice(0, 2)
    .map((step) => `${step.name}: ${resultLabel(step, results[step.id])}`);
  const skipped = enabledSteps.filter((step) => results[step.id]?.status === 'SKIPPED').length;
  const why = problems.length ? ` · ${problems.join(' · ')}${skipped ? ` · ${skipped} skipped` : ''}` : '';
  showToast(`${id}: ${overall} · ${passed}/${enabledSteps.length} steps passed${why}`, overall === 'PASS' ? '' : 'error');
}

/* ---------- Rendering ---------- */

const versionLabel = () => `v${pgm.program.version}${pgm.dirty ? '*' : ''}`;

function renderHeader() {
  pe.product.textContent = pgm.program.product;
  pe.version.textContent = `v${pgm.program.version}`;
  pe.state.textContent = pgm.dirty ? 'DRAFT · UNSAVED' : 'APPROVED';
  pe.state.classList.toggle('draft', pgm.dirty);
  if (pe.statusRecipe) pe.statusRecipe.textContent = `Recipe ${versionLabel()}`;
  pe.pxPerMm.value = pgm.program.pxPerMm;
  const locked = !canEdit();
  pe.card.classList.toggle('locked', locked);
  pe.permissionNote.hidden = !locked;
  // Static controls follow the role both ways; re-rendered controls only need locking.
  [pe.pxPerMm, pe.reason, pe.save, pe.revert].forEach((control) => { control.disabled = locked; });
  if (locked) {
    pe.card.querySelectorAll('.tool-library button, .step-order button, .step-remove, .step-editor input, .step-editor select, .step-editor button[data-edit]')
      .forEach((control) => { control.disabled = true; });
  }
}

function renderLibrary() {
  const groups = {};
  Object.entries(TOOLS).forEach(([key, tool]) => { (groups[tool.group] ||= []).push([key, tool]); });
  pe.library.innerHTML = Object.entries(groups).map(([group, tools]) => `
    <div class="tool-group"><span class="eyebrow">${group.toUpperCase()}</span>
      ${tools.map(([key, tool]) => `<button type="button" class="tool-tile" data-tool="${key}" title="${escapeHtml(tool.summary)}">
        <i>${tool.icon}</i><span><strong>${tool.label}</strong><small>${tool.refs}</small></span><b>+</b></button>`).join('')}
    </div>`).join('');
}

function statusChip(result) {
  if (!result) return '<span class="step-status">NOT RUN</span>';
  return `<span class="step-status ${result.status.toLowerCase()}">${result.status}</span>`;
}

function renderStepList() {
  const steps = pgm.program.steps;
  pe.stepCount.textContent = `${steps.filter((s) => s.enabled).length}/${steps.length} enabled`;
  pe.stepList.innerHTML = steps.map((step, index) => {
    const tool = TOOLS[step.tool];
    const result = pgm.lastResults[step.id];
    const value = result && (result.label || (result.value !== null && result.value !== undefined)) ? escapeHtml(resultLabel(step, result)) : '';
    return `<li class="${step.id === pgm.selectedId ? 'selected' : ''} ${step.enabled ? '' : 'disabled'}">
      <button type="button" class="step-select" data-select="${step.id}">
        <span class="step-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="step-name"><strong>${escapeHtml(step.name)}</strong><small>${tool.icon} ${tool.label}${value ? ` · ${value}` : ''}</small></span>
        ${step.enabled ? statusChip(result) : '<span class="step-status">OFF</span>'}
      </button>
      <span class="step-order">
        <button type="button" data-move="-1" data-id="${step.id}" aria-label="Move ${escapeHtml(step.name)} up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" data-move="1" data-id="${step.id}" aria-label="Move ${escapeHtml(step.name)} down" ${index === steps.length - 1 ? 'disabled' : ''}>▼</button>
      </span>
      <button type="button" class="step-remove" data-remove="${step.id}" aria-label="Remove ${escapeHtml(step.name)}" title="Remove step">×</button>
    </li>`;
  }).join('') || '<li class="empty">No steps yet. Add a tool from the library.</li>';
  renderHeader();
}

function paramField(step, param) {
  const value = step.params[param.key];
  if (param.type === 'select') {
    const options = typeof param.options === 'function' ? param.options(step) : param.options;
    return `<label>${param.label}<select data-param="${param.key}">${options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>`;
  }
  return `<label>${param.label}<input type="number" data-param="${param.key}" value="${value}" min="${param.min}" max="${param.max}" step="${param.step}" /></label>`;
}

function learnFieldset(step) {
  const n = step.reference?.samples?.length || 0;
  const status = n >= AI_MIN_SAMPLES
    ? `<span class="taught">${n} good part${n === 1 ? '' : 's'} learned${n < 20 ? ' · 20 recommended' : ''}</span>`
    : `<span class="untaught">${n} of at least ${AI_MIN_SAMPLES} good parts learned</span>`;
  return `<fieldset><legend>Learn good parts</legend>
    <div class="teach-row">${status}</div>
    <div class="learn-actions">
      <button type="button" class="secondary-button" data-edit="learn">Learn good part</button>
      <button type="button" class="secondary-button" data-edit="learn10">Learn 10 frames</button>
      <button type="button" class="danger-link" data-edit="clearLearn" ${n ? '' : 'disabled'}>Clear</button>
    </div>
    <small class="field-hint">Show only GOOD parts while learning, placed as they will be in production. <b>Learn 10 frames</b> captures 10 images about 0.4 s apart: change or reposition the good part between frames. Up to ${AI_MAX_SAMPLES} parts.</small>
  </fieldset>`;
}

function enrollFieldset(step) {
  const people = step.reference?.people || [];
  return `<fieldset><legend>Enrolled people</legend>
    <ul class="people">${people.map((p) => `<li><span>${escapeHtml(p.name)} <small>${p.descriptors.length} sample${p.descriptors.length === 1 ? '' : 's'}</small></span><span class="person-actions"><button type="button" class="text-button" data-edit="enroll" data-name="${escapeHtml(p.name)}">+ Sample</button><button type="button" class="danger-link" data-edit="unenroll" data-name="${escapeHtml(p.name)}">Remove</button></span></li>`).join('') || '<li class="empty">No one enrolled yet.</li>'}</ul>
    <div class="enroll-row"><input type="text" id="enrollName" placeholder="Person name" maxlength="30" aria-label="Person name" /><button type="button" class="secondary-button" data-edit="enroll">Enroll face</button></div>
    <small class="field-hint">Type a new person’s name and select Enroll face. Use + Sample to add 2–3 samples per person (slightly different angles) for reliable recognition. If several people are in view, the closest face is enrolled. Only a numeric face signature is stored, not the image.</small>
  </fieldset>`;
}

function renderEditor() {
  const step = stepById(pgm.selectedId);
  if (!step) {
    pe.editor.innerHTML = '<div class="editor-empty"><strong>No step selected</strong><p>Select an inspection step to configure its tool, ROI, and pass criteria, or add a new tool from the library.</p></div>';
    renderHeader();
    return;
  }
  const tool = TOOLS[step.tool];
  const result = pgm.lastResults[step.id];
  const pct = (v) => (v * 100).toFixed(1);
  const taught = step.reference?.taughtAt ? `Taught ${new Date(step.reference.taughtAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : 'Not taught';
  pe.editor.innerHTML = `
    <div class="editor-head">
      <span class="tool-badge">${tool.icon} ${tool.label}</span>
      <label class="toggle"><input type="checkbox" data-field="enabled" ${step.enabled ? 'checked' : ''} /> Enabled</label>
    </div>
    <p class="tool-summary">${tool.summary}</p>
    <label>Step name<input type="text" data-field="name" value="${escapeHtml(step.name)}" maxlength="40" /></label>

    <fieldset>
      <legend>Region of interest <small>% of image</small></legend>
      <div class="roi-fields">
        ${['x', 'y', 'w', 'h'].map((k) => `<label>${{ x: 'X', y: 'Y', w: 'Width', h: 'Height' }[k]}<input type="number" data-roi="${k}" value="${pct(step.roi[k])}" min="0" max="100" step="0.1" /></label>`).join('')}
      </div>
      <label>ROI position<select data-field="fixed">
        <option value="follow" ${step.fixed ? '' : 'selected'}>Follows part locator</option>
        <option value="fixed" ${step.fixed ? 'selected' : ''}>Fixed in image (runs even if the part is not located)</option>
      </select></label>
      <button type="button" class="secondary-button" data-edit="draw">Draw ROI on image</button>
    </fieldset>

    ${tool.params.length ? `<fieldset><legend>Tool parameters</legend><div class="param-fields">${tool.params.map((p) => paramField(step, p)).join('')}</div></fieldset>` : ''}

    ${tool.enroll ? enrollFieldset(step) : ''}
    ${tool.learn ? learnFieldset(step) : ''}

    ${tool.teach ? `<fieldset><legend>Reference</legend><div class="teach-row"><span class="${step.reference ? 'taught' : 'untaught'}">${taught}</span><button type="button" class="secondary-button" data-edit="teach">Teach reference</button></div><small class="field-hint">Teaching stores the current ROI contents from the image in the camera view.</small></fieldset>` : ''}

    <fieldset>
      <legend>Pass criteria</legend>
      <div class="criteria-fields">
        <label>Minimum<input type="number" data-criteria="min" value="${step.criteria.min}" step="any" /></label>
        <label>Maximum<input type="number" data-criteria="max" value="${step.criteria.max}" step="any" /></label>
        <span class="unit">${tool.unit}</span>
      </div>
    </fieldset>

    <div class="measurement ${result ? result.status.toLowerCase() : ''}">
      <span>LAST MEASUREMENT</span>
      <strong>${result ? escapeHtml(resultLabel(step, result)) : '—'}</strong>
      <small>${result ? `${escapeHtml(result.text)}${result.ms !== undefined ? ` · ${result.ms.toFixed(1)} ms` : ''}` : 'Run the inspection to measure this step.'}</small>
    </div>

    <div class="editor-actions">
      <button type="button" class="danger-link" data-edit="delete">Delete step</button>
      <button type="button" class="secondary-button" data-edit="duplicate">Duplicate</button>
      <button type="button" class="primary-button" data-test="1">Test program</button>
    </div>
    <p class="tool-refs">Equivalent tools: ${tool.refs}</p>`;
  renderHeader();
}

function renderOverlay() {
  pe.roiLayer.innerHTML = pgm.program.steps.map((step, index) => {
    if (!step.enabled) return '';
    const result = pgm.lastResults[step.id];
    const rect = result?.rect;
    const box = rect
      ? { x: rect.x / ANALYSIS_WIDTH, y: rect.y / ANALYSIS_HEIGHT, w: rect.w / ANALYSIS_WIDTH, h: rect.h / ANALYSIS_HEIGHT }
      : step.roi;
    const cls = [result ? result.status.toLowerCase() : '', step.id === pgm.selectedId ? 'selected' : ''].join(' ');
    const value = result && (result.label || (result.value !== null && result.value !== undefined)) ? ` · ${escapeHtml(resultLabel(step, result).toUpperCase())}` : '';
    return `<div class="roi ${cls}" data-select="${step.id}" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%">
      <span>${String(index + 1).padStart(2, '0')}</span><small>${escapeHtml(step.name.toUpperCase())}${value}</small></div>`;
  }).join('') + pgm.program.steps.filter((step) => step.enabled && pgm.lastResults[step.id]?.heatmap).map((step) => {
    const { rect, heatmap } = pgm.lastResults[step.id];
    return `<img class="heatmap" alt="" src="${heatmap}" style="left:${(rect.x / ANALYSIS_WIDTH) * 100}%;top:${(rect.y / ANALYSIS_HEIGHT) * 100}%;width:${(rect.w / ANALYSIS_WIDTH) * 100}%;height:${(rect.h / ANALYSIS_HEIGHT) * 100}%" />`;
  }).join('') + pgm.program.steps.flatMap((step) => pgm.lastResults[step.id]?.faces || []).map((face) => `
    <div class="face-box ${face.recognised ? 'known' : 'unknown'}" style="left:${face.box.x * 100}%;top:${face.box.y * 100}%;width:${face.box.w * 100}%;height:${face.box.h * 100}%">
      <b>${escapeHtml(face.recognised ? `${face.name} ${face.confidence.toFixed(0)}%` : 'Unknown')}</b></div>`).join('');
}

function renderAudit() {
  pe.auditCount.textContent = pgm.audit.length ? `(${pgm.audit.length})` : '';
  pe.auditList.innerHTML = pgm.audit.slice().reverse().map((entry) => `
    <li><time>${new Date(entry.time).toLocaleString('en-GB')}</time>
      <strong>${escapeHtml(entry.user)} · ${escapeHtml(entry.action)}</strong>
      <span>${escapeHtml(entry.object)}: ${escapeHtml(entry.oldValue)} → ${escapeHtml(entry.newValue)}</span>
      <small>Reason: ${escapeHtml(entry.reason)}${entry.changes?.length ? ` · ${escapeHtml(entry.changes.join('; '))}` : ''}</small></li>`).join('')
    || '<li class="empty">No recipe changes recorded yet.</li>';
}

function renderAll() {
  renderLibrary();
  renderStepList();
  renderEditor();
  renderOverlay();
  renderAudit();
}

/* ---------- Editing ---------- */

function markDirty() {
  pgm.dirty = true;
  pgm.lastResults = {};
  renderStepList();
  renderOverlay();
}

function addStep(toolKey) {
  const tool = TOOLS[toolKey];
  const count = pgm.program.steps.filter((s) => s.tool === toolKey).length + 1;
  // Face ID looks at the whole view by default; other tools start with a central ROI to be redrawn.
  const roi = tool.enroll ? { x: 0, y: 0, w: 1, h: 1 } : tool.learn ? { x: 0.12, y: 0.22, w: 0.76, h: 0.58 } : { x: 0.40, y: 0.35, w: 0.20, h: 0.30 };
  const step = makeStep(toolKey, `${tool.label} ${count}`, roi);
  pgm.program.steps.push(step);
  pgm.selectedId = step.id;
  markDirty();
  renderEditor();
  if (tool.enroll) preloadFaceModels();
  if (tool.learn) loadAiModel().catch(() => { /* reported when learning or running */ });
  if (tool.enroll) {
    const nameInput = pe.editor.querySelector('#enrollName');
    nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameInput.focus({ preventScroll: true });
    showToast(`${tool.label} added. Type a name under Enrolled people, face the camera, and select Enroll face.`);
  } else {
    pe.editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(`${tool.label} added. Draw its ROI on the image, then set the pass criteria.`);
  }
}

function selectStep(id) {
  pgm.selectedId = id;
  renderStepList();
  renderEditor();
  renderOverlay();
}

async function teachSelected() {
  const step = stepById(pgm.selectedId);
  try {
    const { image, source } = await acquireImage();
    teachStep(step, image);
    markDirty();
    renderEditor();
    showToast(`Reference taught for “${step.name}” from ${source.toLowerCase()}.`);
  } catch (error) {
    showToast(`Teach failed: ${error.message}`, 'error');
  }
}

// Enrolls a face sample for `presetName` (the "+ Sample" button) or the name typed in the field.
const learnSelected = (frames) => exclusive(() => learnOnce(frames));

async function learnOnce(frames) {
  const step = stepById(pgm.selectedId);
  const buttons = pe.editor.querySelectorAll('[data-edit="learn"], [data-edit="learn10"]');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    step.reference ||= {};
    step.reference.samples ||= [];
    const room = AI_MAX_SAMPLES - step.reference.samples.length;
    if (room <= 0) throw new Error(`Already ${AI_MAX_SAMPLES} parts learned. Select Clear to start again.`);
    const count = Math.min(frames, room);
    for (let i = 0; i < count; i += 1) {
      if (i) await new Promise((resolve) => window.setTimeout(resolve, 400));
      const acquired = await acquireImage();
      const rect = roiRect(step.roi);
      if (rect.w < 8 || rect.h < 8) throw new Error('ROI is too small or outside the image.');
      const encoded = encodeSample(await extractPatchFeatures(acquired, rect));
      if (step.reference.samples.length && atob(step.reference.samples[0]).length !== atob(encoded).length) {
        throw new Error('The ROI size changed since the first learned part. Select Clear and learn again.');
      }
      step.reference.samples.push(encoded);
      pe.editor.querySelector('[data-edit="learn10"]').textContent = count > 1 ? `Learning ${i + 1}/${count}…` : 'Learn 10 frames';
    }
    if (step.reference.samples.length >= AI_MIN_SAMPLES) step.reference.threshold = learnThreshold(step.reference.samples);
    step.reference.taughtAt = new Date().toISOString();
    markDirty();
    renderEditor();
    const n = step.reference.samples.length;
    const outliers = step.reference.threshold?.outliers || [];
    if (outliers.length) showToast(`Learned ${n} parts, but part${outliers.length > 1 ? 's' : ''} ${outliers.map((i) => i + 1).join(', ')} looked very different from the others and ${outliers.length > 1 ? 'were' : 'was'} ignored for the limit. If a bad part was shown, select Clear and learn again.`, 'error');
    else showToast(n >= AI_MIN_SAMPLES ? `Learned ${n} good parts. Run the inspection to score new parts.` : `Learned ${n} good part${n === 1 ? '' : 's'}; at least ${AI_MIN_SAMPLES} needed.`);
  } catch (error) {
    showToast(`Learning failed: ${error.message}`, 'error');
    renderEditor();
  }
}

const enrollSelected = (presetName) => exclusive(() => enrollOnce(presetName));

async function enrollOnce(presetName) {
  const step = stepById(pgm.selectedId);
  const input = pe.editor.querySelector('#enrollName');
  const name = (presetName || input.value).trim();
  if (!name) { input.focus(); showToast('Enter the person’s name before enrolling.', 'error'); return; }
  pe.editor.querySelectorAll('[data-edit="enroll"]').forEach((b) => { b.disabled = true; });
  const button = presetName ? pe.editor.querySelector(`[data-edit="enroll"][data-name="${CSS.escape(presetName)}"]`) : pe.editor.querySelector('.enroll-row [data-edit="enroll"]');
  if (button) button.textContent = 'Enrolling…';
  try {
    const acquired = await acquireImage();
    if (acquired.source === 'SIMULATION') throw new Error('The camera is not connected. Select Configure camera → Connect camera first.');
    const rect = roiRect(step.roi);
    if (rect.w < 4 || rect.h < 4) throw new Error('ROI is outside the image.');
    const faces = (await detectFaces(acquired, rect)).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
    if (!faces.length) throw new Error('No face found in the ROI. Face the camera, move a little closer, and make sure your face is well lit.');
    // With several people in view, enroll the clearly closest (largest) face; refuse when it is ambiguous.
    if (faces.length > 1 && faces[0].box.w * faces[0].box.h < 2 * faces[1].box.w * faces[1].box.h) {
      throw new Error(`${faces.length} faces of similar size found; only the person being enrolled should be in the ROI.`);
    }
    const face = faces[0];
    if (face.sizePx < 90) throw new Error('Face too small for a good sample. Move closer so your face fills more of the view.');
    if (face.score < 0.6) throw new Error('Face not clear enough for a good sample. Face the camera directly with good, even lighting.');
    step.reference ||= { people: [] };
    step.reference.people ||= [];
    let person = step.reference.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!person) { person = { name, descriptors: [] }; step.reference.people.push(person); }
    person.descriptors.push(Array.from(face.descriptor, (v) => Number(v.toFixed(5))));
    step.reference.taughtAt = new Date().toISOString();
    markDirty();
    // Show which face was enrolled on the camera view.
    pgm.lastResults[step.id] = { status: 'PASS', value: 100, label: `Enrolled ${person.name}`, text: 'Enrolled face sample', faces: [{ box: face.box, name: person.name, confidence: 100, recognised: true }] };
    renderOverlay();
    renderStepList();
    renderEditor();
    const n = person.descriptors.length;
    const extra = faces.length > 1 ? ' (closest of several faces)' : '';
    showToast(`Enrolled ${person.name}${extra}: ${n} sample${n === 1 ? '' : 's'}.${n < 3 ? ' Turn your head slightly and select + Sample to add another.' : ' Save a new version to keep it.'}`);
  } catch (error) {
    showToast(`Enroll failed: ${error.message}`, 'error');
    renderEditor();
    // Keep the typed name so the person can simply try again.
    if (!presetName) pe.editor.querySelector('#enrollName').value = name;
  }
}

function describeChanges(before, after) {
  const changes = [];
  const oldSteps = new Map(before.steps.map((s) => [s.id, s]));
  const newIds = new Set(after.steps.map((s) => s.id));
  if (before.pxPerMm !== after.pxPerMm) changes.push(`calibration ${before.pxPerMm} → ${after.pxPerMm} px/mm`);
  after.steps.forEach((step) => {
    const old = oldSteps.get(step.id);
    if (!old) { changes.push(`added “${step.name}” (${TOOLS[step.tool].label})`); return; }
    if (old.name !== step.name) changes.push(`renamed “${old.name}” → “${step.name}”`);
    if (old.enabled !== step.enabled) changes.push(`${step.enabled ? 'enabled' : 'disabled'} “${step.name}”`);
    if (old.criteria.min !== step.criteria.min || old.criteria.max !== step.criteria.max) changes.push(`“${step.name}” limits ${old.criteria.min}–${old.criteria.max} → ${step.criteria.min}–${step.criteria.max}`);
    if (JSON.stringify(old.roi) !== JSON.stringify(step.roi)) changes.push(`“${step.name}” ROI moved`);
    if (JSON.stringify(old.params) !== JSON.stringify(step.params)) changes.push(`“${step.name}” parameters changed`);
    if (old.fixed !== step.fixed) changes.push(`“${step.name}” ROI ${step.fixed ? 'fixed in image' : 'follows locator'}`);
    if (JSON.stringify(old.reference?.people?.map((p) => p.name)) !== JSON.stringify(step.reference?.people?.map((p) => p.name))) changes.push(`“${step.name}” enrolled people: ${(step.reference?.people || []).map((p) => p.name).join(', ') || 'none'}`);
    else if ((old.reference?.samples?.length || 0) !== (step.reference?.samples?.length || 0)) changes.push(`“${step.name}” learned good parts ${old.reference?.samples?.length || 0} → ${step.reference?.samples?.length || 0}`);
    else if (old.reference?.taughtAt !== step.reference?.taughtAt) changes.push(`“${step.name}” reference re-taught`);
  });
  before.steps.forEach((step) => { if (!newIds.has(step.id)) changes.push(`removed “${step.name}”`); });
  if (before.steps.map((s) => s.id).filter((id) => newIds.has(id)).join() !== after.steps.map((s) => s.id).filter((id) => oldSteps.has(id)).join()) changes.push('step order changed');
  return changes;
}

function saveVersion() {
  if (!pgm.dirty) { showToast('No changes to save.'); return; }
  const reason = pe.reason.value.trim();
  if (!reason) { pe.reason.focus(); showToast('Enter a reason for the change before saving a new version.', 'error'); return; }
  const invalid = pgm.program.steps.find((s) => !(s.criteria.min <= s.criteria.max));
  if (invalid) { showToast(`“${invalid.name}”: minimum must not exceed maximum.`, 'error'); return; }
  const oldVersion = pgm.approved.version;
  const [major, minor] = oldVersion.split('.').map(Number);
  pgm.program.version = `${major}.${minor + 1}`;
  pgm.audit.push({
    time: new Date().toISOString(),
    user: `Sakthi M. (${pe.role.selectedOptions[0].textContent})`,
    action: 'ModifyRecipe',
    object: `${pgm.program.product} recipe`,
    oldValue: `v${oldVersion}`,
    newValue: `v${pgm.program.version}`,
    reason,
    changes: describeChanges(pgm.approved, pgm.program),
  });
  pgm.approved = clone(pgm.program);
  pgm.dirty = false;
  pe.reason.value = '';
  persist();
  renderAll();
  showToast(`Recipe saved as v${pgm.program.version}. Change recorded in the audit trail.`);
}

function revertChanges() {
  if (!pgm.dirty) return;
  pgm.program = clone(pgm.approved);
  pgm.dirty = false;
  pgm.lastResults = {};
  if (!stepById(pgm.selectedId)) pgm.selectedId = pgm.program.steps[0]?.id ?? null;
  renderAll();
  showToast(`Changes discarded. Recipe v${pgm.program.version} restored.`);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ program: pgm.approved, audit: pgm.audit }));
  } catch {
    showToast('Recipe saved for this session only; browser storage is unavailable.', 'error');
  }
}

function loadStored() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored?.program?.steps) return stored;
  } catch { /* fall back to the default program */ }
  return null;
}

/* ---------- ROI drawing on the camera view ---------- */

function startDrawing() {
  if (!pgm.selectedId) return;
  pgm.drawing = true;
  els.cameraFrame.classList.add('drawing');
  pe.drawHint.hidden = false;
  els.cameraFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function stopDrawing() {
  pgm.drawing = false;
  els.cameraFrame.classList.remove('drawing');
  pe.drawHint.hidden = true;
  pe.roiLayer.querySelector('.roi.draft')?.remove();
}

function framePoint(event) {
  const r = els.cameraFrame.getBoundingClientRect();
  return { x: clamp((event.clientX - r.left) / r.width, 0, 1), y: clamp((event.clientY - r.top) / r.height, 0, 1) };
}

let dragStart = null;
els.cameraFrame.addEventListener('pointerdown', (event) => {
  if (!pgm.drawing) return;
  event.preventDefault();
  dragStart = framePoint(event);
  els.cameraFrame.setPointerCapture(event.pointerId);
  const draft = document.createElement('div');
  draft.className = 'roi draft';
  pe.roiLayer.append(draft);
});
els.cameraFrame.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  const p = framePoint(event);
  const draft = pe.roiLayer.querySelector('.roi.draft');
  Object.assign(draft.style, {
    left: `${Math.min(p.x, dragStart.x) * 100}%`, top: `${Math.min(p.y, dragStart.y) * 100}%`,
    width: `${Math.abs(p.x - dragStart.x) * 100}%`, height: `${Math.abs(p.y - dragStart.y) * 100}%`,
  });
});
els.cameraFrame.addEventListener('pointerup', (event) => {
  if (!dragStart) return;
  const p = framePoint(event);
  const roi = { x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) };
  dragStart = null;
  stopDrawing();
  if (roi.w < 0.01 || roi.h < 0.01) { showToast('ROI too small. Drag a larger area.', 'error'); return; }
  const step = stepById(pgm.selectedId);
  step.roi = Object.fromEntries(Object.entries(roi).map(([k, v]) => [k, Number(v.toFixed(4))]));
  markDirty();
  renderEditor();
  pe.editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const needsTeach = TOOLS[step.tool].teach ? ' Teach the reference again for the new ROI.' : '';
  showToast(`ROI set for “${step.name}”.${needsTeach}`);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && pgm.drawing) { dragStart = null; stopDrawing(); } });

/* ---------- Events ---------- */

pe.library.addEventListener('click', (event) => {
  const tile = event.target.closest('[data-tool]');
  if (tile && canEdit()) addStep(tile.dataset.tool);
});

function removeStep(id) {
  const index = pgm.program.steps.findIndex((s) => s.id === id);
  const [removed] = pgm.program.steps.splice(index, 1);
  if (pgm.selectedId === id) pgm.selectedId = (pgm.program.steps[index] || pgm.program.steps[index - 1])?.id ?? null;
  markDirty();
  renderEditor();
  showToast(`“${removed.name}” removed. Save a new version to keep this change, or Discard changes to undo.`);
}

pe.stepList.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    if (canEdit()) removeStep(remove.dataset.remove);
    return;
  }
  const move = event.target.closest('[data-move]');
  if (move) {
    if (!canEdit()) return;
    const steps = pgm.program.steps;
    const index = steps.findIndex((s) => s.id === move.dataset.id);
    const target = index + Number(move.dataset.move);
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    markDirty();
    renderEditor();
    return;
  }
  const select = event.target.closest('[data-select]');
  if (select) selectStep(select.dataset.select);
});

pe.roiLayer.addEventListener('click', (event) => {
  const roi = event.target.closest('[data-select]');
  if (roi && !pgm.drawing) selectStep(roi.dataset.select);
});

pe.editor.addEventListener('change', (event) => {
  const step = stepById(pgm.selectedId);
  const input = event.target;
  if (!step || !canEdit()) return;
  if (input.dataset.field === 'enabled') step.enabled = input.checked;
  else if (input.dataset.field === 'name') step.name = input.value.trim() || TOOLS[step.tool].label;
  else if (input.dataset.field === 'fixed') step.fixed = input.value === 'fixed';
  else if (input.dataset.roi) step.roi[input.dataset.roi] = clamp(Number(input.value) / 100, 0, 1);
  else if (input.dataset.criteria) step.criteria[input.dataset.criteria] = Number(input.value);
  else if (input.dataset.param) {
    const param = TOOLS[step.tool].params.find((p) => p.key === input.dataset.param);
    step.params[param.key] = param.type === 'number' ? clamp(Number(input.value), param.min, param.max) : input.value;
  } else return;
  markDirty();
  renderEditor();
});

pe.editor.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.test) { runProgram({ record: false }); return; }
  if (!canEdit()) return;
  const step = stepById(pgm.selectedId);
  const action = button.dataset.edit;
  if (action === 'draw') startDrawing();
  if (action === 'teach') teachSelected();
  if (action === 'enroll') enrollSelected(button.dataset.name);
  if (action === 'learn') learnSelected(1);
  if (action === 'learn10') learnSelected(10);
  if (action === 'clearLearn') {
    step.reference = null;
    markDirty();
    renderEditor();
    showToast(`Learned parts cleared for “${step.name}”.`);
  }
  if (action === 'unenroll') {
    step.reference.people = step.reference.people.filter((p) => p.name !== button.dataset.name);
    if (step.params.expected === `person:${button.dataset.name}`) step.params.expected = 'anyEnrolled';
    markDirty();
    renderEditor();
    showToast(`${button.dataset.name} removed from “${step.name}”.`);
  }
  if (action === 'duplicate') {
    const copy = { ...clone(step), id: newId(), name: `${step.name} copy` };
    pgm.program.steps.splice(pgm.program.steps.indexOf(step) + 1, 0, copy);
    pgm.selectedId = copy.id;
    markDirty();
    renderEditor();
  }
  if (action === 'delete') removeStep(step.id);
});

pe.pxPerMm.addEventListener('change', () => {
  const value = Number(pe.pxPerMm.value);
  if (!(value > 0) || !canEdit()) { pe.pxPerMm.value = pgm.program.pxPerMm; return; }
  pgm.program.pxPerMm = value;
  markDirty();
});

pe.role.addEventListener('change', () => {
  pgm.role = pe.role.value;
  if (pgm.drawing) stopDrawing();
  renderAll();
  showToast(canEdit() ? 'Quality engineer: recipe editing enabled.' : 'Operator: recipe is read-only.');
});

pe.save.addEventListener('click', saveVersion);
pe.revert.addEventListener('click', revertChanges);
const defectButton = document.querySelector('#defectButton');
defectButton.addEventListener('click', () => {
  pgm.simDefect = !pgm.simDefect;
  defectButton.setAttribute('aria-pressed', String(pgm.simDefect));
  defectButton.textContent = pgm.simDefect ? 'Defect ON' : 'Add defect';
  updateSimulatedDefect();
  showToast(pgm.simDefect ? 'Simulated part now has a scratch or stain (moves on every inspection).' : 'Simulated part is good again.');
});

pe.run.addEventListener('click', () => runProgram());
pe.inspect.addEventListener('click', () => runProgram());

/* ---------- Start-up ---------- */

async function initProgram() {
  const stored = loadStored();
  if (stored) {
    pgm.program = stored.program;
    pgm.audit = stored.audit || [];
  } else {
    pgm.program = defaultProgram();
    // Teach the pattern and colour references from the simulated part so the demo runs out of the box.
    try {
      const { image } = await acquireImage({ ideal: true });
      pgm.program.steps.filter((s) => TOOLS[s.tool].teach).forEach((s) => teachStep(s, image));
    } catch { /* references stay untaught; those steps report ERROR until taught */ }
  }
  pgm.approved = clone(pgm.program);
  pgm.selectedId = pgm.program.steps[0]?.id ?? null;
  renderAll();
  preloadFaceModels();
}

// Loading and warming up the face models takes several seconds; do it in the background
// when the recipe uses Face ID so the first inspection is not delayed.
function preloadFaceModels() {
  if (!pgm.program.steps.some((step) => step.tool === 'faceId' && step.enabled)) return;
  loadFaceApi().then(() => showToast('Face recognition ready.')).catch(() => { /* reported when a Face ID step runs */ });
}

initProgram();
