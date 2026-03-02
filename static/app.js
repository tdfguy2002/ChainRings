'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const CHAIN_SPEED = 65; // mm/s in model units

// ── Canvas + UI elements ─────────────────────────────────────────────────────
const canvas    = document.getElementById('chain-canvas');
const ctx       = canvas.getContext('2d');
const pauseBtn  = document.getElementById('pause-btn');
const errEl     = document.getElementById('error-msg');
const statsEl   = document.getElementById('stats');

let geo    = null;  // API response (with .pitch added)
let pd     = null;  // precomputed path data (chain arc-length params)
let tf     = { ox: 0, oy: 0, scale: 1 };
let animId = null;
let paused = false;
const anim = { phase: 0, a1: 0, a2: 0, t: null };

// ── Sizing ───────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const el = document.getElementById('canvas-container');
  canvas.width  = el.clientWidth;
  canvas.height = el.clientHeight;
}
window.addEventListener('resize', () => {
  resizeCanvas();
  if (geo && paused) render();
});

// ── Transform: math coords (y-up) → canvas coords (y-down) ──────────────────
function toCanvas(mx, my) {
  return [tf.ox + mx * tf.scale, tf.oy - my * tf.scale];
}

function computeTransform(g) {
  const PAD   = 60;
  const R1    = g.ring1.radius, R2 = g.ring2.radius, D = g.ring2.cx;
  const extra = 0.4 * g.pitch;
  const minX  = -(R1 + extra), maxX = D + R2 + extra;
  const maxY  = Math.max(R1, R2) + extra;
  const sc    = Math.min(
    (canvas.width  - 2 * PAD) / (maxX - minX),
    (canvas.height - 2 * PAD) / (2 * maxY)
  );
  tf = {
    ox:    canvas.width  / 2 - ((minX + maxX) / 2) * sc,
    oy:    canvas.height / 2,
    scale: sc,
  };
}

// ── Chain path precomputation ────────────────────────────────────────────────
// Chain loop order:
//   arc1  (ring1, long wrap, CW in canvas)
//   → upper span (P_top_1 → P_top_2)
//   → arc2  (ring2, short wrap, CW in canvas)
//   → lower span (P_bot_2 → P_bot_1)
//
// Canvas arc angles are negated math angles because y is flipped.
// Arc1 canvas start angle = -arc1.start_angle, goes CW (angle increases).
// Arc2 canvas start angle = -arc2.start_angle, goes CW (angle increases).

function buildPd(g) {
  const phi1 = g.wrap_angle1 * Math.PI / 180;
  const phi2 = g.wrap_angle2 * Math.PI / 180;
  const S1   = g.ring1.radius * phi1;   // arc1 arc-length
  const S3   = g.ring2.radius * phi2;   // arc2 arc-length
  const t0   = g.tangents[0];           // upper span endpoints
  const Ls   = Math.hypot(t0.x2 - t0.x1, t0.y2 - t0.y1);
  pd = {
    R1:  g.ring1.radius,
    R2:  g.ring2.radius,
    S1, S3, Ls,
    total: g.chain_length,
    th1: -g.arcs[0].start_angle,   // canvas start angle of arc1
    th2: -g.arcs[1].start_angle,   // canvas start angle of arc2
  };
}

// Returns {x, y} in canvas pixels at arc-length s along the chain loop.
function chainPoint(g, s) {
  const { R1, R2, S1, S3, Ls, total, th1, th2 } = pd;
  s = ((s % total) + total) % total;
  const sc = tf.scale;

  if (s < S1) {
    // Arc1: ring1
    const [cx, cy] = toCanvas(g.arcs[0].cx, g.arcs[0].cy);
    const a = th1 + s / R1;
    return { x: cx + R1 * sc * Math.cos(a), y: cy + R1 * sc * Math.sin(a) };
  }
  s -= S1;

  if (s < Ls) {
    // Upper span
    const t = s / Ls;
    const [x1, y1] = toCanvas(g.tangents[0].x1, g.tangents[0].y1);
    const [x2, y2] = toCanvas(g.tangents[0].x2, g.tangents[0].y2);
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
  }
  s -= Ls;

  if (s < S3) {
    // Arc2: ring2
    const [cx, cy] = toCanvas(g.arcs[1].cx, g.arcs[1].cy);
    const a = th2 + s / R2;
    return { x: cx + R2 * sc * Math.cos(a), y: cy + R2 * sc * Math.sin(a) };
  }
  s -= S3;

  // Lower span
  const t = s / Ls;
  const [x1, y1] = toCanvas(g.tangents[1].x1, g.tangents[1].y1);
  const [x2, y2] = toCanvas(g.tangents[1].x2, g.tangents[1].y2);
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

// ── Chain rendering ───────────────────────────────────────────────────────────
// Each "plate" is a stadium (capsule) shape between two adjacent roller centres.
// Even-indexed links = outer plates (wider), odd = inner plates (narrower).
function drawStadium(x0, y0, x1, y1, hw, color) {
  const dx  = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const nx = -dy / len, ny = dx / len;    // unit normal
  const a0 = Math.atan2(ny, nx);          // normal angle
  ctx.beginPath();
  ctx.arc(x0, y0, hw, a0,           a0 + Math.PI, false); // left cap
  ctx.lineTo(x1 - nx * hw, y1 - ny * hw);
  ctx.arc(x1, y1, hw, a0 + Math.PI, a0,           false); // right cap
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawChain(g, phase) {
  const N    = g.num_links;
  const step = g.chain_length / N;   // effective pitch in mm
  const sc   = tf.scale;

  // Proportions derived from real 1/2" bicycle chain geometry (fractions of pitch).
  // rollerR < innerHW < outerHW so rollers are framed by the plates, not wider.
  const rollerR = Math.max(1.2, 0.285 * step * sc);
  const innerHW = Math.max(0.8, 0.340 * step * sc);
  const outerHW = Math.max(1.0, 0.385 * step * sc);

  // Pre-compute all joint positions (avoids double-computing shared endpoints)
  const pts = new Array(N);
  for (let i = 0; i < N; i++) pts[i] = chainPoint(g, phase + i * step);

  // 1. Inner plates first — they sit behind the outer plates when viewed from outside
  for (let i = 1; i < N; i += 2) {
    const p0 = pts[i], p1 = pts[(i + 1) % N];
    drawStadium(p0.x, p0.y, p1.x, p1.y, innerHW, '#384858');
  }
  // 2. Outer plates on top
  for (let i = 0; i < N; i += 2) {
    const p0 = pts[i], p1 = pts[(i + 1) % N];
    drawStadium(p0.x, p0.y, p1.x, p1.y, outerHW, '#506070');
  }

  // Rollers (drawn after plates so they sit on top)
  for (let i = 0; i < N; i++) {
    const { x, y } = pts[i];
    ctx.beginPath();
    ctx.arc(x, y, rollerR, 0, Math.PI * 2);
    ctx.fillStyle = '#c08808';
    ctx.fill();
    if (rollerR > 2.0) {
      ctx.strokeStyle = '#7a5500';
      ctx.lineWidth   = Math.max(0.3, 0.55 * sc);
      ctx.stroke();
      // Centre pin
      ctx.beginPath();
      ctx.arc(x, y, rollerR * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1c2a';
      ctx.fill();
    }
  }
}

// ── Chainring rendering ───────────────────────────────────────────────────────
// Tooth profile: pointed tip, straight flanks, smooth curved valley arc.
// Each valley is a circular arc at rRoot — no sharp V-corners.
function buildToothPath(N, rTip, rRoot, rotation) {
  const p    = Math.PI * 2 / N;
  const tw   = 0.30;   // tooth half-width as fraction of pitch angle
  const tcap = 0.08;   // rounded-tip half-width (must be < tw)
  // Shallow valley — control point barely dips below rRoot
  const rCP  = rRoot - 0.12 * (rTip - rRoot);

  ctx.beginPath();

  const sl0 = rotation - p * tw;
  ctx.moveTo(rRoot * Math.cos(sl0), rRoot * Math.sin(sl0));

  for (let i = 0; i < N; i++) {
    const θ      = rotation + i * p;
    const sr     = θ + p * tw;
    const nextSl = θ + p * (1 - tw);
    const θMid   = (sr + nextSl) * 0.5;

    // Left flank up to just before the tip
    ctx.lineTo(rTip * Math.cos(θ - p * tcap), rTip * Math.sin(θ - p * tcap));
    // Rounded tip: quadratic bezier with control point a touch outside rTip
    ctx.quadraticCurveTo(
      rTip * 1.015 * Math.cos(θ), rTip * 1.015 * Math.sin(θ),
      rTip * Math.cos(θ + p * tcap), rTip * Math.sin(θ + p * tcap)
    );
    // Right flank back down
    ctx.lineTo(rRoot * Math.cos(sr), rRoot * Math.sin(sr));
    // Shallow valley
    ctx.quadraticCurveTo(
      rCP * Math.cos(θMid), rCP * Math.sin(θMid),
      rRoot * Math.cos(nextSl), rRoot * Math.sin(nextSl)
    );
  }

  ctx.closePath();
}

function drawRing(ring, N, pitchMM, angle) {
  const [cx, cy] = toCanvas(ring.cx, ring.cy);
  const sc = tf.scale;
  const R  = ring.radius;

  // Geometry (canvas pixels, in local ring-centred coords after translate)
  const rTip       = (R + 0.12 * pitchMM) * sc;   // short, realistic tooth tip
  const rRoot      = (R - 0.28 * pitchMM) * sc;   // roller-radius depth
  const rBody      = rRoot * 0.88;                  // thin solid ring rim
  const rHub       = Math.max(6,   R * 0.22 * sc);
  const rBore      = Math.max(2.5, R * 0.10 * sc);
  const rBCD       = R * 0.62 * sc;
  const rBolt      = Math.max(1.5, R * 0.036 * sc);
  const rArmOuter  = rBody * 1.01;   // arms bleed slightly into ring body for a clean join
  const rArmInner  = rHub  * 1.30;

  const ARMS       = N >= 30 ? 5 : 4;
  const armP       = Math.PI * 2 / ARMS;
  const aHalf      = 0.13;           // arm angular half-width fraction — narrow = large open windows
  // How far each arm side curves into the adjacent window (creates concave window edges)
  const curveBias  = 0.55 * aHalf * armP;

  ctx.save();
  ctx.translate(cx, cy);

  // Machined-aluminium radial gradient: dark at hub → bright silver at outer edge
  const silver = ctx.createRadialGradient(0, 0, rHub * 0.8, 0, 0, rTip);
  silver.addColorStop(0.00, '#5c6878');
  silver.addColorStop(0.30, '#788898');
  silver.addColorStop(0.72, '#a2b2c2');
  silver.addColorStop(1.00, '#ccd8e4');

  // ── 1. Tooth polygon ──────────────────────────────────────────────────────
  ctx.fillStyle = silver;
  buildToothPath(N, rTip, rRoot, angle);
  ctx.fill();

  // ── 2. Thin solid ring rim (rBody → rRoot) ────────────────────────────────
  ctx.fillStyle = silver;
  ctx.beginPath();
  ctx.arc(0, 0, rRoot, 0, Math.PI * 2, false);
  ctx.moveTo(rBody, 0);
  ctx.arc(0, 0, rBody, 0, Math.PI * 2, true);
  ctx.fill('evenodd');

  // ── 3. Dark spider background ─────────────────────────────────────────────
  ctx.fillStyle = '#111418';
  ctx.beginPath();
  ctx.arc(0, 0, rBody, 0, Math.PI * 2);
  ctx.fill();

  // ── 4. Arms (silver over dark background, sides curve into adjacent windows)
  //
  // Each arm side uses a quadratic bezier whose control point is pushed
  // outward past the arm edge (into the neighbouring window).  This makes
  // the arm sides bow convexly outward, giving each window a concave "C"
  // edge — the classic Shimano spider look.
  const rMidArm = (rArmOuter + rArmInner) * 0.5;
  ctx.fillStyle = silver;
  for (let a = 0; a < ARMS; a++) {
    const ac = angle + a * armP;
    const aL = ac - aHalf * armP;
    const aR = ac + aHalf * armP;
    ctx.beginPath();
    // Outer arc (CW from aL to aR)
    ctx.arc(0, 0, rArmOuter, aL, aR, false);
    // Right side → curves into the window to the right of this arm
    ctx.quadraticCurveTo(
      rMidArm * Math.cos(aR + curveBias), rMidArm * Math.sin(aR + curveBias),
      rArmInner * Math.cos(aR),           rArmInner * Math.sin(aR)
    );
    // Inner arc (CCW from aR back to aL)
    ctx.arc(0, 0, rArmInner, aR, aL, true);
    // Left side → curves into the window to the left of this arm
    ctx.quadraticCurveTo(
      rMidArm * Math.cos(aL - curveBias), rMidArm * Math.sin(aL - curveBias),
      rArmOuter * Math.cos(aL),           rArmOuter * Math.sin(aL)
    );
    ctx.closePath();
    ctx.fill();
  }

  // ── 5. Hub ────────────────────────────────────────────────────────────────
  ctx.fillStyle = silver;
  ctx.beginPath();
  ctx.arc(0, 0, rHub, 0, Math.PI * 2);
  ctx.fill();

  // ── 6. Bolt holes (centred on each arm) ──────────────────────────────────
  ctx.fillStyle = '#111418';
  for (let a = 0; a < ARMS; a++) {
    const ba = angle + a * armP;
    ctx.beginPath();
    ctx.arc(rBCD * Math.cos(ba), rBCD * Math.sin(ba), rBolt, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 7. Centre bore ────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(0, 0, rBore, 0, Math.PI * 2);
  ctx.fill();

  // ── 8. Bright machined edge on tooth tips ─────────────────────────────────
  ctx.strokeStyle = '#e0ecf4';
  ctx.lineWidth   = Math.max(0.5, 0.7 * sc);
  buildToothPath(N, rTip, rRoot, angle);
  ctx.stroke();

  // ── 9. Inner ring-body edge (step between rim and spider area) ────────────
  ctx.strokeStyle = '#8090a2';
  ctx.lineWidth   = Math.max(0.5, 0.9 * sc);
  ctx.beginPath();
  ctx.arc(0, 0, rBody, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// ── Animation loop ────────────────────────────────────────────────────────────
function frame(ts) {
  if (!geo || paused) return;
  if (anim.t === null) anim.t = ts;
  const dt = Math.min((ts - anim.t) / 1000, 0.05);  // cap at 50 ms
  anim.t = ts;

  const d = CHAIN_SPEED * dt;
  anim.phase = (anim.phase + d) % geo.chain_length;
  anim.a1    = (anim.a1 + d / geo.ring1.radius) % (Math.PI * 2);
  anim.a2    = (anim.a2 + d / geo.ring2.radius) % (Math.PI * 2);

  render();
  animId = requestAnimationFrame(frame);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  computeTransform(geo);

  const N1    = geo.teeth_angles.ring1.length;
  const N2    = geo.teeth_angles.ring2.length;
  const pitch = geo.pitch;

  drawRing(geo.ring1, N1, pitch, anim.a1);
  drawRing(geo.ring2, N2, pitch, anim.a2);
  drawChain(geo, anim.phase);
}

// ── API + UI ─────────────────────────────────────────────────────────────────
async function calculate() {
  resizeCanvas();  // ensure canvas matches current container size
  errEl.classList.add('hidden');
  statsEl.classList.add('hidden');

  const payload = {
    teeth1:          parseInt(document.getElementById('teeth1').value,  10),
    teeth2:          parseInt(document.getElementById('teeth2').value,  10),
    center_distance: parseFloat(document.getElementById('center_distance').value),
    pitch:           parseFloat(document.getElementById('pitch').value),
  };

  let data;
  try {
    const res = await fetch('/api/calculate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Unknown error.';
      errEl.classList.remove('hidden');
      return;
    }
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.classList.remove('hidden');
    return;
  }

  // — fetch succeeded; all code below is plain JS, not a network operation —
  data.pitch = payload.pitch;
  geo = data;
  buildPd(data);

  const N1 = data.teeth_angles.ring1.length;
  const p1 = Math.PI * 2 / N1;
  const j1 = Math.round(pd.th1 / p1 - 0.5);
  const N2 = data.teeth_angles.ring2.length;
  const p2 = Math.PI * 2 / N2;
  const j2 = Math.round(pd.th2 / p2 - 0.5);

  if (animId !== null) cancelAnimationFrame(animId);
  paused     = false;
  anim.phase = 0;
  anim.a1    = pd.th1 - (j1 + 0.5) * p1;
  anim.a2    = pd.th2 - (j2 + 0.5) * p2;
  anim.t     = null;
  animId     = requestAnimationFrame(frame);

  if (pauseBtn) { pauseBtn.textContent = 'Pause'; pauseBtn.disabled = false; }

  document.getElementById('stat-length').textContent     = data.chain_length.toFixed(1);
  document.getElementById('stat-links').textContent      = data.num_links;
  document.getElementById('stat-adj-center').textContent = data.adjusted_center.toFixed(2);
  document.getElementById('stat-wrap1').textContent      = data.wrap_angle1.toFixed(1);
  document.getElementById('stat-wrap2').textContent      = data.wrap_angle2.toFixed(1);
  statsEl.classList.remove('hidden');
}

function togglePause() {
  if (!geo) return;
  if (paused) {
    paused = false;
    anim.t = null;  // reset timestamp so dt doesn't spike on resume
    animId = requestAnimationFrame(frame);
    pauseBtn.textContent = 'Pause';
  } else {
    paused = true;
    if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
    pauseBtn.textContent = 'Play';
  }
}

document.getElementById('calculate-btn').addEventListener('click', calculate);
document.getElementById('pause-btn').addEventListener('click', togglePause);

// Defer initial load until after browser has computed flex layout,
// so resizeCanvas() gets the correct canvas-container dimensions.
requestAnimationFrame(calculate);
