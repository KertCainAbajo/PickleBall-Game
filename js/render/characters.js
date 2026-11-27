// Character roster and the stylized avatar drawing shared by the court
// renderer and the character-select portraits. All characters are original
// designs.
//
// Look fields:
//   skin, hair ('short' | 'buzz' | 'long' | 'ponytail' | 'bun' | 'curly' | 'bald' | 'swept'), hairColor,
//   top ('tee' | 'polo' | 'tank' | 'crop' | 'hoodie' | 'jacket'), topColor, inner (shirt under a jacket),
//   bottom ('shorts' | 'joggers' | 'leggings' | 'skirt' | 'camo'), bottomColor, shoes, sole,
//   acc: any of 'glasses', 'beard', 'cap', 'headband', accColor, build (height scale)

export const CHARACTERS = [
  { id: 'ace',   name: 'Ace',   skin: '#d9a27c', hair: 'short',    hairColor: '#1d1a18', top: 'tee',    topColor: '#2f6fe0', bottom: 'shorts',   bottomColor: '#1b2233', shoes: '#f4f4f4', acc: [], build: 1.0 },
  { id: 'luna',  name: 'Luna',  skin: '#f3cdb0', hair: 'long',     hairColor: '#b8442a', top: 'crop',   topColor: '#f1e7a4', bottom: 'camo',     bottomColor: '#e9e6ec', shoes: '#f6f6f6', acc: [], build: 0.95 },
  { id: 'theo',  name: 'Theo',  skin: '#8a5a3b', hair: 'bald',     hairColor: '#2a1d14', top: 'hoodie', topColor: '#24262b', inner: '#efefef', bottom: 'joggers', bottomColor: '#4b4f56', shoes: '#26292e', sole: '#f2f2f2', acc: ['glasses'], build: 1.04 },
  { id: 'grace', name: 'Grace', skin: '#f6d6bd', hair: 'ponytail', hairColor: '#ecd083', top: 'jacket', topColor: '#bba6dc', inner: '#f4f4f4', bottom: 'leggings', bottomColor: '#1e2026', shoes: '#e7e8ee', acc: [], build: 0.98 },
  { id: 'ray',   name: 'Ray',   skin: '#d8a986', hair: 'swept',    hairColor: '#c9c9c9', top: 'hoodie', topColor: '#878da0', inner: '#5b6070', bottom: 'shorts', bottomColor: '#2a2c31', shoes: '#26282c', sole: '#f2f2f2', acc: ['glasses', 'beard'], accColor: '#c2c2c2', build: 1.02 },
  { id: 'kai',   name: 'Kai',   skin: '#5e3b26', hair: 'curly',    hairColor: '#17110d', top: 'tank',   topColor: '#1fa971', bottom: 'shorts',   bottomColor: '#f1f1f1', shoes: '#1fa971', acc: ['headband'], accColor: '#ffffff', build: 1.03 },
  { id: 'mina',  name: 'Mina',  skin: '#efcfae', hair: 'bun',      hairColor: '#141414', top: 'polo',   topColor: '#ef8fb3', bottom: 'skirt',    bottomColor: '#ffffff', shoes: '#ffffff', acc: [], build: 0.93 },
  { id: 'diego', name: 'Diego', skin: '#b07a52', hair: 'buzz',     hairColor: '#2b1f17', top: 'tee',    topColor: '#f2652b', bottom: 'shorts',   bottomColor: '#1d2a4d', shoes: '#f4f4f4', acc: ['headband'], accColor: '#f2652b', build: 1.0 },
  { id: 'zoe',   name: 'Zoe',   skin: '#c98b62', hair: 'curly',    hairColor: '#7a3b1e', top: 'tee',    topColor: '#13a3a8', bottom: 'leggings', bottomColor: '#24262b', shoes: '#f4f4f4', acc: [], build: 0.96 },
  { id: 'hank',  name: 'Hank',  skin: '#f0c6a2', hair: 'short',    hairColor: '#f2f2f2', top: 'polo',   topColor: '#c8363b', bottom: 'shorts',   bottomColor: '#c9b48a', shoes: '#f4f4f4', acc: ['beard'], accColor: '#e8e8e8', build: 1.0 },
  { id: 'priya', name: 'Priya', skin: '#a8714c', hair: 'long',     hairColor: '#120d0a', top: 'tank',   topColor: '#8e5be8', bottom: 'joggers',  bottomColor: '#6b6f78', shoes: '#f4f4f4', acc: [], build: 0.97 },
  { id: 'sam',   name: 'Sam',   skin: '#e2b490', hair: 'short',    hairColor: '#5a3a24', top: 'jacket', topColor: '#1f4f8f', inner: '#e4b11a', bottom: 'joggers',  bottomColor: '#1b2233', shoes: '#e4b11a', acc: ['cap'], accColor: '#e4b11a', build: 1.01 },
];

export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

/** Pick `n` characters, avoiding the ids in `exclude` where possible. */
export function pickCharacters(n, exclude = []) {
  const pool = CHARACTERS.filter(c => !exclude.includes(c.id)).sort(() => Math.random() - 0.5);
  const out = [];
  for (let i = 0; i < n; i++) out.push((pool[i] || CHARACTERS[i % CHARACTERS.length]).id);
  return out;
}

// ------------------------------------------------------------------ helpers

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Horizontal light-to-shadow gradient (key light from the upper left). */
function lit(g, x0, x1, color) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, shade(color, 28));
  gr.addColorStop(0.45, color);
  gr.addColorStop(1, shade(color, -42));
  return gr;
}

/** Tapered limb segment with rounded ends. */
function limb(g, x0, y0, x1, y1, w0, w1, fill) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2);
  g.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  g.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
  g.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2);
  g.closePath();
  g.fill();
  g.beginPath(); g.arc(x0, y0, w0 / 2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x1, y1, w1 / 2, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ avatar

const THIGH = 1.52, SHIN = 1.5, UPPER = 0.76, FORE = 0.72;   // limb lengths (ft)

/**
 * Two-bone IK in the screen plane. Returns the middle joint (knee/elbow)
 * for a chain from `a` to `b`; `bend` picks which side it bends toward
 * (a screen-space vector) and `depth` flattens the bend for front-on views.
 */
function joint(ax, ay, bx, by, l1, l2, bendX, bendY, depth = 1) {
  const dx = bx - ax, dy = by - ay, d = Math.min(Math.hypot(dx, dy) || 1e-6, l1 + l2 - 1e-6);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a)) * depth;
  const ux = dx / d, uy = dy / d;
  let px = -uy, py = ux;
  if (px * bendX + py * bendY < 0) { px = -px; py = -py; }
  return [ax + ux * a + px * h, ay + uy * a + py * h];
}

/**
 * Draw a character with its feet centered at (X, Y), `s` pixels per foot.
 *
 * pose (all optional):
 *   near     seen from behind (near side of the court)
 *   side     +1 / -1: screen side of the paddle (right) hand
 *   paddle   paddle color
 *   phase    gait phase (radians), advanced by distance travelled
 *   run      0..1 how much the player is moving
 *   lat      0..1 how sideways the movement is (1 = side-shuffle)
 *   latDir   +1 / -1 screen direction of sideways movement
 *   crouch   0..1 knee bend (athletic ready stance ~0.35)
 *   lean     ft the upper body leans sideways
 *   twist    -1..1 shoulder turn (backswing / follow-through)
 *   hand     { dx, h, ang } paddle hand: ft toward the paddle side, height in ft,
 *            paddle angle (0 = up, + = tilts toward the paddle side)
 *   off      { dx, h } other hand, same units (dx toward the other side)
 *   time     seconds, for breathing / idle sway
 */
export function drawCharacter(g, c, X, Y, s, pose = {}) {
  const k = s * (c.build || 1);
  const {
    near = false, side = 1, paddle = '#c8f03c', phase = 0, run = 0, lat = 0, latDir = 1,
    crouch = 0.3, lean = 0, twist = 0, time = 0,
    hand = { dx: 0.35, h: 4.05, ang: 0.15 }, off = { dx: 0.45, h: 3.95 },
  } = pose;
  const still = 1 - run;
  const breathe = Math.sin(time * 2.1) * 0.03 * still;
  const bob = Math.abs(Math.sin(phase)) * 0.16 * run;                 // two bounces per stride
  const drop = crouch * 0.38 - bob + breathe * 0.3;                   // ft the hips sink
  const sway = Math.sin(time * 1.3) * 0.05 * still;                   // idle weight shift
  const hipH = 3.08 - drop, shH = hipH + 1.88 + breathe;
  const hipX = X + (lean * 0.35 + sway) * k, shX = X + (lean + sway) * k;
  const yy = h => Y - h * k;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  drawLegs(g, c, X, Y, hipX, yy(hipH), k, { phase, run, lat, latDir, crouch });

  // Shoulders turn with the swing: the paddle side swings back, then across.
  const sw = 0.66 * (1 - 0.22 * Math.abs(twist));
  const shPad = [shX + side * sw * k + side * twist * 0.12 * k, yy(shH)];
  const shOff = [shX - side * sw * k + side * twist * 0.12 * k, yy(shH)];

  // Off arm (behind the torso): balance in the ready stance, pumps when running.
  const pump = Math.sin(phase) * 0.45 * run * (1 - lat);
  const offH = off.h - drop + pump, offDx = off.dx * still + 0.22 * run;
  const offHand = [shOff[0] - side * offDx * k, yy(offH)];
  const offElbow = joint(shOff[0], shOff[1], offHand[0], offHand[1], UPPER * k, FORE * k, -side, 1, 0.8);
  drawArm(g, c, shOff, offElbow, offHand, k);

  drawTorso(g, c, shX, hipX, yy(shH), yy(hipH + 0.35), k, near, twist);

  // Neck and head ride on the shoulders.
  const headX = shX + lean * 0.15 * k;
  g.fillStyle = shade(c.skin, -22);
  rr(g, headX - 0.16 * k, yy(shH + 0.4), 0.32 * k, 0.42 * k, 0.1 * k); g.fill();
  drawHead(g, c, headX, yy(shH + 0.74), 0.41 * k, k, near);

  // Paddle arm in front.
  const a = hand.ang || 0, pdx = Math.sin(a) * side, pdy = -Math.cos(a);
  const handPt = [shX + side * hand.dx * k, yy(hand.h - drop)];
  if (pose.reach && pose.reach.w > 0) {
    // Put the paddle face (0.71 ft along the paddle from the hand) on the ball.
    const r = pose.reach;
    handPt[0] += (r.x - pdx * 0.71 * k - handPt[0]) * r.w;
    handPt[1] += (r.y - pdy * 0.71 * k - handPt[1]) * r.w;
  }
  const elbow = joint(shPad[0], shPad[1], handPt[0], handPt[1], UPPER * k, FORE * k, side, 1, 0.9);
  drawArm(g, c, shPad, elbow, handPt, k);
  drawPaddle(g, handPt[0], handPt[1], pdx, pdy, k, paddle);
}

function drawLegs(g, c, X, Y, hipX, hipY, k, m) {
  const full = c.bottom === 'joggers' || c.bottom === 'leggings' || c.bottom === 'camo';
  const wide = c.bottom === 'joggers' || c.bottom === 'camo';
  const fwd = m.run * (1 - m.lat), shuffle = m.run * m.lat;
  const stance = 0.36 + m.crouch * 0.12;

  for (const i of [-1, 1]) {
    const phi = m.phase + (i < 0 ? 0 : Math.PI);
    // Forward/back running: feet lift alternately (seen front-on, a stride is mostly up-and-down).
    const lift = Math.max(0, Math.sin(phi)) * 0.55 * fwd;
    // Side-shuffle: feet spread and close in rhythm, leading foot first, small hops.
    const spread = Math.sin(m.phase) * 0.3 * shuffle;
    const hop = Math.max(0, Math.sin(phi)) * 0.14 * shuffle;
    const footX = X + (i * stance + i * spread + m.latDir * Math.sin(m.phase) * 0.12 * shuffle) * k;
    const footY = Y - (0.2 + lift + hop) * k;
    const hip = [hipX + i * 0.27 * k, hipY];
    const knee = joint(hip[0], hip[1], footX, footY, THIGH * k, SHIN * k, i, -0.4, 0.45);

    const legCol = full ? c.bottomColor : c.skin;
    const fill = lit(g, hip[0] - 0.3 * k, hip[0] + 0.3 * k, legCol);
    limb(g, hip[0], hip[1], knee[0], knee[1], (wide ? 0.56 : 0.46) * k, (wide ? 0.45 : 0.37) * k, fill);
    limb(g, knee[0], knee[1], footX, footY, (wide ? 0.45 : 0.37) * k, (wide ? 0.36 : 0.26) * k, fill);
    if (wide) {
      g.fillStyle = shade(c.bottomColor, -30);
      rr(g, footX - 0.2 * k, footY - 0.3 * k, 0.4 * k, 0.16 * k, 0.06 * k); g.fill();
    }
    if (c.bottom === 'camo') {
      for (let n = 0; n < 4; n++) {
        const t = (n + 0.5) / 4, [ax, ay] = t < 0.5 ? hip : knee, [bx, by] = t < 0.5 ? knee : [footX, footY], u = (t % 0.5) * 2;
        g.fillStyle = n % 2 ? 'rgba(215,84,124,0.55)' : 'rgba(120,150,190,0.45)';
        g.beginPath(); g.ellipse(ax + (bx - ax) * u, ay + (by - ay) * u, 0.13 * k, 0.08 * k, 0.7, 0, Math.PI * 2); g.fill();
      }
    }
    if (c.bottom === 'leggings') {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(1, 0.04 * k);
      g.beginPath(); g.moveTo(hip[0] + i * 0.18 * k, hip[1]); g.lineTo(knee[0] + i * 0.14 * k, knee[1]); g.lineTo(footX + i * 0.1 * k, footY - 0.3 * k); g.stroke();
    }
    // Sneaker: tilts up a little when the foot lifts.
    const fy = footY + 0.04 * k;
    g.fillStyle = c.shoes;
    g.beginPath(); g.ellipse(footX, fy, 0.32 * k, 0.17 * k, 0, Math.PI, 0); g.lineTo(footX + 0.32 * k, fy + 0.08 * k); g.lineTo(footX - 0.32 * k, fy + 0.08 * k); g.closePath(); g.fill();
    g.fillStyle = c.sole || shade(c.shoes, -25);
    rr(g, footX - 0.34 * k, fy + 0.06 * k, 0.68 * k, 0.1 * k, 0.05 * k); g.fill();
  }

  // Hips: shorts, skirt or waistband.
  const hx = hipX, top = hipY - 0.38 * k, low = hipY + 0.8 * k;
  if (c.bottom === 'shorts') {
    g.fillStyle = lit(g, hx - 0.66 * k, hx + 0.66 * k, c.bottomColor);
    g.beginPath();
    g.moveTo(hx - 0.62 * k, top); g.lineTo(hx + 0.62 * k, top);
    g.lineTo(hx + 0.72 * k, low); g.lineTo(hx + 0.06 * k, low); g.lineTo(hx, low - 0.3 * k);
    g.lineTo(hx - 0.06 * k, low); g.lineTo(hx - 0.72 * k, low); g.closePath(); g.fill();
  } else if (c.bottom === 'skirt') {
    g.fillStyle = lit(g, hx - 0.8 * k, hx + 0.8 * k, c.bottomColor);
    g.beginPath(); g.moveTo(hx - 0.58 * k, top); g.lineTo(hx + 0.58 * k, top); g.lineTo(hx + 0.84 * k, low - 0.15 * k); g.lineTo(hx - 0.84 * k, low - 0.15 * k); g.closePath(); g.fill();
    g.strokeStyle = shade(c.bottomColor, -25); g.lineWidth = Math.max(1, 0.03 * k);
    for (const f of [-0.4, 0, 0.4]) { g.beginPath(); g.moveTo(hx + f * 0.75 * k, top); g.lineTo(hx + f * k, low - 0.15 * k); g.stroke(); }
  } else {
    g.fillStyle = lit(g, hx - 0.62 * k, hx + 0.62 * k, c.bottomColor);
    rr(g, hx - 0.6 * k, top, 1.2 * k, 0.6 * k, 0.22 * k); g.fill();
  }
}

/**
 * Torso between the shoulder line (tx, yS) and the waist (bx, yW). Internally
 * uses the old fixed-height layout (5.0 ft top .. 3.15 ft hem) mapped onto the
 * current, leaning and crouching, body.
 */
function drawTorso(g, c, tx, bx, yS, yW, k, near, twist) {
  const span = 4.85 - 3.25;
  const Y = v => yW + (yS - yW) * ((v - 3.25) / span);
  const Xo = (v, d = 0) => bx + (tx - bx) * Math.min(1.1, Math.max(0, (v - 3.25) / span)) + d * k;
  const crop = c.top === 'crop', tank = c.top === 'tank';
  const shW = (tank || crop ? 0.62 : 0.74) * (1 - 0.22 * Math.abs(twist)), waistW = 0.56;
  const yHem = crop ? 4.0 : 3.15;

  if (tank || crop) {
    g.fillStyle = lit(g, Xo(4.5, -0.72), Xo(4.5, 0.72), c.skin);
    g.beginPath();
    g.moveTo(Xo(4.82, -0.7), Y(4.82)); g.quadraticCurveTo(Xo(5.05), Y(5.05), Xo(4.82, 0.7), Y(4.82));
    g.lineTo(Xo(3.25, waistW), Y(3.25)); g.lineTo(Xo(3.25, -waistW), Y(3.25)); g.closePath(); g.fill();
  }
  if (c.top === 'hoodie' && near) {
    g.fillStyle = shade(c.topColor, -14);
    g.beginPath(); g.ellipse(Xo(4.85), Y(4.85), 0.52 * k, 0.36 * k, 0, 0, Math.PI * 2); g.fill();
  }

  g.fillStyle = lit(g, Xo(4.5, -shW), Xo(4.5, shW), c.topColor);
  g.beginPath();
  g.moveTo(Xo(4.82, -shW), Y(4.82));
  g.quadraticCurveTo(Xo(5.0), Y(tank || crop ? 4.75 : 5.05), Xo(4.82, shW), Y(4.82));
  g.quadraticCurveTo(Xo(4.1, shW * 0.98), Y(4.1), Xo(yHem, waistW * 1.02), Y(yHem));
  g.lineTo(Xo(yHem, -waistW * 1.02), Y(yHem));
  g.quadraticCurveTo(Xo(4.1, -shW * 0.98), Y(4.1), Xo(4.82, -shW), Y(4.82));
  g.closePath();
  g.fill();
  if (tank || crop) {
    g.strokeStyle = shade(c.topColor, -10); g.lineWidth = 0.12 * k;
    g.beginPath(); g.moveTo(Xo(4.55, -0.32), Y(4.55)); g.lineTo(Xo(5.0, -0.36), Y(5.0)); g.moveTo(Xo(4.55, 0.32), Y(4.55)); g.lineTo(Xo(5.0, 0.36), Y(5.0)); g.stroke();
  }

  if (near) {
    if (c.top === 'jacket' || c.top === 'hoodie') {
      g.strokeStyle = shade(c.topColor, -30); g.lineWidth = Math.max(1, 0.03 * k);
      g.beginPath(); g.moveTo(Xo(4.7), Y(4.7)); g.lineTo(Xo(yHem), Y(yHem)); g.stroke();
    }
    return;
  }

  if (c.top === 'jacket') {
    g.fillStyle = c.inner || '#f2f2f2';
    g.beginPath(); g.moveTo(Xo(4.95, -0.26), Y(4.95)); g.lineTo(Xo(4.95, 0.26), Y(4.95)); g.lineTo(Xo(yHem, 0.2), Y(yHem)); g.lineTo(Xo(yHem, -0.2), Y(yHem)); g.closePath(); g.fill();
    g.strokeStyle = shade(c.topColor, -45); g.lineWidth = Math.max(1, 0.05 * k);
    g.beginPath(); g.moveTo(Xo(4.95, -0.27), Y(4.95)); g.lineTo(Xo(yHem, -0.21), Y(yHem)); g.moveTo(Xo(4.95, 0.27), Y(4.95)); g.lineTo(Xo(yHem, 0.21), Y(yHem)); g.stroke();
    g.fillStyle = shade(c.topColor, -18);
    g.beginPath(); g.moveTo(Xo(5.0, -0.42), Y(5.0)); g.lineTo(Xo(4.6, -0.24), Y(4.6)); g.lineTo(Xo(5.02, -0.18), Y(5.02)); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(Xo(5.0, 0.42), Y(5.0)); g.lineTo(Xo(4.6, 0.24), Y(4.6)); g.lineTo(Xo(5.02, 0.18), Y(5.02)); g.closePath(); g.fill();
  } else if (c.top === 'hoodie') {
    g.fillStyle = shade(c.topColor, -14);
    g.beginPath(); g.ellipse(Xo(4.98), Y(4.98), 0.42 * k, 0.16 * k, 0, 0, Math.PI * 2); g.fill();
    if (c.inner) { g.fillStyle = c.inner; g.beginPath(); g.moveTo(Xo(4.98, -0.15), Y(4.98)); g.lineTo(Xo(4.98, 0.15), Y(4.98)); g.lineTo(Xo(4.55), Y(4.55)); g.closePath(); g.fill(); }
    g.strokeStyle = '#d9dde3'; g.lineWidth = Math.max(1, 0.035 * k);
    g.setLineDash([Math.max(1, 0.05 * k), Math.max(1, 0.04 * k)]);
    g.beginPath(); g.moveTo(Xo(4.55), Y(4.55)); g.lineTo(Xo(yHem), Y(yHem)); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#eef0f3'; g.lineWidth = Math.max(1, 0.035 * k);
    g.beginPath(); g.moveTo(Xo(4.9, -0.13), Y(4.9)); g.lineTo(Xo(4.35, -0.16), Y(4.35)); g.moveTo(Xo(4.9, 0.13), Y(4.9)); g.lineTo(Xo(4.35, 0.16), Y(4.35)); g.stroke();
    g.strokeStyle = shade(c.topColor, -35); g.lineWidth = Math.max(1, 0.03 * k);
    g.beginPath(); g.moveTo(Xo(3.3, -0.42), Y(3.3)); g.lineTo(Xo(3.8, -0.32), Y(3.8)); g.lineTo(Xo(3.8, 0.32), Y(3.8)); g.lineTo(Xo(3.3, 0.42), Y(3.3)); g.stroke();
  } else if (c.top === 'polo') {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(Xo(5.0, -0.32), Y(5.0)); g.lineTo(Xo(4.72), Y(4.72)); g.lineTo(Xo(5.0, 0.32), Y(5.0)); g.lineTo(Xo(4.9), Y(4.9)); g.closePath(); g.fill();
    g.fillStyle = shade(c.topColor, -30);
    for (const v of [4.6, 4.4]) { g.beginPath(); g.arc(Xo(v), Y(v), 0.035 * k, 0, Math.PI * 2); g.fill(); }
  } else if (c.top === 'tee') {
    g.strokeStyle = shade(c.topColor, -35); g.lineWidth = Math.max(1, 0.05 * k);
    g.beginPath(); g.arc(Xo(5.02), Y(5.02), 0.24 * k, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
}

function drawArm(g, c, sh, el, hd, k) {
  const longSleeve = c.top === 'hoodie' || c.top === 'jacket';
  const skin = lit(g, sh[0] - 0.2 * k, sh[0] + 0.2 * k, c.skin);
  if (longSleeve) {
    const cloth = lit(g, sh[0] - 0.25 * k, sh[0] + 0.25 * k, c.topColor);
    limb(g, sh[0], sh[1], el[0], el[1], 0.36 * k, 0.3 * k, cloth);
    limb(g, el[0], el[1], hd[0], hd[1], 0.3 * k, 0.25 * k, cloth);
    g.fillStyle = shade(c.topColor, -25);
    g.beginPath(); g.arc(hd[0], hd[1], 0.13 * k, 0, Math.PI * 2); g.fill();
  } else {
    limb(g, sh[0], sh[1], el[0], el[1], 0.27 * k, 0.22 * k, skin);
    limb(g, el[0], el[1], hd[0], hd[1], 0.22 * k, 0.19 * k, skin);
    if (c.top === 'tee' || c.top === 'polo') {
      const mx = sh[0] + (el[0] - sh[0]) * 0.6, my = sh[1] + (el[1] - sh[1]) * 0.6;
      limb(g, sh[0], sh[1], mx, my, 0.38 * k, 0.33 * k, lit(g, sh[0] - 0.25 * k, sh[0] + 0.25 * k, c.topColor));
    }
  }
  g.fillStyle = c.skin;
  g.beginPath(); g.arc(hd[0], hd[1], 0.12 * k, 0, Math.PI * 2); g.fill();
}

/** Paddle held at (hx, hy), its long axis pointing along (dx, dy). */
function drawPaddle(g, hx, hy, dx, dy, k, color) {
  const col = color.startsWith('#') ? color : '#2f6fe0';
  g.save();
  g.translate(hx, hy);
  g.rotate(Math.atan2(dy, dx) - Math.PI / 2);
  g.fillStyle = '#1b1d21';
  rr(g, -0.07 * k, -0.1 * k, 0.14 * k, 0.44 * k, 0.05 * k); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(1, 0.025 * k);
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-0.07 * k, i * 0.1 * k); g.lineTo(0.07 * k, i * 0.1 * k + 0.04 * k); g.stroke(); }
  const w = 0.56 * k, h = 0.78 * k, y0 = 0.32 * k;
  const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  gr.addColorStop(0, shade(col, 35));
  gr.addColorStop(1, shade(col, -25));
  g.fillStyle = gr;
  rr(g, -w / 2, y0, w, h, 0.22 * k); g.fill();
  g.strokeStyle = '#15171b'; g.lineWidth = Math.max(1, 0.05 * k);
  rr(g, -w / 2, y0, w, h, 0.22 * k); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(-w / 2 + 0.05 * k, y0 + h * 0.55); g.lineTo(w / 2 - 0.05 * k, y0 + h * 0.35); g.lineTo(w / 2 - 0.05 * k, y0 + h * 0.45); g.lineTo(-w / 2 + 0.05 * k, y0 + h * 0.65); g.closePath(); g.fill();
  g.restore();
}

function drawHead(g, c, hX, hY, hr, k, near) {
  // long hair falls behind the head and shoulders
  if (c.hair === 'long' && !near) {
    g.fillStyle = lit(g, hX - hr * 1.2, hX + hr * 1.2, c.hairColor);
    rr(g, hX - hr * 1.18, hY - hr * 0.4, hr * 2.36, 1.5 * k, 0.35 * k); g.fill();
  }
  // ears
  g.fillStyle = shade(c.skin, -12);
  for (const sgn of [-1, 1]) { g.beginPath(); g.ellipse(hX + sgn * hr * 0.96, hY + 0.05 * k, hr * 0.16, hr * 0.24, 0, 0, Math.PI * 2); g.fill(); }
  // face shape with soft shading
  const gr = g.createRadialGradient(hX - hr * 0.35, hY - hr * 0.35, hr * 0.1, hX, hY, hr * 1.15);
  gr.addColorStop(0, shade(c.skin, 22));
  gr.addColorStop(0.7, c.skin);
  gr.addColorStop(1, shade(c.skin, -30));
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(hX, hY, hr * 0.94, hr * 1.04, 0, 0, Math.PI * 2); g.fill();

  drawHair(g, c, hX, hY, hr, k, near);
  if (!near) drawFace(g, c, hX, hY, hr, k);
  drawHeadwear(g, c, hX, hY, hr, k, near);
}

function drawHair(g, c, hX, hY, hr, k, near) {
  const hairFill = lit(g, hX - hr, hX + hr, c.hairColor);
  g.fillStyle = hairFill;
  const capTop = () => {
    g.beginPath();
    g.moveTo(hX - hr * 0.98, hY + hr * 0.05);
    g.bezierCurveTo(hX - hr * 1.05, hY - hr * 1.35, hX + hr * 1.05, hY - hr * 1.35, hX + hr * 0.98, hY + hr * 0.05);
    g.quadraticCurveTo(hX + hr * 0.6, hY - hr * 0.55, hX, hY - hr * 0.62);
    g.quadraticCurveTo(hX - hr * 0.6, hY - hr * 0.55, hX - hr * 0.98, hY + hr * 0.05);
    g.fill();
  };
  const backCover = (bottom = 0.75) => {
    g.beginPath(); g.ellipse(hX, hY - hr * 0.05, hr * 0.99, hr * 1.06, 0, Math.PI, 0); g.fill();
    rr(g, hX - hr * 0.99, hY - hr * 0.1, hr * 1.98, hr * (0.1 + bottom), hr * 0.5); g.fill();
  };
  switch (c.hair) {
    case 'bald':
      g.fillStyle = 'rgba(255,255,255,0.22)';   // scalp shine
      g.beginPath(); g.ellipse(hX - hr * 0.25, hY - hr * 0.62, hr * 0.32, hr * 0.15, -0.4, 0, Math.PI * 2); g.fill();
      if (near) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(hX, hY + hr * 0.45, hr * 0.8, hr * 0.25, 0, 0, Math.PI); g.fill(); }
      return;
    case 'buzz':
      g.globalAlpha = 0.8;
      if (near) backCover(0.6); else capTop();
      g.globalAlpha = 1;
      return;
    case 'curly': {
      const n = near ? 12 : 9;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (near ? 0.85 : 1.02) + (i / (n - 1)) * Math.PI * (near ? 1.3 : 0.96);
        g.beginPath(); g.arc(hX + Math.cos(a) * hr * 0.95, hY + Math.sin(a) * hr * 1.0 - 0.05 * k, hr * 0.36, 0, Math.PI * 2); g.fill();
      }
      if (near) backCover(0.75);
      return;
    }
    case 'swept':
      if (near) { backCover(0.55); return; }
      capTop();
      g.beginPath(); g.ellipse(hX + hr * 0.15, hY - hr * 0.82, hr * 0.9, hr * 0.4, -0.25, 0, Math.PI * 2); g.fill();
      return;
    default:
      if (near) {
        backCover(c.hair === 'long' ? 2.6 : 0.6);
        if (c.hair === 'ponytail') { g.beginPath(); g.ellipse(hX, hY + hr * 1.05, hr * 0.3, hr * 0.9, 0, 0, Math.PI * 2); g.fill(); }
      } else {
        capTop();
        if (c.hair === 'long') {   // side curtains framing the face
          rr(g, hX - hr * 1.12, hY - hr * 0.55, hr * 0.42, 1.25 * k, 0.15 * k); g.fill();
          rr(g, hX + hr * 0.7, hY - hr * 0.55, hr * 0.42, 1.25 * k, 0.15 * k); g.fill();
        }
        if (c.hair === 'ponytail') { g.beginPath(); g.ellipse(hX + hr * 1.0, hY - hr * 0.2, hr * 0.28, hr * 0.75, 0.45, 0, Math.PI * 2); g.fill(); }
      }
      if (c.hair === 'bun') { g.beginPath(); g.arc(hX, hY - hr * 1.12, hr * 0.42, 0, Math.PI * 2); g.fill(); }
      // highlight
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(1, 0.05 * k);
      g.beginPath(); g.arc(hX - hr * 0.15, hY - hr * 0.2, hr * 0.75, Math.PI * 1.15, Math.PI * 1.45); g.stroke();
  }
}

function drawFace(g, c, hX, hY, hr, k) {
  if (c.acc.includes('beard')) {
    g.fillStyle = lit(g, hX - hr, hX + hr, c.accColor || c.hairColor);
    g.beginPath();
    g.moveTo(hX - hr * 0.9, hY + hr * 0.05);
    g.quadraticCurveTo(hX - hr * 0.8, hY + hr * 1.05, hX, hY + hr * 1.08);
    g.quadraticCurveTo(hX + hr * 0.8, hY + hr * 1.05, hX + hr * 0.9, hY + hr * 0.05);
    g.quadraticCurveTo(hX, hY + hr * 0.45, hX - hr * 0.9, hY + hr * 0.05);
    g.fill();
  }
  const ey = hY + hr * 0.05, ex = hr * 0.36;
  // brows
  g.strokeStyle = c.hair === 'bald' ? shade(c.skin, -70) : shade(c.hairColor, -20);
  g.lineWidth = Math.max(1, 0.06 * k);
  g.beginPath(); g.moveTo(hX - ex - hr * 0.17, ey - hr * 0.3); g.quadraticCurveTo(hX - ex, ey - hr * 0.38, hX - ex + hr * 0.17, ey - hr * 0.3);
  g.moveTo(hX + ex - hr * 0.17, ey - hr * 0.3); g.quadraticCurveTo(hX + ex, ey - hr * 0.38, hX + ex + hr * 0.17, ey - hr * 0.3); g.stroke();
  // eyes
  for (const sgn of [-1, 1]) {
    const x = hX + sgn * ex;
    g.fillStyle = '#f4f1ec'; g.beginPath(); g.ellipse(x, ey, hr * 0.13, hr * 0.075, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3b2a1e'; g.beginPath(); g.arc(x, ey + hr * 0.005, hr * 0.06, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x + hr * 0.02, ey - hr * 0.02, hr * 0.018, 0, Math.PI * 2); g.fill();
  }
  // nose and mouth
  g.strokeStyle = shade(c.skin, -45); g.lineWidth = Math.max(1, 0.04 * k);
  g.beginPath(); g.moveTo(hX + hr * 0.02, ey + hr * 0.08); g.quadraticCurveTo(hX + hr * 0.1, ey + hr * 0.3, hX - hr * 0.05, ey + hr * 0.33); g.stroke();
  g.strokeStyle = c.acc.includes('beard') ? '#5a3328' : '#b05a4c'; g.lineWidth = Math.max(1, 0.05 * k);
  g.beginPath(); g.arc(hX, ey + hr * 0.38, hr * 0.2, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  // cheeks
  g.fillStyle = 'rgba(220,110,100,0.09)';
  for (const sgn of [-1, 1]) { g.beginPath(); g.arc(hX + sgn * hr * 0.55, ey + hr * 0.3, hr * 0.15, 0, Math.PI * 2); g.fill(); }
  if (c.acc.includes('glasses')) {
    g.strokeStyle = '#141414'; g.lineWidth = Math.max(1, 0.055 * k);
    for (const sgn of [-1, 1]) { rr(g, hX + sgn * ex - hr * 0.22, ey - hr * 0.17, hr * 0.44, hr * 0.34, hr * 0.12); g.stroke(); }
    g.beginPath(); g.moveTo(hX - ex + hr * 0.22, ey - hr * 0.05); g.lineTo(hX + ex - hr * 0.22, ey - hr * 0.05); g.stroke();
  }
}

function drawHeadwear(g, c, hX, hY, hr, k, near) {
  if (c.acc.includes('headband')) {
    g.fillStyle = c.accColor || '#ffffff';
    rr(g, hX - hr * 0.98, hY - hr * 0.55, hr * 1.96, hr * 0.26, hr * 0.1); g.fill();
  }
  if (c.acc.includes('cap')) {
    g.fillStyle = lit(g, hX - hr, hX + hr, c.accColor || '#333');
    g.beginPath(); g.ellipse(hX, hY - hr * 0.3, hr * 1.02, hr * 0.85, 0, Math.PI, 0); g.fill();
    g.fillStyle = shade(c.accColor || '#333', -30);
    if (near) rr(g, hX - hr * 1.02, hY - hr * 0.36, hr * 2.04, hr * 0.14, hr * 0.06);
    else { g.beginPath(); g.ellipse(hX, hY - hr * 0.3, hr * 1.25, hr * 0.22, 0, 0, Math.PI); }
    g.fill();
  }
}

/** Front-facing, waist-up portrait for the character picker. */
export function drawPortrait(canvas, c, teamColor = '#2f6fe0') {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#24456f'); bg.addColorStop(1, '#0c1828');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.beginPath(); g.arc(W / 2, H * 0.35, W * 0.42, 0, Math.PI * 2); g.fill();
  const s = H / 4.6;
  drawCharacter(g, c, W / 2, H + 2.4 * s - 6 * s * ((c.build || 1) - 1), s, { near: false, side: -1, paddle: teamColor, crouch: 0.15, hand: { dx: 0.5, h: 4.1, ang: 0.35 } });
}

// ------------------------------------------------------------------ animated preview

// Drive keyframes: [hand dx (ft), hand height (ft), paddle angle], plus shoulder twist and knee bend.
const PREVIEW_SWING = {
  hand: [[0.4, 4.05, 0.2], [1.3, 3.35, 1.9], [1.0, 3.7, 1.25], [-0.55, 5.0, -0.9]],
  twist: [0, 0.85, 0.1, -0.85],
  crouch: [0.35, 0.6, 0.5, 0.35],
};
const smooth = t => t * t * (3 - 2 * t);
const lerpArr = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Pose for the character-select preview, looping every 4.2 s:
 * ready -> forehand swing -> ready -> side-shuffle -> ready. Selecting a
 * character restarts the loop, so the new pick swings straight away.
 */
export function previewPose(t) {
  const loop = t % 4.2;
  const base = { time: t, crouch: 0.35, run: 0, lat: 0, latDir: 1, phase: 0, lean: 0, twist: 0, shift: 0 };
  if (loop >= 0.3 && loop < 0.9) {
    const s = (loop - 0.3) / 0.6, K = PREVIEW_SWING;
    const i = s < 0.35 ? 0 : s < 0.55 ? 1 : 2;
    const e = smooth(i === 0 ? s / 0.35 : i === 1 ? (s - 0.35) / 0.2 : (s - 0.55) / 0.45);
    const hand = lerpArr(K.hand[i], K.hand[i + 1], e);
    return { ...base, hand: { dx: hand[0], h: hand[1], ang: hand[2] }, twist: K.twist[i] + (K.twist[i + 1] - K.twist[i]) * e, crouch: K.crouch[i] + (K.crouch[i + 1] - K.crouch[i]) * e };
  }
  if (loop >= 1.6 && loop < 3.0) {
    const u = (loop - 1.6) / 1.4, env = Math.sin(u * Math.PI);   // ease in and out of the shuffle
    const dir = Math.cos(u * Math.PI * 2);
    return { ...base, run: 0.85 * env, lat: 1, latDir: dir >= 0 ? 1 : -1, phase: loop * 11, lean: 0.25 * dir * env, shift: Math.sin(u * Math.PI * 2) * 0.9, crouch: 0.3 };
  }
  return base;
}

/** Full-body animated preview of a character on a small court-colored stage. */
export function drawPreview(canvas, c, teamColor, t) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#24456f'); bg.addColorStop(0.72, '#13294a'); bg.addColorStop(0.72, '#2d64b4'); bg.addColorStop(1, '#244f92');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, H * 0.86, W, Math.max(2, H * 0.012));   // a court line
  const pose = previewPose(t), s = H / 7.6, x = W / 2 + pose.shift * s;
  g.fillStyle = 'rgba(0,10,30,0.35)';
  g.beginPath(); g.ellipse(x, H - 16, 1.1 * s, 0.28 * s, 0, 0, Math.PI * 2); g.fill();
  drawCharacter(g, c, x, H - 16, s, { ...pose, near: false, side: -1, paddle: teamColor });
}
