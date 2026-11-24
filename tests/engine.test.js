import * as C from '../js/engine/constants.js';
import { createScore, rallyWon, scoreCall, serverCourt, receiverIndex } from '../js/engine/scoring.js';
import { createMatch, stepMatch, playerShot, serverOf, receiverOf } from '../js/engine/match.js';
import { aimBall, stepBall, swing, placePlayer } from '../js/engine/world.js';
import { createBrain, aiThink } from '../js/engine/ai.js';

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function eq(a, b, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
const play = (s, ...teams) => teams.reduce((st, t) => rallyWon(st, t).state, s);

// ------------------------------------------------------------ scoring

test('Traditional singles: only the server scores', () => {
  let s = createScore({ format: 'sideout', doubles: false });
  s = play(s, 0, 0);
  eq(s.scores, [2, 0]);
  const r = rallyWon(s, 1);
  eq(r.event, 'sideout');
  eq(r.state.scores, [2, 0], 'receiver must not score');
  eq(r.state.servingTeam, 1);
  eq(scoreCall(r.state), '0-2');
});

test('Win by two: 11-10 continues, 12-10 wins', () => {
  let s = createScore({ format: 'sideout' });
  s.scores = [10, 10];
  s = rallyWon(s, 0).state;
  eq(s.winner, -1, '11-10 is not a win');
  s = rallyWon(s, 0).state;
  eq(s.winner, 0);
  eq(s.scores, [12, 10]);
});

test('Doubles starts at 0-0-2 and the first fault is a side-out', () => {
  const s = createScore({ format: 'sideout', doubles: true });
  eq(scoreCall(s), '0-0-2');
  const r = rallyWon(s, 1);
  eq(r.event, 'sideout');
  eq(r.state.servingTeam, 1);
  eq(scoreCall(r.state), '0-0-1');
});

test('Doubles server rotation: point switches sides, then server 2, then side-out', () => {
  let s = createScore({ format: 'sideout', doubles: true });
  s = rallyWon(s, 1).state;                   // side-out to team 1, server 1
  const first = s.server;
  eq(serverCourt(s), 'R', 'first server after side-out is in the right court');
  s = rallyWon(s, 1).state;                   // point: server switches courts
  eq(s.server, first);
  eq(serverCourt(s), 'L');
  eq(scoreCall(s), '1-0-1');
  let r = rallyWon(s, 0);                      // fault: second server
  eq(r.event, 'second_server');
  eq(r.state.server, 1 - first);
  eq(scoreCall(r.state), '1-0-2');
  r = rallyWon(r.state, 0);                    // fault: side-out
  eq(r.event, 'sideout');
  eq(r.state.servingTeam, 0);
  eq(scoreCall(r.state), '0-1-1');
});

test('Doubles receiver is diagonal to the server', () => {
  let s = createScore({ format: 'sideout', doubles: true });
  eq(serverCourt(s), 'R');
  eq(receiverIndex(s), s.pos[1][0], 'right-court receiver');
  s = rallyWon(s, 0).state;
  eq(serverCourt(s), 'L');
  eq(receiverIndex(s), s.pos[1][1], 'left-court receiver');
});

test('Singles serving position follows the server score parity', () => {
  let s = createScore({ format: 'sideout' });
  eq(serverCourt(s), 'R');
  s = rallyWon(s, 0).state;
  eq(serverCourt(s), 'L');
  s = rallyWon(s, 0).state;
  eq(serverCourt(s), 'R');
});

test('Rally scoring: receiving team scores and gains the serve', () => {
  let s = createScore({ format: 'rally', target: 15 });
  const r = rallyWon(s, 1);
  eq(r.event, 'sideout');
  eq(r.state.scores, [0, 1]);
  eq(r.state.servingTeam, 1);
  eq(scoreCall(r.state), '1-0');
});

test('Rally scoring to 21, win by two', () => {
  let s = createScore({ format: 'rally', target: 21 });
  s.scores = [20, 20];
  s = rallyWon(s, 1).state;
  eq(s.winner, -1);
  s = rallyWon(s, 1).state;
  eq(s.winner, 1);
});

test('Rally doubles: server switches sides on a point; side-out server stands in the parity court', () => {
  let s = createScore({ format: 'rally', doubles: true });
  const srv = s.server;
  s = rallyWon(s, 0).state;
  eq(s.server, srv);
  eq(serverCourt(s), 'L');
  s = rallyWon(s, 1).state;                    // team 1 now has 1 point (odd)
  eq(s.servingTeam, 1);
  eq(serverCourt(s), 'L', 'odd score serves from the left');
});

// ------------------------------------------------------------ rules (match engine)

function rallyMatch(opts = {}) {
  const m = createMatch({ teams: [[{ ctrl: 'human' }], [{ ctrl: 'human' }]], ...opts });
  return m;
}
/** Put the match mid-rally with the ball flying from team `from` to (tx, tz). */
function liveBall(m, from, x0, y0, z0, tx, tz, T, hits = 3) {
  m.phase = 'rally';
  Object.assign(m.rally, { hits, lastTeam: from, lastPlayer: m.teams[from][0] });
  for (const p of m.players) p.bounds = null;
  const b = m.world.ball;
  b.holder = null;
  aimBall(b, x0, y0, z0, tx, tz, () => T, () => T, 0);
}
function runUntil(m, cond, maxT = 6) {
  for (let t = 0; t < maxT; t += 1 / 60) { stepMatch(m, 1 / 60); if (cond()) return true; }
  return false;
}
const lastFault = m => m.log[m.log.length - 1]?.type;
/** Place p where the ball will pass before bouncing, and swing. */
function interceptVolley(m, p, minAbsZ) {
  const b = { ...m.world.ball };
  for (let i = 0; i < 600; i++) {
    stepBall(b, 1 / 120);
    if (b.z * C.teamZ(p.team) > minAbsZ && b.y > 1 && b.y < 6) break;
  }
  placePlayer(p, b.x + C.SWEET, b.z);
  p.bounds = null;
  // Swing as the ball comes within reach, like a player would.
  runUntil(m, () => Math.hypot(m.world.ball.x - p.x, m.world.ball.z - p.z) < C.REACH || m.phase !== 'rally', 3);
  playerShot(m, p, 'drive');
}

test('Two-bounce rule: volleying the serve is a fault', () => {
  const m = rallyMatch();
  const srv = serverOf(m), rcv = receiverOf(m);
  playerShot(m, srv, 'drive');
  eq(m.phase, 'rally');
  interceptVolley(m, rcv, 10);
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'two_bounce');
  eq(m.message.team, rcv.team);
});

test('Kitchen: volley while standing in the kitchen is a fault', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 3, -15, 0, 16, 1.1);
  const p = m.teams[0][0];
  interceptVolley(m, p, 4);
  ok(C.inKitchen(p.z), 'player is in the kitchen');
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'kitchen_volley');
});

test('Kitchen: volley from behind the kitchen line is legal', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 3, -15, 0, 18, 1.1);
  const p = m.teams[0][0];
  interceptVolley(m, p, 8.5);
  ok(!C.inKitchen(p.z));
  runUntil(m, () => m.rally.hits === 4 || m.phase !== 'rally');
  eq(m.rally.hits, 4, 'volley counted as a legal shot');
});

test('Kitchen: momentum into the kitchen after a volley is a fault', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 3, -15, 0, 18, 1.1);
  const p = m.teams[0][0];
  interceptVolley(m, p, 8.5);
  runUntil(m, () => m.rally.hits === 4);
  p.intent.mz = -1;                                 // keep running toward the net
  runUntil(m, () => m.phase !== 'rally', 1);
  eq(lastFault(m), 'kitchen_momentum');
});

test('Legal groundstroke inside the kitchen after a bounce', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 2, -8, 0, 3, 0.9);              // dink landing in the kitchen
  const p = m.teams[0][0];
  placePlayer(p, 0 + C.SWEET, 4.5);
  runUntil(m, () => m.world.ball.bounces >= 1);
  playerShot(m, p, 'dink');
  runUntil(m, () => m.rally.hits === 4 || m.phase !== 'rally', 1.5);
  eq(m.rally.hits, 4);
});

function serveTo(m, tx, tz) {
  const srv = serverOf(m);
  m.phase = 'rally';
  Object.assign(m.rally, { hits: 1, lastTeam: srv.team, lastPlayer: srv });
  placePlayer(receiverOf(m), -14, -28);   // keep the receiver clear of the ball
  const b = m.world.ball;
  b.holder = null;
  aimBall(b, srv.x, 2.4, srv.z, tx, tz, () => 1.3, () => 3, 0.5);
  b.lastHitter = srv;
  b.hitAt = m.world.time;
  runUntil(m, () => m.phase !== 'rally' || m.world.ball.bounces >= 1);
}

test('Serve landing on the kitchen line is a fault', () => {
  const m = rallyMatch();
  serveTo(m, C.courtX(1, 'R') * 5, -7.05);
  eq(lastFault(m), 'serve_kitchen');
});

test('Serve just past the kitchen line is legal', () => {
  const m = rallyMatch();
  serveTo(m, C.courtX(1, 'R') * 5, -7.3);
  eq(m.phase, 'rally');
  ok(m.rally.bounced);
});

test('Serve into the wrong service court is a fault', () => {
  const m = rallyMatch();
  serveTo(m, C.courtX(1, 'L') * 5, -15);
  eq(lastFault(m), 'serve_wrong_court');
});

test('Serve past the baseline is a fault; on the baseline is in', () => {
  let m = rallyMatch();
  serveTo(m, C.courtX(1, 'R') * 5, -22.4);
  eq(lastFault(m), 'serve_out');
  m = rallyMatch();
  serveTo(m, C.courtX(1, 'R') * 5, -22.05);
  eq(m.phase, 'rally', 'line ball is in');
});

test('Serving from the wrong side of the center line is a fault', () => {
  const m = rallyMatch();
  const srv = serverOf(m);
  srv.x = -srv.x;
  playerShot(m, srv, 'drive');
  eq(lastFault(m), 'serve_position');
});

test('10-second serving rule', () => {
  const m = rallyMatch();
  runUntil(m, () => m.phase !== 'serve', 11);
  eq(lastFault(m), 'serve_timeout');
  eq(m.message.team, 0);
});

test('Out of bounds during a rally', () => {
  const m = rallyMatch();
  liveBall(m, 0, 0, 3, 15, 11, -15, 1.2);
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'out');
  eq(m.message.team, 0);
});

test('Double bounce: unreturned ball loses the rally for the receiving side', () => {
  const m = rallyMatch();
  liveBall(m, 0, 0, 3, 15, 0, -15, 1.2);
  placePlayer(m.teams[1][0], 8, -20);
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'double_bounce');
  eq(m.message.team, 1);
});

test('Net fault', () => {
  const m = rallyMatch();
  liveBall(m, 0, 0, 0.8, 12, 0, -12, 0.45);
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'net');
});

test('Touching the net during play is a fault', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 3, -15, 5, 15, 1.4);
  m.teams[0][0].x = -6;
  m.teams[0][0].z = 0.4;
  runUntil(m, () => m.phase !== 'rally', 0.2);
  eq(lastFault(m), 'net_touch');
});

test('Ball hitting a player is a fault on that player', () => {
  const m = rallyMatch();
  liveBall(m, 1, 0, 3, -15, 0, 18, 1.1);
  const p = m.teams[0][0];
  const b = { ...m.world.ball };
  for (let i = 0; i < 600 && b.z < 10; i++) stepBall(b, 1 / 120);
  placePlayer(p, b.x, b.z);
  runUntil(m, () => m.phase !== 'rally');
  eq(lastFault(m), 'body_hit');
  eq(m.message.team, 0);
});

// ------------------------------------------------------------ full matches with AI

function aiMatch(opts) {
  const n = opts.doubles ? 2 : 1;
  const teams = [0, 1].map(t => Array.from({ length: n }, () => ({ ctrl: 'ai', level: opts.levels?.[t] || 'intermediate' })));
  const m = createMatch({ ...opts, teams });
  const brains = m.players.map(p => createBrain(p.level));
  return { m, brains };
}
function runMatch(m, brains, check) {
  for (let t = 0; t < 4 * 3600 && m.phase !== 'matchOver'; t += 1 / 30) {
    m.players.forEach((p, i) => aiThink(brains[i], m, p, 1 / 30));
    const before = m.log.length;
    stepMatch(m, 1 / 30);
    if (check && m.log.length > before) check(m);
  }
}

const ILLEGAL_FOR_AI = ['two_bounce', 'kitchen_volley', 'serve_position', 'serve_timeout', 'serve_kitchen', 'serve_wrong_court', 'serve_out'];

test('Singles best-of-3 match completes with a valid final score (AI vs AI)', () => {
  const { m, brains } = aiMatch({ games: 3, levels: ['advanced', 'intermediate'] });
  runMatch(m, brains);
  eq(m.phase, 'matchOver');
  ok(m.gamesWon[m.winner] === 2, 'winner has two games');
  for (const [a, b] of m.gameScores) {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    ok(hi >= 11 && hi - lo >= 2, `game score ${a}-${b} is a valid finish`);
  }
});

test('Doubles side-out match: server positions stay consistent every rally', () => {
  const { m, brains } = aiMatch({ doubles: true, games: 1 });
  runMatch(m, brains, mm => {
    const s = mm.score;
    for (const t of [0, 1]) {
      // The player who started on the right is in the right court exactly when the team's score is even.
      const startRightInRight = s.pos[t][0] === 0;
      ok(startRightInRight === (s.scores[t] % 2 === 0), `team ${t} position parity at ${s.scores}`);
    }
  });
  eq(m.phase, 'matchOver');
});

test('Rally-scoring doubles match to 15 completes', () => {
  const { m, brains } = aiMatch({ doubles: true, format: 'rally', target: 15 });
  runMatch(m, brains);
  eq(m.phase, 'matchOver');
  const [a, b] = m.gameScores[0];
  ok(Math.max(a, b) >= 15 && Math.abs(a - b) >= 2);
});

test('AI follows the same rules: no illegal volleys or service faults', () => {
  const faults = {};
  for (const level of ['beginner', 'advanced']) {
    const { m, brains } = aiMatch({ doubles: level === 'advanced', levels: [level, level] });
    runMatch(m, brains);
    for (const t of m.stats.teams) for (const [k, v] of Object.entries(t.faults)) faults[k] = (faults[k] || 0) + v;
  }
  for (const k of ILLEGAL_FOR_AI) eq(faults[k] || 0, 0, `AI committed ${k}`);
  window.__aiFaults = faults;
});

test('Physics is deterministic: same shot, same landing spot', () => {
  const land = () => {
    const b = { x: 0, y: 0, z: 0 };
    aimBall(b, 2, 2.5, 18, -4, -15, D => D / 47, D => D / 31, 0.2);
    for (let i = 0; i < 1000; i++) if (stepBall(b, 1 / 120).bounce) break;
    return [b.x.toFixed(6), b.z.toFixed(6)];
  };
  eq(land(), land());
});
