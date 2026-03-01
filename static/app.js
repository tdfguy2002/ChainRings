'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const CHAIN_SPEED = 65; // mm/s in model units

// ── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('chain-canvas');
const ctx    = canvas.getContext('2d');

let geo    = null;  // API response (with .pitch added)
let pd     = null;  // precomputed path data (chain arc-length params)
let tf     = { ox: 0, oy: 0, scale: 1 };
let animId = null;
const anim = { phase: 0, a1: 0, a2: 0, t: null };

// ── Sizing ───────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const el = document.getElementById('canvas-container');
  canvas.width  = el.clientWidth;
  canvas.height = el.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

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
  const step = g.chain_length / N;
  const sc   = tf.scale;

  const rollerR = Math.max(1.2, 3.97 * sc);
  const outerHW = Math.max(0.9, 3.6  * sc);
  const innerHW = Math.max(0.6, 2.5  * sc);

  // Pre-compute all joint positions (avoids double-computing shared endpoints)
  const pts = new Array(N);
  for (let i = 0; i < N; i++) pts[i] = chainPoint(g, phase + i * step);

  // Plates
  for (let i = 0; i < N; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % N];
    const outer = (i & 1) === 0;
    drawStadium(p0.x, p0.y, p1.x, p1.y,
      outer ? outerHW : innerHW,
      outer ? '#506070' : '#384858');
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
// Builds the sprocket tooth outline in local (ring-centred) coordinates.
// Teeth are symmetric: valley → left-shoulder → tip → right-shoulder → valley.
function buildToothPath(N, rTip, rRoot, rotation) {
  const p  = Math.PI * 2 / N;
  const tw = 0.22;   // tooth half-width as fraction of pitch angle
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const θ  = rotation + i * p;
    const vl = θ - p * 0.5;
    const sl = θ - p * tw;
    const sr = θ + p * tw;
    const vr = θ + p * 0.5;
    if (i === 0) ctx.moveTo(rRoot * Math.cos(vl), rRoot * Math.sin(vl));
    else         ctx.lineTo(rRoot * Math.cos(vl), rRoot * Math.sin(vl));
    ctx.lineTo(rTip  * Math.cos(sl), rTip  * Math.sin(sl));
    ctx.lineTo(rTip  * Math.cos(θ),  rTip  * Math.sin(θ));   // tip
    ctx.lineTo(rTip  * Math.cos(sr), rTip  * Math.sin(sr));
    ctx.lineTo(rRoot * Math.cos(vr), rRoot * Math.sin(vr));
  }
  ctx.closePath();
}

function drawRing(ring, N, pitchMM, angle) {
  const [cx, cy] = toCanvas(ring.cx, ring.cy);
  const sc = tf.scale;
  const R  = ring.radius;

  // Geometry (all in canvas pixels, in local ring-centred coords)
  const rTip  = (R + 0.32 * pitchMM) * sc;
  const rRoot = (R - 0.32 * pitchMM) * sc;
  const rBody = rRoot * 0.80;                        // inner edge of ring body
  const rHub  = Math.max(5, R * 0.20 * sc);
  const rBore = Math.max(2, R * 0.10 * sc);
  const rBCD  = R * 0.62 * sc;                       // bolt-circle radius
  const rBolt = Math.max(1.5, R * 0.038 * sc);

  const ARMS  = N >= 30 ? 5 : 4;
  const armP  = Math.PI * 2 / ARMS;
  const aHalf = 0.22;    // arm angular half-width as fraction of armP

  ctx.save();
  ctx.translate(cx, cy);

  // ── 1. Tooth polygon (fills from centre to tip) ──────────────────────────
  ctx.fillStyle = '#52606e';
  buildToothPath(N, rTip, rRoot, angle);
  ctx.fill();

  // ── 2. Solid ring body (donut rBody → rRoot, fills any valley gaps) ──────
  ctx.fillStyle = '#52606e';
  ctx.beginPath();
  ctx.arc(0, 0, rRoot, 0, Math.PI * 2, false);
  ctx.moveTo(rBody, 0);
  ctx.arc(0, 0, rBody, 0, Math.PI * 2, true);
  ctx.fill('evenodd');

  // ── 3. Arm windows (cut background colour between arms) ──────────────────
  ctx.fillStyle = '#0d0d1a';
  for (let a = 0; a < ARMS; a++) {
    const ac = angle + a * armP;
    const wL = ac + aHalf * armP;
    const wR = ac + (1 - aHalf) * armP;
    ctx.beginPath();
    ctx.arc(0, 0, rBody * 0.97, wL, wR, false);  // outer arc of window
    ctx.arc(0, 0, rHub  * 1.35, wR, wL, true);   // inner arc (reversed)
    ctx.closePath();
    ctx.fill();
  }

  // ── 4. Hub ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#52606e';
  ctx.beginPath();
  ctx.arc(0, 0, rHub, 0, Math.PI * 2);
  ctx.fill();

  // ── 5. Bolt holes (centred on each arm) ──────────────────────────────────
  ctx.fillStyle = '#0d0d1a';
  for (let a = 0; a < ARMS; a++) {
    const ba = angle + a * armP;
    ctx.beginPath();
    ctx.arc(rBCD * Math.cos(ba), rBCD * Math.sin(ba), rBolt, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 6. Centre bore ────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(0, 0, rBore, 0, Math.PI * 2);
  ctx.fill();

  // ── 7. Tooth edge highlight ───────────────────────────────────────────────
  ctx.strokeStyle = '#8898aa';
  ctx.lineWidth   = Math.max(0.4, 0.5 * sc);
  buildToothPath(N, rTip, rRoot, angle);
  ctx.stroke();

  ctx.restore();
}

// ── Animation loop ────────────────────────────────────────────────────────────
function frame(ts) {
  if (!geo) return;
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
  const errEl   = document.getElementById('error-msg');
  const statsEl = document.getElementById('stats');
  errEl.classList.add('hidden');
  statsEl.classList.add('hidden');

  const payload = {
    teeth1:          parseInt(document.getElementById('teeth1').value,  10),
    teeth2:          parseInt(document.getElementById('teeth2').value,  10),
    center_distance: parseFloat(document.getElementById('center_distance').value),
    pitch:           parseFloat(document.getElementById('pitch').value),
  };

  try {
    const res  = await fetch('/api/calculate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Unknown error.';
      errEl.classList.remove('hidden');
      return;
    }

    data.pitch = payload.pitch;  // attach for rendering
    geo = data;
    buildPd(data);

    if (animId !== null) cancelAnimationFrame(animId);
    anim.phase = 0; anim.a1 = 0; anim.a2 = 0; anim.t = null;
    animId = requestAnimationFrame(frame);

    document.getElementById('stat-length').textContent     = data.chain_length.toFixed(1);
    document.getElementById('stat-links').textContent      = data.num_links;
    document.getElementById('stat-adj-center').textContent = data.adjusted_center.toFixed(2);
    document.getElementById('stat-wrap1').textContent      = data.wrap_angle1.toFixed(1);
    document.getElementById('stat-wrap2').textContent      = data.wrap_angle2.toFixed(1);
    statsEl.classList.remove('hidden');

  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.classList.remove('hidden');
  }
}

document.getElementById('calculate-btn').addEventListener('click', calculate);

resizeCanvas();
calculate();
