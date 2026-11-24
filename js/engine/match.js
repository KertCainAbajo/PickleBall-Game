// Match engine: owns the world, enforces the rules (referee), applies the
// scoring state machine, runs game/match flow and collects statistics.
// UI code only reads this state and calls playerShot/playerDrop/intent.

import * as C from './constants.js';
import { createScore, rallyWon, serverCourt, receiverIndex, scoreCall, isGamePoint } from './scoring.js';
import { createPlayer, createWorld, stepWorld, contact, swing, placePlayer } from './world.js';

export const FAULTS = {
  out: 'Out',
  net: 'Into the net',
  serve_out: 'Serve out',
  serve_kitchen: 'Serve in the kitchen',
  serve_wrong_court: 'Serve in the wrong court',
  serve_position: 'Illegal serving position',
  serve_timeout: '10-second violation',
  two_bounce: 'Two-bounce rule',
  kitchen_volley: 'Volley in the kitchen',
  kitchen_momentum: 'Momentum into the kitchen',
  double_bounce: 'Double bounce',
  body_hit: 'Ball hit a player',
  net_touch: 'Player touched the net',
};

/** Faults that mean "the other side failed to return it", counted as winners. */
const WINNER_FAULTS = new Set(['double_bounce']);

export function createMatch(opts = {}) {
  const cfg = { doubles: false, format: 'sideout', target: 11, games: 1, firstServer: 0, teams: [[], []], ...opts };
  const players = [];
  let id = 0;
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < (cfg.doubles ? 2 : 1); i++) players.push(createPlayer(id++, t, i, cfg.teams[t]?.[i] || {}));
  }
  const m = {
    cfg, players,
    teams: [0, 1].map(t => players.filter(p => p.team === t)),
    world: createWorld(players),
    gameNo: 1, gamesWon: [0, 0], gameScores: [],
    firstServer: cfg.firstServer,
    score: null, phase: 'serve', timer: 0, serveClock: C.SERVE_CLOCK,
    rally: null, message: null, stats: newStats(), elapsed: 0, winner: -1,
    log: [], resetId: 0, announce: '',
  };
  m.world.handler = referee(m);
  startGame(m);
  return m;
}

function newStats() {
  const team = () => ({ points: 0, rallies: 0, aces: 0, winners: 0, volleys: 0, faults: {}, shots: { drive: 0, dink: 0, lob: 0, smash: 0 }, serves: 0 });
  return { teams: [team(), team()], rallies: 0, longestRally: 0, totalShots: 0 };
}

function startGame(m) {
  m.score = createScore({ format: m.cfg.format, doubles: m.cfg.doubles, target: m.cfg.target, firstServer: m.firstServer });
  setupServe(m);
}

export const serverOf = m => m.teams[m.score.servingTeam][m.score.doubles ? m.score.server : 0];
export const receiverOf = m => m.teams[1 - m.score.servingTeam][receiverIndex(m.score)];

/** Place everyone for the next serve. */
export function setupServe(m) {
  const s = m.score, st = s.servingTeam, rt = 1 - st, court = serverCourt(s), other = court === 'R' ? 'L' : 'R';
  const server = serverOf(m), receiver = receiverOf(m);
  for (const p of m.players) { p.swingT = 0; p.bounds = null; p.volleyWatch = 0; p.intent.mx = p.intent.mz = 0; }

  placePlayer(server, C.courtX(st, court) * 2.5, C.teamZ(st) * 23);
  server.bounds = st === 0 ? { x0: -14, x1: 14, z0: C.HALF_L + 0.05, z1: 34 } : { x0: -14, x1: 14, z0: -34, z1: -C.HALF_L - 0.05 };
  placePlayer(receiver, C.courtX(rt, court) * 5, C.teamZ(rt) * 23);
  if (s.doubles) {
    placePlayer(m.teams[st].find(p => p !== server), C.courtX(st, other) * 5, C.teamZ(st) * 22.6);
    placePlayer(m.teams[rt].find(p => p !== receiver), C.courtX(rt, other) * 5, C.teamZ(rt) * 8.2);
  }

  const b = m.world.ball;
  Object.assign(b, { state: 'held', holder: server, bounces: 0, netHit: false, lastHitter: null });
  m.rally = { hits: 0, lastTeam: -1, lastPlayer: null, server, receiver, servingTeam: st, court, bounced: false };
  m.phase = 'serve';
  m.serveClock = C.SERVE_CLOCK;
  m.resetId++;
  m.announce = scoreCall(s);
}

// ---------------------------------------------------------------- referee

function referee(m) {
  return {
    canHit(p) {
      const b = m.world.ball, r = m.rally;
      if (m.phase === 'serve') return b.state === 'drop' && p === r.server && b.bounces >= 1;
      if (m.phase !== 'rally') return false;
      return p.team !== r.lastTeam;           // one contact per side
    },

    onHit(p, info) {
      if (m.phase === 'serve') return serveContact(m, p);
      const r = m.rally;
      if (info.volley && r.hits <= 2) { fault(m, p.team, 'two_bounce', p); return null; }
      if (info.volley && C.inKitchen(p.z)) { fault(m, p.team, 'kitchen_volley', p); return null; }
      r.hits++;
      r.lastTeam = p.team;
      r.lastPlayer = p;
      r.bounced = false;
      if (info.volley) p.volleyWatch = C.MOMENTUM_WINDOW;
      return { kind: p.swingKind, aimX: p.intent.aimX, aimZ: p.intent.aimZ };
    },

    afterHit(p, kind, info) {
      const t = m.stats.teams[p.team];
      t.shots[kind] = (t.shots[kind] || 0) + 1;
      if (info.volley) t.volleys++;
      m.stats.totalShots++;
    },

    onBounce(x, z) {
      const b = m.world.ball, r = m.rally;
      if (m.phase === 'serve') {
        if (b.state === 'drop' && b.bounces >= 2) b.state = 'held';   // dropped ball not struck: re-drop
        return;
      }
      if (m.phase !== 'rally') return;
      const side = z > 0 ? 0 : 1;
      if (b.bounces === 1) {
        if (side === r.lastTeam) return fault(m, r.lastTeam, 'net', r.lastPlayer);
        const inX = Math.abs(x) <= C.HALF_W + C.BALL_R;
        const inZ = Math.abs(z) <= C.HALF_L + C.BALL_R;
        if (r.hits === 1) {
          if (!inX || !inZ) return fault(m, r.lastTeam, 'serve_out', r.lastPlayer);
          if (x * C.courtX(side, r.court) < -C.BALL_R) return fault(m, r.lastTeam, 'serve_wrong_court', r.lastPlayer);
          if (Math.abs(z) - C.BALL_R <= C.KITCHEN) return fault(m, r.lastTeam, 'serve_kitchen', r.lastPlayer);
        } else if (!inX || !inZ) {
          return fault(m, r.lastTeam, 'out', r.lastPlayer);
        }
        r.bounced = true;
      } else if (b.bounces >= 2) {
        fault(m, side, 'double_bounce', null);
      }
    },

    onNet() { if (m.phase === 'rally') fault(m, m.rally.lastTeam, 'net', m.rally.lastPlayer); },
    onBody(p) { if (m.phase === 'rally') fault(m, p.team, 'body_hit', p); },
    onNetTouch(p) { if (m.phase === 'rally') fault(m, p.team, 'net_touch', p); },
  };
}

function serveContact(m, p) {
  const r = m.rally;
  const sgn = C.courtX(p.team, r.court);
  const behind = Math.abs(p.z) >= C.HALF_L;
  const correctSide = p.x * sgn >= -0.05 && Math.abs(p.x) <= C.HALF_W + 0.05;
  if (!behind || !correctSide) { fault(m, p.team, 'serve_position', p); return null; }
  m.phase = 'rally';
  p.bounds = null;
  r.hits = 1;
  r.lastTeam = p.team;
  r.lastPlayer = p;
  m.stats.teams[p.team].serves++;
  return { kind: p.swingKind, aimX: p.intent.aimX, aimZ: p.intent.aimZ, serve: true, boxSign: C.courtX(1 - p.team, r.court) };
}

/** Rally lost by `team`. Applies scoring and records statistics exactly once. */
function fault(m, team, type, player) {
  if (m.phase !== 'rally' && m.phase !== 'serve') return;
  const r = m.rally, winnerTeam = 1 - team, b = m.world.ball;
  if (b.state !== 'held') b.state = 'dead';
  else b.holder = null;

  const st = m.stats;
  st.rallies++;
  st.longestRally = Math.max(st.longestRally, r.hits);
  st.teams[winnerTeam].rallies++;
  st.teams[team].faults[type] = (st.teams[team].faults[type] || 0) + 1;
  if (WINNER_FAULTS.has(type)) {
    st.teams[winnerTeam].winners++;
    if (r.hits === 1) st.teams[winnerTeam].aces++;
  }

  const prev = m.score;
  const { state, event } = rallyWon(prev, winnerTeam);
  const scored = state.scores[winnerTeam] > prev.scores[winnerTeam];
  if (scored) st.teams[winnerTeam].points++;
  m.score = state;
  m.message = { type, text: FAULTS[type], team, player: player ? player.name : null, winnerTeam, event, scored, call: scoreCall(state) };
  m.log.push({ type, team, event, scores: [...state.scores], hits: r.hits });
  m.world.events.push('point');
  m.phase = 'dead';
  m.timer = 2.3;

  if (state.winner >= 0) {
    m.gamesWon[state.winner]++;
    m.gameScores.push([...state.scores]);
  }
}

// ---------------------------------------------------------------- flow

export function stepMatch(m, dt) {
  if (m.phase === 'matchOver') { stepWorld(m.world, dt); return; }
  m.elapsed += dt;

  if (m.phase === 'serve') {
    m.serveClock -= dt;
    if (m.serveClock <= 0) fault(m, m.rally.servingTeam, 'serve_timeout', m.rally.server);
  }
  if (m.phase === 'rally') {
    for (const p of m.players) {
      if (p.volleyWatch <= 0) continue;
      p.volleyWatch -= dt;
      if (C.inKitchen(p.z)) { p.volleyWatch = 0; fault(m, p.team, 'kitchen_momentum', p); break; }
    }
  }

  stepWorld(m.world, dt);

  if (m.phase === 'dead') {
    m.timer -= dt;
    if (m.timer <= 0) {
      if (m.score.winner >= 0) {
        const need = Math.ceil(m.cfg.games / 2);
        if (m.gamesWon[m.score.winner] >= need) { m.phase = 'matchOver'; m.winner = m.score.winner; }
        else { m.phase = 'gameOver'; m.timer = 3; }
      } else setupServe(m);
    }
  } else if (m.phase === 'gameOver') {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.gameNo++;
      m.firstServer = 1 - m.firstServer;   // the team that received first now serves first
      startGame(m);
    }
  }
}

/** A player presses a shot button. */
export function playerShot(m, p, kind, windowScale = 1) {
  swing(p, kind, windowScale);
  const b = m.world.ball;
  if (m.phase === 'serve' && p === m.rally.server && b.state === 'held') contact(m.world, p, 0);
}

/** Server drops the ball for a drop serve (struck after it bounces). */
export function playerDrop(m, p) {
  const b = m.world.ball;
  if (m.phase === 'serve' && p === m.rally.server && b.state === 'held') {
    Object.assign(b, { state: 'drop', vx: 0, vy: 0, vz: 0, bounces: 0, y: 3.2 });
  }
}

/** 'match' | 'game' | null: whether `team` wins the game (and match) on the next rally. */
export function pointStatus(m, team) {
  if (m.phase === 'matchOver' || !isGamePoint(m.score, team)) return null;
  return m.gamesWon[team] + 1 >= Math.ceil(m.cfg.games / 2) ? 'match' : 'game';
}
