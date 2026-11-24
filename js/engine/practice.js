// Practice drills: one human player, a ball machine on the far side, and a
// drill-specific referee that scores each attempt.

import * as C from './constants.js';
import { createPlayer, createWorld, stepWorld, aimBall, swing, contact, placePlayer } from './world.js';

export const DRILLS = {
  serve: {
    name: 'Serving',
    goal: 'Serve diagonally into the service court, past the kitchen line. Courts alternate each attempt.',
    tip: 'Shot keys serve straight from the hand (volley serve). Press Drop first for a drop serve. Hold forward to serve deep.',
  },
  return: {
    name: 'Returns',
    goal: 'Let the serve bounce, then return it deep (past the midcourt line) and in.',
    tip: 'Two-bounce rule: hitting the serve before it bounces is a fault.',
  },
  dink: {
    name: 'Dinking',
    goal: 'Dink soft balls from the kitchen line back into the opponent’s kitchen.',
    tip: 'Use the Soft shot. Let the ball bounce if you are standing in the kitchen.',
  },
  volley: {
    name: 'Volleys',
    goal: 'Stand behind the kitchen line and volley drives back before they bounce.',
    tip: 'Volleying while touching the kitchen or its line is a fault, and so is momentum carrying you in.',
  },
  position: {
    name: 'Court positioning',
    goal: 'Return the serve, then get to the kitchen line within 3 seconds.',
    tip: 'After the return, move forward and stop just behind the kitchen line.',
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const MACHINE_DELAY = 1.1;

export function createPractice(drill, spec = {}) {
  const p = createPlayer(0, 0, 0, { ...spec, ctrl: 'human' });
  const w = createWorld([p]);
  const pr = {
    drill, info: DRILLS[drill], player: p, world: w,
    attempts: 0, success: 0, streak: 0, best: 0,
    phase: 'setup', timer: 0.6, feedback: null, court: 'R',
    fromMachine: false, hit: false, returnOk: null, reached: false, deadline: 0,
    machine: { x: 0, y: 3, z: -21 }, resetId: 0,
  };
  w.handler = handler(pr);
  return pr;
}

function setup(pr) {
  const p = pr.player, w = pr.world, b = w.ball;
  pr.court = pr.attempts % 2 === 0 ? 'R' : 'L';
  pr.hit = false; pr.returnOk = null; pr.reached = false; pr.fromMachine = false;
  p.bounds = null; p.volleyWatch = 0; p.swingT = 0;
  pr.resetId++;
  switch (pr.drill) {
    case 'serve':
      placePlayer(p, C.courtX(0, pr.court) * 2.5, 23);
      p.bounds = { x0: -14, x1: 14, z0: C.HALF_L + 0.05, z1: 34 };
      Object.assign(b, { state: 'held', holder: p, bounces: 0 });
      pr.phase = 'serve';
      return;
    case 'return':
    case 'position':
      placePlayer(p, C.courtX(0, pr.court) * 5, 23);
      pr.machine = { x: C.courtX(1, pr.court) * 2.5, y: 2.4, z: -23 };
      break;
    case 'dink':
      placePlayer(p, 0, 8.3);
      pr.machine = { x: 0, y: 1.5, z: -8.5 };
      break;
    case 'volley':
      placePlayer(p, 0, 9.5);
      pr.machine = { x: 0, y: 3, z: -19 };
      break;
  }
  Object.assign(b, { state: 'dead', holder: null, x: pr.machine.x, y: pr.machine.y, z: pr.machine.z, vx: 0, vy: 0, vz: 0 });
  pr.phase = 'wait';
  pr.timer = MACHINE_DELAY;
}

function feed(pr) {
  const b = pr.world.ball, M = pr.machine, p = pr.player;
  pr.fromMachine = true;
  let tx, tz, T;
  switch (pr.drill) {
    case 'return': case 'position':
      tx = C.courtX(0, pr.court) * rand(3, 7); tz = rand(13, 19); T = 1.2; break;
    case 'dink':
      tx = rand(-5, 5); tz = rand(2.5, 6); T = 1.0; break;
    case 'volley':
      // Aim to pass the player at chest height so it can be volleyed.
      tx = p.x + rand(-2.5, 2.5); tz = p.z + 9; T = 0.85; break;
  }
  aimBall(b, M.x, M.y, M.z, tx, tz, () => T, () => T + 1, 0.4);
  b.lastHitter = null;
  pr.world.events.push('hit');
  pr.phase = 'live';
}

function result(pr, success, text) {
  if (pr.phase === 'result') return;
  pr.attempts++;
  if (success) { pr.success++; pr.streak++; pr.best = Math.max(pr.best, pr.streak); }
  else pr.streak = 0;
  pr.feedback = { success, text };
  pr.phase = 'result';
  pr.timer = 1.5;
  if (pr.world.ball.state !== 'held') pr.world.ball.state = 'dead';
  pr.world.events.push(success ? 'good' : 'point');
}

function handler(pr) {
  const p = pr.player;
  return {
    canHit() {
      const b = pr.world.ball;
      if (pr.phase === 'serve') return b.state === 'drop' && b.bounces >= 1;
      return pr.phase === 'live' && pr.fromMachine && !pr.hit;
    },
    onHit(pl, info) {
      if (pr.phase === 'serve') {
        const sgn = C.courtX(0, pr.court);
        if (pl.z < C.HALF_L || pl.x * sgn < -0.05 || Math.abs(pl.x) > C.HALF_W + 0.05) { result(pr, false, 'Illegal serving position'); return null; }
        pr.phase = 'live'; pr.fromMachine = false; pr.hit = true; pl.bounds = null;
        return { kind: pl.swingKind, aimX: pl.intent.aimX, aimZ: pl.intent.aimZ, serve: true, boxSign: C.courtX(1, pr.court) };
      }
      const twoBounce = pr.drill === 'return' || pr.drill === 'position';
      if (info.volley && twoBounce) { result(pr, false, 'Two-bounce rule: let the serve bounce'); return null; }
      if (info.volley && C.inKitchen(pl.z)) { result(pr, false, 'Volley in the kitchen'); return null; }
      if (pr.drill === 'volley' && !info.volley) { result(pr, false, 'Volley it before it bounces'); return null; }
      if (info.volley) pl.volleyWatch = C.MOMENTUM_WINDOW;
      pr.hit = true; pr.fromMachine = false;
      if (pr.drill === 'position') pr.deadline = 3;
      return { kind: pl.swingKind, aimX: pl.intent.aimX, aimZ: pl.intent.aimZ };
    },
    onBounce(x, z) {
      if (pr.phase !== 'live') return;
      const b = pr.world.ball;
      if (pr.fromMachine) {
        if (z > 0 && b.bounces >= 2) result(pr, false, 'Missed it');
        return;
      }
      if (b.bounces !== 1) return;
      const inCourt = Math.abs(x) <= C.HALF_W + C.BALL_R && Math.abs(z) <= C.HALF_L + C.BALL_R && z < 0;
      if (pr.drill === 'serve') {
        if (!inCourt) return result(pr, false, 'Serve out');
        if (x * C.courtX(1, pr.court) < -C.BALL_R) return result(pr, false, 'Wrong service court');
        if (Math.abs(z) - C.BALL_R <= C.KITCHEN) return result(pr, false, 'Serve in the kitchen');
        return result(pr, true, Math.abs(z) > 17 ? 'Deep serve!' : 'Good serve');
      }
      if (pr.drill === 'return') return result(pr, inCourt && Math.abs(z) >= 11, !inCourt ? 'Out' : Math.abs(z) >= 11 ? 'Deep return!' : 'In, but too short');
      if (pr.drill === 'dink') return result(pr, inCourt && Math.abs(z) <= C.KITCHEN, !inCourt ? 'Out' : Math.abs(z) <= C.KITCHEN ? 'Nice dink' : 'Too deep — keep it in the kitchen');
      if (pr.drill === 'volley') return result(pr, inCourt, inCourt ? 'Clean volley' : 'Out');
      if (pr.drill === 'position') {
        pr.returnOk = inCourt;
        if (!inCourt) result(pr, false, 'Return out');
        else if (pr.reached) result(pr, true, 'Return in and at the line!');
      }
    },
    onNet() { if (pr.phase === 'live' && !pr.fromMachine) result(pr, false, 'Into the net'); },
    onBody(pl) { if (pr.phase === 'live' && pr.fromMachine) result(pr, false, 'The ball hit you'); },
    onNetTouch() { if (pr.phase === 'live') result(pr, false, 'You touched the net'); },
  };
}

export function stepPractice(pr, dt) {
  const p = pr.player;
  if (pr.phase === 'setup') { pr.timer -= dt; if (pr.timer <= 0) setup(pr); }
  else if (pr.phase === 'wait') { pr.timer -= dt; if (pr.timer <= 0) feed(pr); }
  else if (pr.phase === 'result') { pr.timer -= dt; if (pr.timer <= 0) { pr.phase = 'setup'; pr.timer = 0.1; } }
  else if (pr.phase === 'live') {
    if (p.volleyWatch > 0) {
      p.volleyWatch -= dt;
      if (C.inKitchen(p.z)) result(pr, false, 'Momentum carried you into the kitchen');
    }
    if (pr.drill === 'position' && pr.hit) {
      pr.deadline -= dt;
      if (!pr.reached && Math.abs(p.z) <= 10 && !C.inKitchen(p.z)) {
        pr.reached = true;
        if (pr.returnOk) result(pr, true, 'Return in and at the line!');
      }
      if (pr.deadline <= 0 && !pr.reached) result(pr, false, 'Too slow getting to the kitchen line');
    }
  }
  stepWorld(pr.world, dt);
}

export function practiceShot(pr, kind) {
  const p = pr.player, b = pr.world.ball;
  swing(p, kind);
  if (pr.phase === 'serve' && b.state === 'held') contact(pr.world, p, 0);
}

export function practiceDrop(pr) {
  const b = pr.world.ball;
  if (pr.phase === 'serve' && b.state === 'held') Object.assign(b, { state: 'drop', vx: 0, vy: 0, vz: 0, bounces: 0, y: 3.2 });
}
