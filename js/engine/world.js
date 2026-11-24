// Deterministic physics: players, ball flight, net, bounces and paddle contact.
// The world knows nothing about scoring. It reports events to a `handler`
// (the match referee or a practice drill), which decides what they mean:
//   canHit(p) -> bool          may this player make contact right now?
//   onHit(p, info) -> shot     contact happened; return {kind, aimX, aimZ, serve?, boxSign?} or null
//   afterHit(p, kind)
//   onBounce(x, z), onNet(), onBody(p), onNetTouch(p), onTick(dt)

import * as C from './constants.js';

export const STEP = 1 / 120;

export function createPlayer(id, team, idx, spec = {}) {
  return {
    id, team, idx,
    name: spec.name || `Player ${id + 1}`,
    color: spec.color ?? (team === 0 ? 0 : 1),
    ctrl: spec.ctrl || 'ai',       // 'human' | 'ai' | 'remote'
    level: spec.level || 'intermediate',
    x: 0, z: C.teamZ(team) * 20, vx: 0, vz: 0,
    px: 0, pz: C.teamZ(team) * 20,   // previous step, for render interpolation
    facing: team === 0 ? Math.PI : 0,  // yaw; forward = (sin, cos)
    intent: { mx: 0, mz: 0, aimX: 0, aimZ: 0 },
    swingT: 0, swingKind: 'drive', swingAnim: 0, lastDist: Infinity,
    bounds: null, speedMul: 1, volleyWatch: 0,
  };
}

export function newBall() {
  return { x: 0, y: 2.4, z: 0, vx: 0, vy: 0, vz: 0, state: 'held', holder: null, bounces: 0, netHit: false, lastHitter: null, hitAt: -1 };
}

export function createWorld(players) {
  return { players, ball: newBall(), acc: 0, time: 0, handler: null, events: [], shotId: 0 };
}

/**
 * Fraction of the way from the previous physics step to the current one.
 * Rendering at prev + (cur - prev) * alpha gives smooth motion on any
 * refresh rate even though physics runs at a fixed 120 Hz.
 */
export const renderAlpha = w => Math.min(1, w.acc / STEP);
export const lerpPos = (prev, cur, a) => (prev === undefined || Math.abs(cur - prev) > 3 ? cur : prev + (cur - prev) * a);

export function defaultBounds(team) {
  return team === 0 ? { x0: -18, x1: 18, z0: 0.3, z1: 34 } : { x0: -18, x1: 18, z0: -34, z1: -0.3 };
}

export function placePlayer(p, x, z) {
  p.x = x; p.z = z; p.vx = 0; p.vz = 0;
  p.px = x; p.pz = z;
  p.facing = p.team === 0 ? Math.PI : 0;
}

export function stepWorld(w, dt) {
  w.acc += Math.min(dt, 0.1);
  while (w.acc >= STEP) {
    w.acc -= STEP;
    tick(w, STEP);
  }
}

function tick(w, dt) {
  w.time += dt;
  const b = w.ball, h = w.handler || {};
  for (const p of w.players) { p.px = p.x; p.pz = p.z; }
  b.px = b.x; b.py = b.y; b.pz = b.z;
  for (const p of w.players) movePlayer(p, dt);

  if (b.state === 'held') holdBall(b);
  else {
    const ev = stepBall(b, dt);
    if (ev.net) { w.events.push('net'); h.onNet?.(); }
    if (ev.bounce) { b.bounces++; w.events.push('bounce'); h.onBounce?.(b.x, b.z); }
  }

  if (b.state === 'live' || b.state === 'drop') {
    for (const p of w.players) {
      if (p.swingT <= 0) continue;
      if (h.canHit && !h.canHit(p)) { p.lastDist = Infinity; continue; }
      if (tryContact(w, p)) break;
    }
  }

  if (b.state === 'live') {
    for (const p of w.players) {
      if (p === b.lastHitter && w.time - b.hitAt < 0.25) continue;
      if (b.y < 5.6 && Math.hypot(b.x - p.x, b.z - p.z) < C.BODY_R) { h.onBody?.(p); break; }
    }
  }
  for (const p of w.players) if (Math.abs(p.z) < C.NET_TOUCH_Z) h.onNetTouch?.(p);
  h.onTick?.(dt);
}

function movePlayer(p, dt) {
  let mx = p.intent.mx || 0, mz = p.intent.mz || 0;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const vmax = C.MAX_SPEED * p.speedMul;
  const dvx = mx * vmax - p.vx, dvz = mz * vmax - p.vz;
  const dv = Math.hypot(dvx, dvz), maxDv = C.ACCEL * dt;
  if (dv > maxDv) { p.vx += dvx / dv * maxDv; p.vz += dvz / dv * maxDv; }
  else { p.vx += dvx; p.vz += dvz; }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const bd = p.bounds || defaultBounds(p.team);
  if (p.x < bd.x0) { p.x = bd.x0; p.vx = 0; }
  if (p.x > bd.x1) { p.x = bd.x1; p.vx = 0; }
  if (p.z < bd.z0) { p.z = bd.z0; p.vz = 0; }
  if (p.z > bd.z1) { p.z = bd.z1; p.vz = 0; }
  p.swingT = Math.max(0, p.swingT - dt);
  p.swingAnim = Math.max(0, p.swingAnim - dt);
}

function holdBall(b) {
  const p = b.holder;
  if (!p) return;
  const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
  const rx = -Math.cos(p.facing), rz = Math.sin(p.facing);
  b.x = p.x + fx * 1.1 - rx * 0.35;
  b.z = p.z + fz * 1.1 - rz * 0.35;
  b.y = 2.4;
  b.vx = b.vy = b.vz = 0;
}

/** Advance a ball one step. Returns {net, bounce}. Pure apart from mutating `b`. */
export function stepBall(b, dt) {
  const px = b.x, py = b.y, pz = b.z;
  b.vy -= C.G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let net = false, bounce = false;
  if (!b.netHit && pz !== b.z && (pz > 0) !== (b.z > 0)) {
    const f = pz / (pz - b.z);
    const xc = px + (b.x - px) * f, yc = py + (b.y - py) * f;
    if (Math.abs(xc) <= C.NET_HALF_SPAN && yc - C.BALL_R < C.netHeightAt(xc)) {
      b.z = pz > 0 ? 0.15 : -0.15;
      b.vz *= -0.12;
      b.vx *= 0.3;
      b.netHit = true;
      net = true;
    }
  }
  if (b.y <= C.BALL_R) {
    b.y = C.BALL_R;
    if (b.vy < -1.5) {
      b.vy = -b.vy * C.BOUNCE_E;
      b.vx *= C.BOUNCE_F;
      b.vz *= C.BOUNCE_F;
      bounce = true;
    } else {
      b.vy = 0;
      const k = Math.max(0, 1 - 2.5 * dt);
      b.vx *= k; b.vz *= k;
    }
  }
  return { net, bounce };
}

/** Simulate a copy of the ball until its first bounce. Returns {x, z, t} or null if it hits the net. */
export function firstBounce(ball, maxT = 4) {
  const b = { ...ball };
  for (let t = 0; t < maxT; t += 1 / 120) {
    const ev = stepBall(b, 1 / 120);
    if (ev.net) return null;
    if (ev.bounce) return { x: b.x, z: b.z, t };
  }
  return null;
}

/** Start a swing. Contact happens automatically when the ball passes the sweet spot. */
export function swing(p, kind, windowScale = 1) {
  p.swingKind = kind;
  p.swingAnim = C.SWING_ANIM;
  p.swingT = C.SWING_WINDOW * windowScale;
  p.lastDist = Infinity;
}

function tryContact(w, p) {
  const b = w.ball;
  if (b.z * C.teamZ(p.team) < -0.2) { p.lastDist = Infinity; return false; }   // ball on the other side
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  if (d > C.REACH || b.y < 0.2 || b.y > 7.8) { p.lastDist = Infinity; return false; }
  const sd = Math.abs(d - C.SWEET);
  const expiring = p.swingT <= STEP * 1.5;
  if (sd < 0.3 || sd > p.lastDist || expiring) {
    contact(w, p, Math.min(sd, p.lastDist));
    return true;
  }
  p.lastDist = sd;
  return false;
}

/** Paddle contact. `sd` = distance from the sweet spot (0 = perfect). */
export function contact(w, p, sd = 0) {
  const b = w.ball, h = w.handler || {};
  const quality = Math.max(0, 1 - sd / 1.6);
  const volley = b.state === 'live' && b.bounces === 0;
  const shot = h.onHit
    ? h.onHit(p, { volley, height: b.y, quality })
    : { kind: p.swingKind, aimX: p.intent.aimX, aimZ: p.intent.aimZ };
  p.swingT = 0;
  p.lastDist = Infinity;
  if (!shot) return false;
  const kind = launch(w, p, shot, quality);
  h.afterHit?.(p, kind, { volley, quality });
  return true;
}

/**
 * Send the ball toward a landing point chosen from the shot type and aim.
 * aimX: -1..1 in world x. aimZ: -1 (short) .. +1 (deep).
 * Poor contact (low quality) pushes the ball wider and longer, never randomly.
 */
export function launch(w, p, shot, quality = 1) {
  const b = w.ball, oz = -C.teamZ(p.team);
  let kind = shot.kind || 'drive';
  if (!shot.serve && kind === 'drive' && b.y > C.SMASH_H) kind = 'smash';
  const err = 1 - quality, side = Math.sign(b.x - p.x) || 1;
  const ax = C.clamp(shot.aimX || 0, -1, 1), az = C.clamp(shot.aimZ || 0, -1, 1);
  let tx, depth, margin, tFn, tMaxFn;

  if (shot.serve) {
    const bs = shot.boxSign;
    tx = bs * 5 + ax * 3.4;
    tx = bs > 0 ? C.clamp(tx, 0.6, 9.4) : C.clamp(tx, -9.4, -0.6);
    depth = 15 + az * 4.2;
    margin = 0.7;
    tFn = D => (kind === 'lob' ? 1.55 : kind === 'dink' ? 0.95 + D / 55 : 0.5 + D / 50);
    tMaxFn = () => 3;
  } else if (kind === 'dink') {
    tx = ax * 6.5; depth = 4.3 + az * 1.7; margin = 0.3;
    tFn = D => 0.5 + D / 36; tMaxFn = D => 0.6 + D / 14;
  } else if (kind === 'lob') {
    tx = ax * 6.5; depth = 18.5 + az * 2.5; margin = 2.5;
    tFn = D => 1.4 + D / 70; tMaxFn = () => 3.2;
  } else if (kind === 'smash') {
    tx = ax * 7.5; depth = 13 + az * 5; margin = 0.1;
    tFn = D => D / 70; tMaxFn = D => D / 42;
  } else {
    tx = ax * 7.5; depth = 16.5 + az * 4; margin = 0.2;
    tFn = D => D / 47; tMaxFn = D => D / 31;
  }
  tx += side * err * 3.4;
  depth += kind === 'dink' ? err * 4.5 : err * 3;

  aimBall(b, b.x, Math.max(b.y, 0.45), b.z, tx, oz * depth, tFn, tMaxFn, margin);
  b.lastHitter = p;
  b.hitAt = w.time;
  w.shotId++;
  p.swingAnim = Math.max(p.swingAnim, C.SWING_ANIM * 0.45);
  p.swingKind = kind;
  w.events.push(kind === 'smash' ? 'smash' : 'hit');
  return kind;
}

/**
 * Solve a no-spin trajectory from (x0,y0,z0) landing at (tx,tz).
 * Flight time starts at tFn(D) and is lengthened (up to tMaxFn(D)) until
 * the ball clears the net by `margin`. If it never does, the ball hits the net.
 */
export function aimBall(b, x0, y0, z0, tx, tz, tFn, tMaxFn, margin) {
  const dx = tx - x0, dz = tz - z0, D = Math.hypot(dx, dz);
  let T = tFn(D);
  const Tmax = Math.max(T, tMaxFn(D));
  const solve = t => ({ vx: dx / t, vz: dz / t, vy: (C.BALL_R - y0 + 0.5 * C.G * t * t) / t });
  let v = solve(T);
  while (!clearsNet(x0, y0, z0, v, margin) && T < Tmax) {
    T = Math.min(Tmax, T + 0.02);
    v = solve(T);
  }
  Object.assign(b, { x: x0, y: y0, z: z0, vx: v.vx, vy: v.vy, vz: v.vz, state: 'live', bounces: 0, netHit: false });
}

function clearsNet(x0, y0, z0, v, margin) {
  if (!v.vz) return true;
  const tn = -z0 / v.vz;
  if (tn <= 0) return true;
  const x = x0 + v.vx * tn;
  if (Math.abs(x) > C.NET_HALF_SPAN) return true;
  const y = y0 + v.vy * tn - 0.5 * C.G * tn * tn;
  return y - C.BALL_R >= C.netHeightAt(x) + margin;
}
