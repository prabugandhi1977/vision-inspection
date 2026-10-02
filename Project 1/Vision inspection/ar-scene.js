/*
 * Shared AR drawing for the console preview and the projector window (projector.html).
 *
 * Shapes are given in camera-view coordinates: 0–1 across the camera image, the same
 * normalised space as inspection ROIs. Pick bins may lie outside it (y > 1 is the bench in
 * front of the fixture). Each surface supplies a point-mapping function: an affine map on
 * the console, a 4-corner homography on the projector.
 */

const AR_CHANNEL = 'visionforge.ar';
const AR_COLORS = {
  target: '#38e1ff', // where to work now
  pick: '#ffc23d',   // pick-to-light bin
  pass: '#3dff8a',
  fail: '#ff4545',
  error: '#ffb020',
  dim: 'rgba(170, 200, 210, 0.6)',
};
// Default projector corners for the camera view (fractions of the projector image), leaving
// room for the bins below it and the instruction panel at the bottom.
const AR_DEFAULT_CALIBRATION = { corners: [[0.2, 0.05], [0.8, 0.05], [0.8, 0.583], [0.2, 0.583]], panel: 'bottom' };

// Projective map from the unit square (camera view corners TL, TR, BR, BL) to a quadrilateral
// (Heckbert's square-to-quad). Points outside the square are extrapolated, so bins on the
// bench beside the camera view land in the right place too.
function arHomography(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2; const dx2 = x3 - x2; const dy1 = y1 - y2; const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3; const sy = y0 - y1 + y2 - y3;
  let g = 0; let h = 0;
  if (sx || sy) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-12) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  }
  const a = x1 - x0 + g * x1; const b = x3 - x0 + h * x3; const c = x0;
  const d = y1 - y0 + g * y1; const e = y3 - y0 + h * y3; const f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

function arShapePath(ctx, shape, map) {
  const { x, y, w, h } = shape.roi;
  ctx.beginPath();
  if (shape.shape === 'circle') {
    for (let i = 0; i <= 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      const [px, py] = map(x + w / 2 + (Math.cos(a) * w) / 2, y + h / 2 + (Math.sin(a) * h) / 2);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
  } else {
    // A projective map keeps straight lines straight, so the four corners are enough.
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(([u, v], i) => {
      const [px, py] = map(u, v);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
  }
  ctx.closePath();
}

// Draws highlight shapes: { roi, shape: 'box'|'circle', tone, label, pulse, dashed, outline }.
// Highlighted shapes are drawn last so their labels sit on top; `outline` is a thin unfilled frame.
// `scale` sizes lines and text for the surface (1 = console preview).
function arDrawShapes(ctx, shapes, map, { now = performance.now(), scale = 1 } = {}) {
  const quiet = (shape) => shape.tone === 'dim' || shape.outline;
  [...shapes.filter(quiet), ...shapes.filter((shape) => !quiet(shape))].forEach((shape) => {
    const color = AR_COLORS[shape.tone] || AR_COLORS.target;
    const dim = quiet(shape);
    const pulse = shape.pulse ? 0.5 + 0.5 * Math.sin(now / 240) : 1;
    ctx.save();
    arShapePath(ctx, shape, map);
    if (!dim) {
      ctx.globalAlpha = 0.12 + 0.2 * pulse;
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = dim ? 1 : 0.7 + 0.3 * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = (dim ? 1.5 : 2.5 + 2 * pulse) * scale;
    if (shape.dashed) ctx.setLineDash([7 * scale, 6 * scale]);
    ctx.stroke();
    if (shape.label) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const size = 12 * scale;
      ctx.font = `600 ${size}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      const [lx, ly] = map(shape.roi.x, shape.roi.y);
      const text = shape.label;
      const tw = ctx.measureText(text).width + 10 * scale;
      const th = size + 8 * scale;
      const top = Math.max(0, ly - th - 3 * scale);
      ctx.fillStyle = color;
      ctx.fillRect(lx, top, tw, th);
      ctx.fillStyle = '#061217';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx + 5 * scale, top + th / 2 + scale);
    }
    ctx.restore();
  });
}
