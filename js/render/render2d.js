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
import { charById, drawCharacter } from './characters.js';

export const PLAYER_COLORS = ['#2f6fe0', '#f2652b', '#1fa971', '#8e5be8', '#e4b11a', '#e0457b'];
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const ease = t => t * t * (3 - 2 * t);

// Arm angle keyframes per shot (radians, 0 = arm pointing out to the side, + = up).
// Full-body swing keyframes: backswing, contact, follow-through.
//   hand: [dx toward paddle side (ft), height (ft), paddle angle (0 = up, + = toward paddle side)]
//   off:  [dx toward the other side, height] for the balancing arm
//   twist: shoulder turn, crouch: knee bend
const SWINGS = {
  drive: { hand: [[1.3, 3.35, 1.9], [1.0, 3.7, 1.25], [-0.55, 5.0, -0.9]], off: [[0.95, 4.5], [0.6, 4.3], [0.15, 4.0]], twist: [0.85, 0.1, -0.85], crouch: [0.6, 0.5, 0.35] },
  dink:  { hand: [[0.85, 3.0, 2.3], [0.6, 3.15, 2.0], [0.25, 3.85, 1.3]], off: [[0.7, 4.2], [0.6, 4.1], [0.45, 4.0]], twist: [0.4, 0.1, -0.2], crouch: [0.75, 0.75, 0.6] },
  lob:   { hand: [[1.05, 2.85, 2.4], [0.8, 3.25, 1.6], [0.25, 5.6, 0.25]], off: [[0.8, 4.3], [0.6, 4.2], [0.3, 4.5]], twist: [0.5, 0.1, -0.4], crouch: [0.75, 0.55, 0.15] },
  smash: { hand: [[0.5, 6.1, -0.7], [0.75, 6.35, 0.25], [-0.4, 3.6, 2.6]], off: [[0.4, 6.0], [0.5, 5.2], [0.2, 4.0]], twist: [0.75, 0.2, -0.9], crouch: [0.2, 0.05, 0.5] },
};
const READY_HAND = [0.4, 4.05, 0.2], RUN_HAND = [0.8, 3.4, 0.75], READY_OFF = [0.45, 3.95];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const SUN = [0.42, 0.34];   // ground shadow offset per foot of height (sun from the back left)

/** Fine grain texture used to give surfaces a real material feel. */
function noisePattern(g) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d', { willReadFrequently: true }), img = x.createImageData(128, 128), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 10 + Math.random() * 22;
  }
  x.putImageData(img, 0, 0);
  return g.createPattern(c, 'repeat');
}

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    // CPU-rasterized canvases (willReadFrequently). When the browser has no real
    // GPU, "accelerated" canvas runs on an emulated GPU and is 10-30x slower;
    // measured: background blit 12.4 ms -> 0.37 ms, first build 1424 ms -> 63 ms.
    this.ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.bg = document.createElement('canvas');
    this.bgKey = '';
    this.trail = [];
    this.anims = new Map();   // per-player animation state
    this.dt = 1 / 60;
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
    const pos = [0, 34, 52], tgt = [0, 0, 0.5];   // high broadcast angle
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
    const g = bg.getContext('2d', { willReadFrequently: true });
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.lineJoin = 'round';
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const noise = noisePattern(g);
    const texture = (pts, alpha) => { g.save(); this.clipPoly(g, pts); g.globalAlpha = alpha; g.fillStyle = noise; g.fillRect(0, 0, W, H); g.restore(); };
    const BRAND = '#c8f03c', BOARD = '#d02a9c', NAVY = '#102446';

    // ---- sky and a distant tree line above the back wall
    const horizon = this.P(0, 0, -3000).y;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#2f6fb8'); sky.addColorStop(0.65, '#9cc2e2'); sky.addColorStop(1, '#e6eef3');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const cx = rnd() * W, cy = horizon * (0.1 + rnd() * 0.45), cw = W * (0.08 + rnd() * 0.1);
      for (let j = 0; j < 8; j++) {
        const x = cx + (rnd() - 0.5) * cw, y = cy + (rnd() - 0.5) * cw * 0.15, r = cw * (0.12 + rnd() * 0.15);
        const gr = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(240,245,250,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }

    // ---- venue floor (blue acrylic everywhere around the court)
    const floor = [[-40, 0, -34], [40, 0, -34], [40, 0, 44], [-40, 0, 44]];
    this.poly(g, floor, '#2758a3');
    texture(floor, 0.3);

    // ---- back wall: navy with the event branding
    this.wallZ(g, -40, 40, -34, 0, 9.5, NAVY);
    texture([[-40, 0, -34], [40, 0, -34], [40, 9.5, -34], [-40, 9.5, -34]], 0.25);
    this.wallZ(g, -40, 40, -34, 9.2, 9.5, '#2a4a80');
    this.paint(g, 'PICKLE RALLY', [0, 6.3, -34], [1, 0, 0], [0, -1, 0], 2.6, '#ffffff', '800');
    this.paint(g, 'WORLD TOUR', [0, 4.0, -34], [1, 0, 0], [0, -1, 0], 1.3, BRAND, '700');
    for (const x of [-22, 22]) {
      this.paint(g, 'PICKLE RALLY', [x, 6.6, -34], [1, 0, 0], [0, -1, 0], 1.8, '#ffffff', '800');
      this.paint(g, 'OFFICIAL BALL', [x, 4.8, -34], [1, 0, 0], [0, -1, 0], 0.8, 'rgba(255,255,255,0.7)', '600');
    }

    // ---- flower planters against the back wall
    for (const x of [-15, -12.5, 12.5, 15]) {
      const b0 = this.P(x, 0, -33), b1 = this.P(x, 3, -33), w = 1.1 * b0.s;
      g.fillStyle = '#1c1f24'; rr(g, b0.x - w / 2, b1.y, w, b0.y - b1.y, 0.1 * b0.s); g.fill();
      for (let j = 0; j < 9; j++) {
        g.fillStyle = j % 3 ? '#e65fa8' : '#f5a3cf';
        g.beginPath(); g.arc(b1.x + (rnd() - 0.5) * w, b1.y - rnd() * 0.5 * b0.s, 0.24 * b0.s, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#3f7d3a'; g.beginPath(); g.arc(b1.x, b1.y + 0.1 * b0.s, 0.35 * b0.s, 0, Math.PI * 2); g.fill();
    }

    // ---- grandstand behind the left barrier
    const rows = 5, depth = 2.8, rise = 1.4;
    const shirts = ['#d94141', '#3a7bd5', '#f2f2f2', '#2fa66b', '#f0b429', '#7b4bc4', '#222831', '#e86f2d', '#9aa3ad', '#1f4f8f'];
    const skins = ['#f1c7a5', '#d9a27c', '#b07a52', '#8a5a3b', '#5e3b26', '#e8b896'];
    const hairs = ['#1d1a18', '#5a3a24', '#c9c9c9', '#e9cc78', '#7a3b1e', '#111'];
    for (let r = rows - 1; r >= 0; r--) {
      const x0 = -27 - r * depth - depth / 2, x1 = x0 + depth, y = 1.6 + r * rise;
      this.ground(g, x0, -30, x1, 30, '#d3d5d0', y);
      this.wallX(g, x1, -30, 30, y - rise, y, '#babdb7');
      for (let z = -29; z <= 29; z += 2.2) {
        const sb = this.P(x0 + 0.5, y, z), sTop = this.P(x0 + 0.5, y + 1.5, z), sw = 0.9 * sb.s;
        g.fillStyle = '#16305e'; rr(g, sb.x - sw / 2, sTop.y, sw, sb.y - sTop.y, 0.15 * sb.s); g.fill();
        if (rnd() < 0.6) {
          const k = sb.s, px = sb.x, shirt = shirts[Math.floor(rnd() * shirts.length)];
          const tg = g.createLinearGradient(px - 0.5 * k, 0, px + 0.5 * k, 0);
          tg.addColorStop(0, shade(shirt, 25)); tg.addColorStop(1, shade(shirt, -35));
          g.fillStyle = tg; rr(g, px - 0.48 * k, sb.y - 2.3 * k, 0.96 * k, 1.75 * k, 0.35 * k); g.fill();
          g.fillStyle = skins[Math.floor(rnd() * skins.length)]; g.beginPath(); g.arc(px, sb.y - 2.75 * k, 0.36 * k, 0, Math.PI * 2); g.fill();
          g.fillStyle = hairs[Math.floor(rnd() * hairs.length)]; g.beginPath(); g.arc(px, sb.y - 2.82 * k, 0.37 * k, Math.PI * 0.95, Math.PI * 2.05); g.fill();
        }
      }
    }

    // ---- courtside lounge (left) and TV cameras (right)
    this.sofa(g, -24, -24);
    this.camera(g, 22, -12);
    this.camera(g, 22.5, 10);

    // ---- court: surface, painted logos, lines
    const court = [[-10, 0, -22], [10, 0, -22], [10, 0, 22], [-10, 0, 22]];
    this.poly(g, court, '#2d64b4');
    this.ground(g, -10, -7, 10, 7, '#4a86d2');
    texture(court, 0.28);
    this.paint(g, 'PICKLE RALLY', [0, 0, 3.6], [1, 0, 0], [0, 0, 1], 2.1, 'rgba(22,52,110,0.75)', '900');
    this.paint(g, 'PICKLE RALLY', [0, 0, -3.6], [-1, 0, 0], [0, 0, -1], 2.1, 'rgba(22,52,110,0.75)', '900');
    this.paint(g, 'PICKLE RALLY', [0, 0, 28], [1, 0, 0], [0, 0, 1], 2.6, 'rgba(255,255,255,0.92)', '900');
    this.paint(g, 'WORLD TOUR', [0, 0, 30.6], [1, 0, 0], [0, 0, 1], 1.1, 'rgba(255,255,255,0.9)', '700');
    this.paint(g, 'PICKLE RALLY', [0, 0, -27], [-1, 0, 0], [0, 0, -1], 2.2, 'rgba(255,255,255,0.85)', '900');
    for (const [x, u] of [[-13.4, [0, 0, -1]], [13.4, [0, 0, 1]]]) {
      this.paint(g, 'PICKLE RALLY', [x, 0, 12], u, [u[2] < 0 ? 1 : -1, 0, 0], 1.5, 'rgba(255,255,255,0.88)', '900');
      this.paint(g, 'RALLY TOUR', [x, 0, -12], u, [u[2] < 0 ? 1 : -1, 0, 0], 1.2, 'rgba(255,255,255,0.8)', '800');
    }
    const L = 2 / 12;
    const line = (x0, z0, x1, z1) => this.ground(g, x0, z0, x1, z1, '#f5f7f9');
    line(-10, -22, -10 + L, 22); line(10 - L, -22, 10, 22);
    line(-10, -22, 10, -22 + L); line(-10, 22 - L, 10, 22);
    line(-10, -7, 10, -7 + L); line(-10, 7 - L, 10, 7);
    line(-L / 2, -22, L / 2, -7); line(-L / 2, 7, L / 2, 22);

    // ---- net shadow
    g.fillStyle = 'rgba(0,10,30,0.2)';
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = -C.NET_HALF_SPAN + (i / 16) * 2 * C.NET_HALF_SPAN, h = C.netHeightAt(x), p = this.P(x + h * SUN[0], 0, h * SUN[1]);
      if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
    }
    for (let i = 16; i >= 0; i--) { const p = this.P(-C.NET_HALF_SPAN + (i / 16) * 2 * C.NET_HALF_SPAN, 0, 0); g.lineTo(p.x, p.y); }
    g.closePath(); g.fill();

    // ---- barrier boards: back and both sides, with shadows on the floor
    const board = (axis, at, a0, a1) => {
      const pts = axis === 'z' ? [[a0, 0, at], [a1, 0, at], [a1, 2.6, at], [a0, 2.6, at]] : [[at, 0, a0], [at, 0, a1], [at, 2.6, a1], [at, 2.6, a0]];
      const shadowPts = axis === 'z' ? [[a0, 0, at], [a1, 0, at], [a1 + 1.1, 0, at + 0.9], [a0 + 1.1, 0, at + 0.9]] : [[at, 0, a0], [at, 0, a1], [at + 1.1, 0, a1 + 0.9], [at + 1.1, 0, a0 + 0.9]];
      this.poly(g, shadowPts, 'rgba(0,10,30,0.18)');
      this.poly(g, pts, BOARD);
      texture(pts, 0.18);
      const top = axis === 'z' ? [[a0, 2.45, at], [a1, 2.45, at], [a1, 2.6, at], [a0, 2.6, at]] : [[at, 2.45, a0], [at, 2.45, a1], [at, 2.6, a1], [at, 2.6, a0]];
      this.poly(g, top, shade(BOARD, 40));
      const len = a1 - a0, n = Math.max(1, Math.round(len / 9));
      for (let i = 0; i < n; i++) {
        const c = a0 + (i + 0.5) * (len / n);
        if (axis === 'z') this.paint(g, i % 2 ? 'RALLY TOUR' : 'PICKLE RALLY', [c, 1.3, at], [1, 0, 0], [0, -1, 0], 0.95, '#ffffff', '800');
        else this.paint(g, i % 2 ? 'RALLY TOUR' : 'PICKLE RALLY', [at, 1.3, c], [0, 0, at < 0 ? -1 : 1], [0, -1, 0], 0.95, '#ffffff', '800');
      }
    };
    board('z', -31, -14, 14);
    board('x', -17, -30, -4); board('x', -17, 4, 26);
    board('x', 17, -30, -4); board('x', 17, 4, 26);

    // ---- soft vignette
    const vg = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  /**
   * Paint text onto a plane in perspective. `o` = text center (ft), `u` = text
   * direction, `v` = text "down" direction; size in feet. Uses a local affine
   * approximation, which is accurate for text-sized patches.
   */
  paint(g, text, o, u, v, size, color, weight = '800') {
    const O = this.P(o[0], o[1], o[2]);
    const U = this.P(o[0] + u[0], o[1] + u[1], o[2] + u[2]);
    const V = this.P(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
    g.save();
    g.setTransform(this.dpr * (U.x - O.x), this.dpr * (U.y - O.y), this.dpr * (V.x - O.x), this.dpr * (V.y - O.y), this.dpr * O.x, this.dpr * O.y);
    g.fillStyle = color;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** White courtside lounge sofa with two spectators. */
  sofa(g, x, z) {
    this.poly(g, [[x - 1.6, 0, z - 3.5], [x + 1.8, 0, z - 3.5], [x + 1.8, 0, z + 3.5], [x - 1.6, 0, z + 3.5]], 'rgba(0,10,30,0.2)');
    this.ground(g, x - 1.4, z - 3.2, x + 1.4, z + 3.2, '#f4f4f2', 1.6);
    this.wallX(g, x + 1.4, z - 3.2, z + 3.2, 0, 1.6, '#dcdcda');
    this.wallX(g, x - 1.4, z - 3.2, z + 3.2, 1.6, 3.4, '#e8e8e6');
    for (const [dz, shirt, skin] of [[-1.5, '#f2c230', '#d9a27c'], [1.4, '#3a7bd5', '#f1c7a5']]) {
      const p = this.P(x, 1.6, z + dz), k = p.s;
      g.fillStyle = shirt; rr(g, p.x - 0.45 * k, p.y - 2.0 * k, 0.9 * k, 1.6 * k, 0.3 * k); g.fill();
      g.fillStyle = '#2b3442'; rr(g, p.x - 0.4 * k, p.y - 0.5 * k, 1.3 * k, 0.45 * k, 0.15 * k); g.fill();
      g.fillStyle = skin; g.beginPath(); g.arc(p.x, p.y - 2.45 * k, 0.34 * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a1d14'; g.beginPath(); g.arc(p.x, p.y - 2.52 * k, 0.35 * k, Math.PI, 0); g.fill();
    }
  }

  /** Broadcast camera on a tripod. */
  camera(g, x, z) {
    const foot = this.P(x, 0, z), head = this.P(x, 5.2, z), k = foot.s;
    g.strokeStyle = '#1b1e22'; g.lineWidth = Math.max(1, 0.1 * k);
    for (const [dx, dz] of [[-0.9, 0.6], [0.9, 0.6], [0, -1]]) {
      const f = this.P(x + dx, 0, z + dz);
      g.beginPath(); g.moveTo(head.x, head.y + 0.4 * k); g.lineTo(f.x, f.y); g.stroke();
    }
    g.fillStyle = 'rgba(0,10,30,0.2)'; g.beginPath(); g.ellipse(foot.x + 0.8 * k, foot.y, 1.3 * k, 0.35 * k, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#23272d'; rr(g, head.x - 1.0 * k, head.y - 0.55 * k, 1.6 * k, 0.9 * k, 0.15 * k); g.fill();
    g.fillStyle = '#0d0f12'; rr(g, head.x - 1.6 * k, head.y - 0.42 * k, 0.7 * k, 0.62 * k, 0.12 * k); g.fill();
    g.fillStyle = '#3b6fd1'; g.beginPath(); g.arc(head.x - 1.62 * k, head.y - 0.11 * k, 0.2 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d33'; g.beginPath(); g.arc(head.x + 0.4 * k, head.y - 0.38 * k, 0.07 * k, 0, Math.PI * 2); g.fill();
  }

  clipPoly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y, z], i) => { const p = this.P(x, y, z); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
    g.closePath();
    g.clip();
  }

  /** Diamond chain-link mesh between 5.5 and 10.2 ft on a fence line. */
  chainLink(g, axis, at, a0, a1, s) {
    const pt = (u, y) => (axis === 'z' ? this.P(u, y, at) : this.P(at, y, u));
    const step = Math.max(0.35, 2.2 / Math.max(1, s));
    g.save();
    const c0 = pt(a0, 5.5), c1 = pt(a1, 5.5), c2 = pt(a1, 10.2), c3 = pt(a0, 10.2);
    g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.lineTo(c2.x, c2.y); g.lineTo(c3.x, c3.y); g.closePath(); g.clip();
    g.fillStyle = 'rgba(200,206,212,0.08)'; g.fill();
    g.strokeStyle = 'rgba(205,212,218,0.32)'; g.lineWidth = 0.7;
    g.beginPath();
    for (let u = a0 - 5; u <= a1; u += step) {
      const p = pt(u, 5.5), q = pt(u + 4.7, 10.2), r = pt(u + 4.7, 5.5), t = pt(u, 10.2);
      g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
      g.moveTo(r.x, r.y); g.lineTo(t.x, t.y);
    }
    g.stroke();
    g.restore();
    const top0 = pt(a0, 10.2), top1 = pt(a1, 10.2);   // top rail
    g.strokeStyle = '#3a3f45'; g.lineWidth = Math.max(1.5, 0.12 * s);
    g.beginPath(); g.moveTo(top0.x, top0.y); g.lineTo(top1.x, top1.y); g.stroke();
  }

  /** Fence post with a highlight. */
  post(g, x, z) {
    const a = this.P(x, 0, z), b = this.P(x, 10.4, z), w = Math.max(1.5, 0.24 * a.s);
    g.strokeStyle = '#30353b'; g.lineWidth = w;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(0.6, w * 0.3);
    g.beginPath(); g.moveTo(a.x - w * 0.2, a.y); g.lineTo(b.x - w * 0.2, b.y); g.stroke();
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
    this.dt = Math.min(0.05, dt);

    // The far view (online guest) is the same picture rotated 180 degrees.
    const m = model.view === 'far' ? -1 : 1;

    if (model.serveBox) {
      const sb = model.serveBox, x = sb.x * m, z = sb.z * m;
      this.ground(g, x - sb.w / 2, z - sb.d / 2, x + sb.w / 2, z + sb.d / 2, 'rgba(230,255,106,0.18)');
    }
    if (model.marker) this.ring(g, model.marker.x * m, model.marker.z * m, 0.55, `rgba(244,255,138,${0.65 + 0.3 * Math.sin(this.time * 9)})`, 0.12);

    // Shadows first, so they sit under every body.
    const b = model.ball;
    for (const p of model.players) this.castShadow(g, p.x * m, p.z * m);
    if (b.visible) {
      // The sun casts the ball's shadow away from it in proportion to height: a strong depth cue.
      const f = Math.max(0.35, 1 - b.y / 18);
      this.shadow(g, b.x * m + b.y * SUN[0], b.z * m + b.y * SUN[1], 0.2 + 0.1 * (1 - f), 0.32 * f);
    }

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

  /** Person-shaped shadow stretched away from the sun, plus a dark contact patch under the feet. */
  castShadow(g, x, z) {
    const p0 = this.P(x, 0, z), p1 = this.P(x + 5.6 * SUN[0], 0, z + 5.6 * SUN[1]);
    const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
    const mx = p0.x + dx * 0.5, my = p0.y + dy * 0.5;
    g.fillStyle = 'rgba(10,20,30,0.22)';
    g.beginPath();
    g.ellipse(mx, my, len * 0.55 + 0.25 * p0.s, 0.32 * p0.s, Math.atan2(dy, dx), 0, Math.PI * 2);
    g.fill();
    this.shadow(g, x, z, 0.62, 0.28);
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
    for (const x of [-C.NET_HALF_SPAN, C.NET_HALF_SPAN]) {
      this.vline(g, x, 0, 0, 3.1, '#2b3038', 0.22);
      // logo panel on each post
      const a = this.P(x - 0.75, 0.9, 0), b = this.P(x + 0.75, 2.75, 0), w = b.x - a.x, h = a.y - b.y;
      g.fillStyle = '#ffffff'; rr(g, a.x, b.y, w, h, 0.12 * a.s); g.fill();
      g.fillStyle = '#c8f03c'; rr(g, a.x + w * 0.18, b.y + h * 0.2, w * 0.64, h * 0.28, 0.06 * a.s); g.fill();
      g.fillStyle = '#d02a9c'; rr(g, a.x + w * 0.18, b.y + h * 0.55, w * 0.64, h * 0.22, 0.06 * a.s); g.fill();
    }
  }

  drawBall(g, b) {
    const p = this.P(b.x, b.y, b.z), r = Math.max(3.2, 0.24 * p.s);
    // motion streak: a tapered smear along the recent path
    const tr = this.trail;
    for (let i = 1; i < tr.length; i++) {
      const f = i / tr.length;
      g.strokeStyle = `rgba(230,245,90,${0.28 * f})`;
      g.lineWidth = r * 1.6 * f;
      g.beginPath(); g.moveTo(tr[i - 1][0], tr[i - 1][1]); g.lineTo(tr[i][0], tr[i][1]); g.stroke();
    }
    const gr = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    gr.addColorStop(0, '#fbff9a'); gr.addColorStop(0.55, '#dff23c'); gr.addColorStop(1, '#9cb119');
    g.fillStyle = gr;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    if (r > 4) {
      g.fillStyle = 'rgba(110,125,15,0.55)';
      for (const [hx, hy] of [[-0.35, -0.05], [0.3, -0.3], [0.1, 0.4], [0.45, 0.25]]) { g.beginPath(); g.arc(p.x + hx * r, p.y + hy * r, r * 0.13, 0, Math.PI * 2); g.fill(); }
    }
  }

  /** Smoothed locomotion state; the stride phase advances with distance, so feet don't slide. */
  anim(p, m) {
    let a = this.anims.get(p.id);
    if (!a) { a = { phase: Math.random() * 6, run: 0, lat: 0, latDir: 1, lean: 0, hand: [...READY_HAND], off: [...READY_OFF] }; this.anims.set(p.id, a); }
    const dt = this.dt, vx = p.vx * m, vz = p.vz * m, speed = Math.hypot(vx, vz);
    a.run += (Math.min(1, speed / 7) - a.run) * Math.min(1, dt * 10);
    if (speed > 0.6) a.lat += (Math.abs(vx) / speed - a.lat) * Math.min(1, dt * 6);
    if (Math.abs(vx) > 0.6) a.latDir = Math.sign(vx);
    const stride = 1.6 + 1.8 * (1 - a.lat);            // shuffle steps are short
    a.phase += (speed * dt / stride) * Math.PI;
    a.lean += (Math.max(-1, Math.min(1, vx / 14)) * 0.35 - a.lean) * Math.min(1, dt * 6);
    return a;
  }

  drawPlayer(g, p, x, z, m) {
    const base = this.P(x, 0, z), s = base.s;
    const team = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    const near = z > 0;               // seen from behind
    const a = this.anim(p, m);

    // Team ring under every player (bolder for players controlled on this device).
    this.ring(g, x, z, 1.2, p.human ? team : shade(team, 0, 0.55), p.human ? 0.15 : 0.08);

    // Arms and stance: ready position when still, arms pumping when running,
    // keyframed full-body motion while swinging.
    const restHand = mix(READY_HAND, RUN_HAND, a.run);
    let hand = restHand, off = READY_OFF, twist = 0, crouch = 0.35 * (1 - a.run) + 0.12 * a.run;
    if (p.swingAnim > 0) {
      const K = SWINGS[p.swingKind] || SWINGS.drive, t = 1 - p.swingAnim / C.SWING_ANIM;
      const seg = t < 0.35 ? [0, t / 0.35] : t < 0.55 ? [1, (t - 0.35) / 0.2] : [2, (t - 0.55) / 0.45];
      const e = ease(seg[1]), i = seg[0];
      hand = mix(i === 0 ? restHand : K.hand[i - 1], K.hand[i], e);
      off = mix(i === 0 ? READY_OFF : K.off[i - 1], K.off[i], e);
      const tw0 = i === 0 ? 0 : K.twist[i - 1], cr0 = i === 0 ? crouch : K.crouch[i - 1];
      twist = tw0 + (K.twist[i] - tw0) * e;
      crouch = cr0 + (K.crouch[i] - cr0) * e;
      a.hand = hand; a.off = off;
    } else {
      // ease back to the ready position after a swing
      const k = Math.min(1, this.dt * 9);
      a.hand = mix(a.hand, hand, k); a.off = mix(a.off, off, k);
      hand = a.hand; off = a.off;
    }

    // Around the moment of contact, steer the paddle face onto the ball's real position.
    let reach = null;
    if (p.swingAnim > 0 && p.contact) {
      const t = 1 - p.swingAnim / C.SWING_ANIM, w = Math.max(0, 1 - Math.abs(t - 0.45) / 0.22);
      if (w > 0) {
        const q = this.P(x + p.contact.x * m, p.contact.y, z + p.contact.z * m);
        reach = { x: q.x, y: q.y, w: ease(w) };
      }
    }

    drawCharacter(g, charById(p.char), base.x, base.y, s, {
      reach,
      near,
      side: near ? 1 : -1,            // paddle in the right hand
      paddle: team,                   // paddles show the team color
      phase: a.phase, run: a.run, lat: a.lat, latDir: a.latDir,
      lean: a.lean, crouch, twist, time: this.time + p.id,
      hand: { dx: hand[0], h: hand[1], ang: hand[2] },
      off: { dx: off[0], h: off[1] },
    });
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

/** Lighten (+) or darken (-) a hex color, optionally with alpha. */
function shade(hex, amt, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  return `rgba(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)},${alpha})`;
}
