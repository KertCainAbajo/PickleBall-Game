// AI opponents. The AI only sets the same intents a human controller sets
// (movement, aim) and presses the same shot buttons through playerShot, so
// the referee judges it by identical rules.

import * as C from './constants.js';
import { stepBall, firstBounce } from './world.js';
import { playerShot } from './match.js';

export const LEVELS = {
  beginner:     { label: 'Beginner',     speed: 0.78, react: 0.42, standErr: 1.1,  judge: 0.15, smart: 0.3,  serveDelay: 1.6, kitchenD: 12.5 },
  intermediate: { label: 'Intermediate', speed: 0.9,  react: 0.25, standErr: 0.55, judge: 0.6,  smart: 0.65, serveDelay: 1.2, kitchenD: 8.5 },
  advanced:     { label: 'Advanced',     speed: 1.0,  react: 0.12, standErr: 0.2,  judge: 0.95, smart: 0.9,  serveDelay: 1.0, kitchenD: 8.3 },
};

const rand = (a, b) => a + Math.random() * (b - a);

export function createBrain(level = 'intermediate') {
  return { cfg: LEVELS[level] || LEVELS.intermediate, shotId: -1, react: 0, plan: null, replanT: 0, err: { x: 0, z: 0 }, leave: false, serveT: 0 };
}

function goTo(p, x, z, prec = 0.3) {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d < prec) { p.intent.mx = p.intent.mz = 0; return; }
  const s = Math.min(1, d / 2);
  p.intent.mx = dx / d * s;
  p.intent.mz = dz / d * s;
}

export function aiThink(brain, m, p, dt) {
  const cfg = brain.cfg, w = m.world, b = w.ball, r = m.rally;
  p.speedMul = cfg.speed;

  if (m.phase === 'serve') {
    brain.shotId = -1;
    p.intent.mx = p.intent.mz = 0;
    if (p === r.server && b.state === 'held') {
      brain.serveT += dt;
      if (brain.serveT > cfg.serveDelay) {
        brain.serveT = 0;
        p.intent.aimX = rand(-0.6, 0.6);
        p.intent.aimZ = rand(-0.1, 0.8);
        playerShot(m, p, Math.random() < 0.85 ? 'drive' : 'lob');
      }
    } else brain.serveT = 0;
    return;
  }
  if (m.phase !== 'rally') { p.intent.mx = p.intent.mz = 0; return; }

  if (w.shotId !== brain.shotId) {
    brain.shotId = w.shotId;
    brain.react = cfg.react * rand(0.7, 1.3);
    brain.plan = null;
    brain.err = { x: rand(-1, 1) * cfg.standErr, z: rand(-1, 1) * cfg.standErr * 0.6 };
    brain.leave = r.lastTeam !== p.team && willBeOut(m) && Math.random() < cfg.judge;
  }

  if (r.lastTeam === p.team) { recover(m, p, cfg); return; }

  brain.replanT -= dt;
  if (!brain.plan || brain.replanT <= 0) { brain.plan = planIntercept(m, p); brain.replanT = 0.12; }
  if (!responsible(m, p, brain.plan)) { recover(m, p, cfg); return; }
  brain.react -= dt;
  if (brain.react > 0) { p.intent.mx = p.intent.mz = 0; return; }
  if (brain.leave || !brain.plan) { recover(m, p, cfg); return; }

  const P = brain.plan;
  let gz = P.sz + brain.err.z;
  const tz = C.teamZ(p.team);
  // Planning a volley: never step onto the kitchen line to make it.
  if (b.bounces === 0 && P.volley && C.inKitchen(gz)) gz = tz * (C.KITCHEN + C.FOOT + 0.35);
  goTo(p, P.sx + brain.err.x, gz, 0.15);
  // Drifted into the kitchen before the bounce: hold the swing rather than volley illegally.
  if (p.swingT > 0 && b.bounces === 0 && C.inKitchen(p.z)) p.swingT = 0;

  // Press the shot as the ball arrives; the world picks the exact contact moment.
  const d = Math.hypot(b.x - p.x, b.z - p.z), hv = Math.hypot(b.vx, b.vz);
  if (p.swingT <= 0 && d < C.REACH + hv * 0.12 && b.z * C.teamZ(p.team) > 0 && legalNow(m, p)) {
    chooseShot(m, p, cfg);
    playerShot(m, p, p.swingKind);
  }
}

/** Would contacting the ball now break the two-bounce or kitchen rule? */
function legalNow(m, p) {
  const b = m.world.ball, r = m.rally;
  if (b.bounces === 0 && (r.hits <= 2 || C.inKitchen(p.z))) return false;
  return true;
}

function willBeOut(m) {
  const r = m.rally, fb = firstBounce(m.world.ball);
  if (!fb) return false;
  if (Math.abs(fb.x) > C.HALF_W + C.BALL_R || Math.abs(fb.z) > C.HALF_L + C.BALL_R) return true;
  if (r.hits === 1) {
    const side = fb.z > 0 ? 0 : 1;
    if (Math.abs(fb.z) - C.BALL_R <= C.KITCHEN) return true;
    if (fb.x * C.courtX(side, r.court) < -C.BALL_R) return true;
  }
  return false;
}

/** Find the first point where this player can legally and reachably hit the ball. */
function planIntercept(m, p) {
  const r = m.rally, tz = C.teamZ(p.team);
  const b = { ...m.world.ball };
  const mustBounce = r.hits <= 2;
  let bounced = b.bounces > 0, t = 0, last = null;
  const sideSign = Math.sign(p.x - b.x) || 1;
  for (let k = 0; k < 220; k++) {
    const ev = stepBall(b, 1 / 60);
    t += 1 / 60;
    if (ev.net) return null;
    if (ev.bounce) { if (bounced) break; bounced = true; }
    if (b.z * tz < 0.6 || b.y < 0.6 || b.y > 6.5) continue;
    let ox = sideSign * 0.55, oz = tz * 0.85;
    const ol = Math.hypot(ox, oz);
    ox /= ol; oz /= ol;
    const sx = C.clamp(b.x + ox * C.SWEET, -17, 17);
    let sz = b.z + oz * C.SWEET;
    if (sz * tz < 0.8) sz = tz * 0.8;
    if (!bounced && (mustBounce || C.inKitchen(sz))) continue;
    last = { sx, sz, t, x: b.x, z: b.z, volley: !bounced };
    const need = Math.hypot(sx - p.x, sz - p.z) / (C.MAX_SPEED * p.speedMul) + 0.15;
    if (need <= t) return last;
  }
  return last;
}

/** In doubles, the player closer to the contact point takes the ball. */
function responsible(m, p, plan) {
  const mate = m.teams[p.team].find(q => q !== p);
  if (!mate || !plan) return true;
  const dMe = Math.hypot(plan.sx - p.x, plan.sz - p.z);
  const dMate = Math.hypot(plan.sx - mate.x, plan.sz - mate.z);
  return dMe < dMate - 0.01 || (Math.abs(dMe - dMate) <= 0.01 && p.idx === 0);
}

function recover(m, p, cfg) {
  const r = m.rally, tz = C.teamZ(p.team), b = m.world.ball;
  let depth;
  if (p.team === r.servingTeam && r.hits <= 2) depth = 22.5;                    // wait for the return to bounce
  else if (p.team !== r.servingTeam && r.hits <= 1) depth = p === r.receiver ? 22.5 : cfg.kitchenD;
  else depth = cfg.kitchenD;
  let x;
  const mate = m.teams[p.team].find(q => q !== p);
  if (mate) {
    const right = p.x > mate.x || (p.x === mate.x && p.idx === 0);
    x = (right ? 1 : -1) * 4.5;
  } else x = C.clamp(b.x * 0.4, -5, 5);
  // Stay out of the kitchen right after volleying (momentum rule).
  if (p.volleyWatch > 0) depth = Math.max(depth, Math.abs(p.z));
  goTo(p, x, tz * depth, 0.4);
}

function chooseShot(m, p, cfg) {
  const b = m.world.ball, r = m.rally, opps = m.teams[1 - p.team];
  const smart = Math.random() < cfg.smart;
  const oppNear = Math.min(...opps.map(o => Math.abs(o.z)));
  const oppDeep = opps.every(o => Math.abs(o.z) > 13);
  const ox = opps.reduce((a, o) => a + o.x, 0) / opps.length;
  let aimX = smart ? -(Math.sign(ox) || 1) * rand(0.35, 0.8) : rand(-0.4, 0.4);
  let aimZ = rand(-0.3, 0.4);
  let kind;
  if (b.y > C.SMASH_H) { kind = 'drive'; aimZ = rand(-0.4, 0.3); }
  else if (r.hits === 1) { kind = Math.random() < 0.85 ? 'drive' : 'lob'; aimZ = 0.4; aimX *= 0.6; }
  else if (r.hits === 2) kind = smart && Math.random() < 0.7 ? 'dink' : 'drive';
  else if (oppDeep) kind = smart ? 'dink' : 'drive';
  else if (b.y < 2.4 && Math.abs(p.z) < 11) kind = Math.random() < (smart ? 0.85 : 0.6) ? 'dink' : 'drive';
  else if (oppNear < 9.5 && smart && Math.random() < 0.18) kind = 'lob';
  else kind = Math.random() < 0.65 ? 'drive' : 'dink';
  p.intent.aimX = aimX;
  p.intent.aimZ = aimZ;
  p.swingKind = kind;
}
