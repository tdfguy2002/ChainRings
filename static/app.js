'use strict';

const canvas = document.getElementById('chain-canvas');
const ctx    = canvas.getContext('2d');

let lastResult = null;
let transform  = { ox: 0, oy: 0, scale: 1 };

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  if (lastResult) draw(lastResult);
});

// ---------------------------------------------------------------------------
// Coordinate transform: math space (y-up) → canvas space (y-down)
//   canvas_x = ox + mx * scale
//   canvas_y = oy - my * scale   ← y negated
// ---------------------------------------------------------------------------

function toCanvas(mx, my) {
  return [
    transform.ox + mx * transform.scale,
    transform.oy - my * transform.scale,
  ];
}

function computeTransform(data) {
  const PADDING = 48;

  const R1 = data.ring1.radius;
  const R2 = data.ring2.radius;
  const D  = data.ring2.cx;

  const minX = -R1;
  const maxX = D + R2;
  const maxY = Math.max(R1, R2);

  const sceneW = maxX - minX;
  const sceneH = 2 * maxY;

  const availW = canvas.width  - 2 * PADDING;
  const availH = canvas.height - 2 * PADDING;

  const scale = Math.min(availW / sceneW, availH / sceneH);

  const cx = (minX + maxX) / 2;

  transform = {
    ox: canvas.width  / 2 - cx * scale,
    oy: canvas.height / 2,             // y=0 is the horizontal centerline
    scale,
  };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawPitchCircle(cx, cy, r) {
  const [ccx, ccy] = toCanvas(cx, cy);
  const rs = r * transform.scale;
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#336688';
  ctx.lineWidth   = 1.5;
  ctx.arc(ccx, ccy, rs, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawTeeth(ringData, anglesArray) {
  const [ccx, ccy] = toCanvas(ringData.cx, ringData.cy);
  const rs      = ringData.radius * transform.scale;
  const tickLen = Math.max(4, rs * 0.065);

  ctx.save();
  ctx.strokeStyle = '#5599cc';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  for (const mathAngle of anglesArray) {
    // Negate math angle for y-flip (CCW math → CW canvas)
    const ca  = -mathAngle;
    const cos = Math.cos(ca);
    const sin = Math.sin(ca);
    ctx.moveTo(ccx + (rs - tickLen) * cos, ccy + (rs - tickLen) * sin);
    ctx.lineTo(ccx + (rs + tickLen) * cos, ccy + (rs + tickLen) * sin);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw the chain path as a single continuous path:
//   arc1 (ring1, CCW long arc)
//   → upper span (P_top_1 → P_top_2)
//   → arc2 (ring2, CW short arc)
//   → lower span (P_bot_2 → P_bot_1)
//
// Y-flip rules:
//   - angle passed to canvas.arc() = -math_angle
//   - counterclockwise flag passed = !arc.counterclockwise
//     (y-flip reverses winding direction)
function drawChainPath(data) {
  const arc1 = data.arcs[0];
  const arc2 = data.arcs[1];

  const [a1cx, a1cy] = toCanvas(arc1.cx, arc1.cy);
  const r1s = arc1.radius * transform.scale;

  const [a2cx, a2cy] = toCanvas(arc2.cx, arc2.cy);
  const r2s = arc2.radius * transform.scale;

  // P_top_2 — end of upper span, start of arc2
  const [t1x2, t1y2] = toCanvas(data.tangents[0].x2, data.tangents[0].y2);
  // P_bot_1 — end of lower span, back to arc1 start
  const [t2x2, t2y2] = toCanvas(data.tangents[1].x2, data.tangents[1].y2);

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#c8a400';
  ctx.lineWidth   = Math.max(2, 4 * Math.min(1, transform.scale / 2));
  ctx.lineJoin    = 'round';

  // Arc 1: ring1, CCW in math → CW in canvas (!counterclockwise)
  ctx.arc(a1cx, a1cy, r1s,
    -arc1.start_angle,
    -arc1.end_angle,
    !arc1.counterclockwise);

  // Upper span: arc1 exit = P_top_1, connect to P_top_2
  ctx.lineTo(t1x2, t1y2);

  // Arc 2: ring2, CW in math → CCW in canvas (!counterclockwise)
  ctx.arc(a2cx, a2cy, r2s,
    -arc2.start_angle,
    -arc2.end_angle,
    !arc2.counterclockwise);

  // Lower span: arc2 exit = P_bot_2, connect to P_bot_1
  ctx.lineTo(t2x2, t2y2);

  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawCenter(cx, cy, label) {
  const [ccx, ccy] = toCanvas(cx, cy);
  const ARM = 8;

  ctx.save();
  ctx.strokeStyle = '#888899';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ccx - ARM, ccy); ctx.lineTo(ccx + ARM, ccy);
  ctx.moveTo(ccx, ccy - ARM); ctx.lineTo(ccx, ccy + ARM);
  ctx.stroke();

  ctx.fillStyle = '#888899';
  ctx.font      = '11px system-ui';
  ctx.fillText(label, ccx + ARM + 4, ccy - ARM);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Master draw
// ---------------------------------------------------------------------------

function draw(data) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  computeTransform(data);

  drawPitchCircle(data.ring1.cx, data.ring1.cy, data.ring1.radius);
  drawPitchCircle(data.ring2.cx, data.ring2.cy, data.ring2.radius);

  drawTeeth(data.ring1, data.teeth_angles.ring1);
  drawTeeth(data.ring2, data.teeth_angles.ring2);

  drawChainPath(data);

  drawCenter(data.ring1.cx, data.ring1.cy, 'R1');
  drawCenter(data.ring2.cx, data.ring2.cy, 'R2');
}

// ---------------------------------------------------------------------------
// API + UI
// ---------------------------------------------------------------------------

async function calculate() {
  const errorEl = document.getElementById('error-msg');
  const statsEl = document.getElementById('stats');

  errorEl.classList.add('hidden');
  statsEl.classList.add('hidden');

  const payload = {
    teeth1:          parseInt(document.getElementById('teeth1').value, 10),
    teeth2:          parseInt(document.getElementById('teeth2').value, 10),
    center_distance: parseFloat(document.getElementById('center_distance').value),
    pitch:           parseFloat(document.getElementById('pitch').value),
  };

  try {
    const response = await fetch('/api/calculate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = data.error || 'Unknown error.';
      errorEl.classList.remove('hidden');
      return;
    }

    lastResult = data;
    draw(data);

    document.getElementById('stat-length').textContent =
      data.chain_length.toFixed(1);
    document.getElementById('stat-links').textContent =
      data.num_links;
    document.getElementById('stat-adj-center').textContent =
      data.adjusted_center.toFixed(2);
    document.getElementById('stat-wrap1').textContent =
      data.wrap_angle1.toFixed(1);
    document.getElementById('stat-wrap2').textContent =
      data.wrap_angle2.toFixed(1);
    statsEl.classList.remove('hidden');

  } catch (err) {
    errorEl.textContent = 'Network error: ' + err.message;
    errorEl.classList.remove('hidden');
  }
}

document.getElementById('calculate-btn').addEventListener('click', calculate);

// Run on load with default values
resizeCanvas();
calculate();
