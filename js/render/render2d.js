// Lightweight 2D renderer (plain canvas, no WebGL).
//
// The court is drawn in perspective from a fixed broadcast camera, so it reads
// like TV coverage while staying fully 2D. All static scenery (sky, grass,
// stands, fences, court and lines) is painted once into an offscreen canvas;
// each frame only blits that image and draws the players, ball and net.
//
// It consumes the same scene model as before:
//   players: [{ id, team, color, x, z, vx, vz, swingAnim, swingKind, human }],
//   ball: { x, y, z, visible }, marker: {x, z} | null,
//   serveBox: {x, z, w, d} | null, view: 'near' | 'far'

import * as C from '../engine/constants.js';

export const PLAYER_COLORS = ['#2f6fe0', '#f2652b', '#1fa971', '#8e5be8', '#e4b11a', '#e0457b'];
const SKIN = ['#e9b48c', '#c98b62', '#f1c7a5', '#a8714c'];
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const ease = t => t * t * (3 - 2 * t);

// Arm angle keyframes per shot (radians, 0 = arm pointing out to the side, + = up).
const SWINGS = { drive: [-2.3, 0.2, 1.2], dink: [-1.5, -0.6, 0.1], lob: [-2.0, -0.3, 1.5], smash: [1.7, 1.2, -0.7] };

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bg = document.createElement('canvas');
    this.bgKey = '';
    this.trail = [];
    this.resize();
    addEventListener('resize', () => this.resize());
    document.fonts?.ready.then(() => { this.bgKey = ''; });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.bgKey = '';
    this.setCamera();
  }

  /** Fixed broadcast camera behind the near baseline. */
  setCamera() {
    const aspect = this.W / this.H;
    const fov = ((aspect < 1.2 ? 62 : aspect < 1.5 ? 48 : 40) * Math.PI) / 180;
    const pos = [0, 19, 47], tgt = [0, 0, -2.5];
    const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
    const f = norm([tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]]);
    const r = norm([-f[2], 0, f[0]]);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    this.cam = { pos, f, r, u, focal: this.H / 2 / Math.tan(fov / 2) };
  }

  /** World point -> screen (CSS px). s = pixels per foot at that depth. */
  P(x, y, z) {
    const c = this.cam, dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2];
    const d = Math.max(0.5, dx * c.f[0] + dy * c.f[1] + dz * c.f[2]);
    const k = c.focal / d;
    return {
      x: this.W / 2 + (dx * c.r[0] + dy * c.r[1] + dz * c.r[2]) * k,
      y: this.H / 2 - (dx * c.u[0] + dy * c.u[1] + dz * c.u[2]) * k,
      s: k, d,
    };
  }

  poly(g, pts, fill, stroke, lw) {
    g.beginPath();
    pts.forEach(([x, y, z], i) => { const p = this.P(x, y, z); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
  }
  /** Flat rectangle on the ground (y = 0). */
  ground(g, x0, z0, x1, z1, fill, y = 0) { this.poly(g, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill); }
  /** Vertical wall facing the camera along x (constant z) or along z (constant x). */
  wallZ(g, x0, x1, z, y0, y1, fill) { this.poly(g, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill); }
  wallX(g, x, z0, z1, y0, y1, fill) { this.poly(g, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], fill); }
  vline(g, x, z, y0, y1, color, w) {
    const a = this.P(x, y0, z), b = this.P(x, y1, z);
    g.strokeStyle = color; g.lineWidth = Math.max(1, w * a.s); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }

  // -------------------------------------------------------------- static scenery

  buildBackground() {
    const bg = this.bg, W = this.W, H = this.H;
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const g = bg.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.lineJoin = 'round';

    // Sky and grass.
    const horizon = this.P(0, 0, -3000).y;
    g.fillStyle = '#4c8a3b'; g.fillRect(0, 0, W, H);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#3f7fc4'); sky.addColorStop(1, '#d7e6f2');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon + 1);
    for (let i = -60; i < 60; i += 2) this.ground(g, i * 8, -3000, i * 8 + 8, 40, '#579a44');
    const haze = g.createLinearGradient(0, horizon, 0, horizon + H * 0.18);
    haze.addColorStop(0, 'rgba(215,230,242,0.95)'); haze.addColorStop(1, 'rgba(215,230,242,0)');
    g.fillStyle = haze; g.fillRect(0, horizon, W, H * 0.18);

    // Distant trees, far to near.
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const trees = [];
    for (let i = 0; i < 46; i++) trees.push([-170 + rnd() * 340, -(64 + rnd() * 70), 0.8 + rnd() * 0.7]);
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, z, s] of trees) {
      const base = this.P(x, 0, z), top = this.P(x, 14 * s, z);
      g.fillStyle = '#5d4632'; g.fillRect(base.x - 0.6 * base.s, top.y, 1.2 * base.s, base.y - top.y);
      g.fillStyle = `hsl(${100 + rnd() * 20}, 38%, ${24 + rnd() * 9}%)`;
      g.beginPath(); g.ellipse(top.x, top.y, 7.5 * s * top.s, 8.5 * s * top.s, 0, 0, Math.PI * 2); g.fill();
    }
    this.wallZ(g, -60, 60, -44, 0, 7, '#2f6b2c');                     // hedge
    this.ground(g, -32, -46, 32, 40, '#c2c4bd');                       // concrete apron

    // Grandstand on the left (outer rows first).
    const rows = 6, depth = 2.8, rise = 1.4;
    for (let r = rows - 1; r >= 0; r--) {
      const x0 = -23 - r * depth - depth / 2, x1 = x0 + depth, y = 1.2 + r * rise;
      this.ground(g, x0, -32, x1, 30, '#1f56b3', y);
      if (r >= 2) this.ground(g, x0, -8, x1, 8, '#f2c230', y);
      this.wallX(g, x1, -32, 30, y - rise, y, '#cfd2cc');
    }
    this.vline(g, -21, -38, 0, 32, '#2f343a', 0.4);                    // light towers
    this.vline(g, 21, -38, 0, 32, '#2f343a', 0.4);

    // Back fence: windscreen with club name, chain-link above, posts.
    this.wallZ(g, -19, 19, -36, 0, 5.5, '#1f5a49');
    this.wallZ(g, -19, 19, -36, 5.5, 10.2, 'rgba(190,198,204,0.22)');
    const mid = this.P(0, 2.9, -36);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = `700 ${Math.round(2.5 * mid.s)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PICKLE RALLY   •   PICKLEBALL CLUB', mid.x, mid.y);
    for (let x = -19; x <= 19.01; x += 9.5) this.vline(g, x, -36, 0, 10.4, '#2f343a', 0.22);

    // Court: surround, court, kitchen, lines.
    this.ground(g, -18, -33, 18, 33, '#3f7f61');
    this.ground(g, -10, -22, 10, 22, '#2c5f9f');
    this.ground(g, -10, -7, 10, 7, '#3a74b9');
    const L = 2 / 12, white = '#f7f9fb';
    const line = (x0, z0, x1, z1) => this.ground(g, x0, z0, x1, z1, white);
    line(-10, -22, -10 + L, 22); line(10 - L, -22, 10, 22);
    line(-10, -22, 10, -22 + L); line(-10, 22 - L, 10, 22);
    line(-10, -7, 10, -7 + L); line(-10, 7 - L, 10, 7);
    line(-L / 2, -22, L / 2, -7); line(-L / 2, 7, L / 2, 22);
    g.fillStyle = 'rgba(255,255,255,0.32)';
    for (const z of [3.5]) {   // the far label would sit behind the net
      const p = this.P(0, 0, z);
      g.font = `600 ${Math.max(8, Math.round(0.9 * p.s))}px ${FONT}`;
      g.fillText('KITCHEN', p.x, p.y);
    }

    // Side fences (drawn after the court; they sit outside it).
    for (const x of [-19, 19]) {
      this.wallX(g, x, -36, 34, 0, 5.5, '#1f5a49');
      this.wallX(g, x, -36, 34, 5.5, 10.2, 'rgba(190,198,204,0.18)');
      for (let z = -36; z <= 34.01; z += 10) this.vline(g, x, z, 0, 10.4, '#2f343a', 0.22);
    }
  }

  // -------------------------------------------------------------- frame

  update(model, dt) {
    const key = `${this.canvas.width}x${this.canvas.height}`;
    if (this.bgKey !== key) { this.buildBackground(); this.bgKey = key; }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.time = (this.time || 0) + dt;

    // The far view (online guest) is the same picture rotated 180 degrees.
    const m = model.view === 'far' ? -1 : 1;

    if (model.serveBox) {
      const sb = model.serveBox, x = sb.x * m, z = sb.z * m;
      this.ground(g, x - sb.w / 2, z - sb.d / 2, x + sb.w / 2, z + sb.d / 2, 'rgba(230,255,106,0.18)');
    }
    if (model.marker) this.ring(g, model.marker.x * m, model.marker.z * m, 0.55, `rgba(244,255,138,${0.65 + 0.3 * Math.sin(this.time * 9)})`, 0.12);

    // Shadows first, so they sit under every body.
    const b = model.ball;
    for (const p of model.players) this.shadow(g, p.x * m, p.z * m, 0.75, 0.3);
    if (b.visible) this.shadow(g, b.x * m, b.z * m, 0.3 * Math.max(0.4, 1 - b.y / 14), 0.35);

    // Depth order: far side of the net, the net, near side.
    const items = model.players.map(p => ({ kind: 'p', p, x: p.x * m, z: p.z * m }));
    if (b.visible) items.push({ kind: 'b', x: b.x * m, y: b.y, z: b.z * m });
    items.sort((a, c) => a.z - c.z);
    for (const it of items) if (it.z < 0) this.drawItem(g, it, m);
    this.drawNet(g);
    for (const it of items) if (it.z >= 0) this.drawItem(g, it, m);

    if (b.visible) {
      const q = this.P(b.x * m, b.y, b.z * m);
      this.trail.push([q.x, q.y]);
      if (this.trail.length > 7) this.trail.shift();
    } else this.trail.length = 0;
  }

  drawItem(g, it, m) {
    if (it.kind === 'b') this.drawBall(g, it);
    else this.drawPlayer(g, it.p, it.x, it.z, m);
  }

  ring(g, x, z, r, color, w) {
    const c = this.P(x, 0, z), side = this.P(x + r, 0, z), front = this.P(x, 0, z + r);
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, w * c.s);
    g.beginPath();
    g.ellipse(c.x, c.y, Math.abs(side.x - c.x), Math.abs(front.y - c.y), 0, 0, Math.PI * 2);
    g.stroke();
  }

  shadow(g, x, z, r, alpha) {
    const c = this.P(x, 0, z), side = this.P(x + r, 0, z), front = this.P(x, 0, z + r);
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.beginPath();
    g.ellipse(c.x, c.y, Math.abs(side.x - c.x), Math.max(1, Math.abs(front.y - c.y)), 0, 0, Math.PI * 2);
    g.fill();
  }

  drawNet(g) {
    const top = [];
    for (let i = 0; i <= 16; i++) { const x = -C.NET_HALF_SPAN + (i / 16) * 2 * C.NET_HALF_SPAN; top.push(this.P(x, C.netHeightAt(x), 0)); }
    const bl = this.P(-C.NET_HALF_SPAN, 0.1, 0), br = this.P(C.NET_HALF_SPAN, 0.1, 0);
    g.beginPath();
    g.moveTo(bl.x, bl.y);
    for (const p of top) g.lineTo(p.x, p.y);
    g.lineTo(br.x, br.y);
    g.closePath();
    g.fillStyle = 'rgba(18,22,28,0.42)';
    g.fill();
    // mesh
    g.strokeStyle = 'rgba(20,22,26,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = -C.NET_HALF_SPAN; x <= C.NET_HALF_SPAN; x += 0.5) {
      const a = this.P(x, 0.1, 0), c = this.P(x, C.netHeightAt(x), 0);
      g.moveTo(a.x, a.y); g.lineTo(c.x, c.y);
    }
    for (let h = 0.5; h < 2.8; h += 0.5) {
      const a = this.P(-C.NET_HALF_SPAN, h, 0), c = this.P(C.NET_HALF_SPAN, h, 0);
      g.moveTo(a.x, a.y); g.lineTo(c.x, c.y);
    }
    g.stroke();
    // white tape and center strap
    g.strokeStyle = '#f4f6f8';
    g.lineWidth = Math.max(2, 0.16 * top[8].s);
    g.beginPath();
    top.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
    const s0 = this.P(0, 0.1, 0);
    g.lineWidth = Math.max(1.5, 0.17 * s0.s);
    g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(top[8].x, top[8].y); g.stroke();
    for (const x of [-C.NET_HALF_SPAN, C.NET_HALF_SPAN]) this.vline(g, x, 0, 0, 3.1, '#2b3038', 0.22);
  }

  drawBall(g, b) {
    for (let i = 0; i < this.trail.length - 1; i++) {
      const f = (i + 1) / this.trail.length, [x, y] = this.trail[i];
      g.fillStyle = `rgba(223,242,60,${0.22 * f})`;
      g.beginPath(); g.arc(x, y, 3 * f, 0, Math.PI * 2); g.fill();
    }
    const p = this.P(b.x, b.y, b.z), r = Math.max(3.2, 0.24 * p.s);
    g.fillStyle = '#dff23c';
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8fa316'; g.lineWidth = Math.max(1, r * 0.22); g.stroke();
  }

  drawPlayer(g, p, x, z, m) {
    const base = this.P(x, 0, z), s = base.s;
    const col = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    const skin = SKIN[p.id % SKIN.length];
    const near = z > 0;               // seen from behind
    const side = near ? 1 : -1;       // screen side of the paddle (right) hand
    const speed = Math.hypot(p.vx, p.vz);
    const run = Math.min(1, speed / 9), ph = Math.sin(this.time * 15 + p.id * 1.7) * run;
    const bob = -Math.abs(Math.sin(this.time * 15 + p.id * 1.7)) * 0.12 * s * run;
    const X = base.x, Y = base.y + bob;

    if (p.human) this.ring(g, x, z, 1.25, col, 0.14);

    g.lineCap = 'round';
    // legs and shoes
    g.strokeStyle = skin; g.lineWidth = 0.36 * s;
    g.beginPath();
    g.moveTo(X - 0.22 * s, Y - 2.7 * s); g.lineTo(X - 0.25 * s + ph * 0.55 * s, base.y - 0.25 * s);
    g.moveTo(X + 0.22 * s, Y - 2.7 * s); g.lineTo(X + 0.25 * s - ph * 0.55 * s, base.y - 0.25 * s);
    g.stroke();
    g.fillStyle = '#f2f2f2';
    for (const k of [-1, 1]) { g.beginPath(); g.ellipse(X + k * 0.26 * s - k * ph * 0.55 * s, base.y - 0.12 * s, 0.3 * s, 0.15 * s, 0, 0, Math.PI * 2); g.fill(); }

    // shorts, shirt
    g.fillStyle = '#1b2233';
    rr(g, X - 0.62 * s, Y - 3.15 * s, 1.24 * s, 0.75 * s, 0.2 * s); g.fill();
    g.fillStyle = col;
    rr(g, X - 0.6 * s, Y - 5.05 * s, 1.2 * s, 2.05 * s, 0.38 * s); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    rr(g, X - 0.6 * s, Y - 5.05 * s, 0.35 * s, 2.05 * s, 0.3 * s); g.fill();

    // arm and paddle
    let a;
    if (p.swingAnim > 0) {
      const t = 1 - p.swingAnim / C.SWING_ANIM, k = SWINGS[p.swingKind] || SWINGS.drive;
      a = t < 0.35 ? -1.0 + (k[0] + 1.0) * ease(t / 0.35) : t < 0.55 ? k[0] + (k[1] - k[0]) * ease((t - 0.35) / 0.2) : k[1] + (k[2] - k[1]) * ease((t - 0.55) / 0.45);
    } else a = -0.95 + Math.sin(this.time * 2 + p.id) * 0.04;
    const shX = X + side * 0.55 * s, shY = Y - 4.75 * s, len = 1.35 * s;
    const hx = shX + Math.cos(a) * len * side, hy = shY - Math.sin(a) * len;
    g.strokeStyle = skin; g.lineWidth = 0.27 * s;
    g.beginPath(); g.moveTo(shX, shY); g.lineTo(hx, hy); g.stroke();
    const dx = (hx - shX) / len, dy = (hy - shY) / len;
    g.strokeStyle = '#1b1d21'; g.lineWidth = 0.13 * s;
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + dx * 0.35 * s, hy + dy * 0.35 * s); g.stroke();
    g.fillStyle = shade(col, 40);
    g.beginPath();
    g.ellipse(hx + dx * 0.75 * s, hy + dy * 0.75 * s, 0.42 * s, 0.32 * s, Math.atan2(dy, dx), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, 0.05 * s); g.stroke();

    // head: cap from behind, face from the front
    const hX = X, hY = Y - 5.55 * s, hr = 0.42 * s;
    g.fillStyle = skin;
    g.beginPath(); g.arc(hX, hY, hr, 0, Math.PI * 2); g.fill();
    g.fillStyle = shade(col, -45);
    g.beginPath(); g.arc(hX, hY - 0.05 * s, hr * 1.03, Math.PI, 0); g.fill();
    if (near) { g.fillRect(hX - hr, hY - 0.08 * s, hr * 2, 0.16 * s); }
    else {
      g.fillRect(hX - hr * 1.2, hY - 0.06 * s, hr * 2.4, 0.12 * s);                 // visor
      g.fillStyle = '#222';
      g.beginPath(); g.arc(hX - 0.15 * s, hY + 0.1 * s, 0.05 * s, 0, 7); g.arc(hX + 0.15 * s, hY + 0.1 * s, 0.05 * s, 0, 7); g.fill();
    }
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

/** Lighten (+) or darken (-) a hex color. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
