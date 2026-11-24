// Read-only "view models" built from engine state. The HUD and renderer only
// consume these, so scores are never computed in UI code.

import * as C from '../engine/constants.js';
import { scoreCall, serverCourt } from '../engine/scoring.js';
import { pointStatus, serverOf, FAULTS } from '../engine/match.js';
import { firstBounce, renderAlpha, lerpPos } from '../engine/world.js';

export const teamName = (m, t) => m.teams[t].map(p => p.name).join(' & ');

const EVENT_TEXT = { point: 'Point', sideout: 'Side out', second_server: 'Second server', game: 'Game' };

export function hudModel(m) {
  const s = m.score;
  const teams = [0, 1].map(t => ({
    name: teamName(m, t),
    color: m.teams[t][0].color,
    score: s.scores[t],
    games: m.gamesWon[t],
    serving: s.servingTeam === t,
    serverNum: s.doubles && s.format === 'sideout' && s.servingTeam === t ? s.serverNum : null,
    point: m.phase === 'serve' || m.phase === 'rally' ? pointStatus(m, t) : null,
  }));
  let banner = null;
  if (m.phase === 'dead' && m.message) {
    const msg = m.message, who = msg.player ? `${msg.player} · ` : '';
    const ev = msg.event === 'game' ? `Game to ${teamName(m, msg.winnerTeam)}` : `${EVENT_TEXT[msg.event] || ''}${msg.event === 'point' ? ` ${teamName(m, msg.winnerTeam)}` : ''}`;
    banner = { title: msg.text, sub: `${who}${ev}${msg.event !== 'game' ? ` · ${msg.call}` : ''}`, kind: msg.event };
  } else if (m.phase === 'gameOver') {
    const last = m.gameScores[m.gameScores.length - 1];
    banner = { title: `Game ${m.gameNo} complete`, sub: `${last[0]}–${last[1]} · Games ${m.gamesWon[0]}–${m.gamesWon[1]} · Next game starting`, kind: 'game' };
  } else if (m.phase === 'matchOver') {
    banner = { title: `${teamName(m, m.winner)} win${m.teams[m.winner].length > 1 ? '' : 's'} the match!`, sub: m.gameScores.map(g => g.join('–')).join(', '), kind: 'match' };
  }
  return {
    teams,
    call: scoreCall(s),
    game: `Game ${m.gameNo}${m.cfg.games > 1 ? ` of ${m.cfg.games}` : ''}`,
    format: `${m.cfg.doubles ? 'Doubles' : 'Singles'} · ${s.format === 'rally' ? 'Rally' : 'Side-out'} to ${s.target}`,
    time: m.elapsed,
    banner,
    phase: m.phase,
    serverId: m.phase === 'serve' ? serverOf(m).id : -1,
    serveClock: m.serveClock,
    hits: m.rally.hits,
    servingTeam: s.servingTeam,
    ballBounced: m.world.ball.bounces > 0,
  };
}

/**
 * Scene description for the renderer. `humanIds`: players controlled on this
 * device. Positions are interpolated between physics steps for smooth motion,
 * and the model object is reused every frame (no per-frame garbage).
 */
export function sceneModel(m, humanIds, view, cache) {
  const w = m.world, b = w.ball, a = renderAlpha(w);
  const model = cache.model || (cache.model = { players: m.players.map(() => ({})), ball: {}, marker: null, serveBox: null, view });
  model.view = view;
  let humanTeam = -1, teams = 0;
  m.players.forEach((p, i) => {
    const o = model.players[i], human = humanIds.includes(p.id);
    o.id = p.id; o.team = p.team; o.color = p.color;
    o.x = lerpPos(p.px, p.x, a); o.z = lerpPos(p.pz, p.z, a);
    o.vx = p.vx; o.vz = p.vz; o.swingAnim = p.swingAnim; o.swingKind = p.swingKind; o.human = human;
    if (human && humanTeam !== p.team) { humanTeam = p.team; teams++; }
  });
  model.ball.x = lerpPos(b.px, b.x, a);
  model.ball.y = lerpPos(b.py, b.y, a);
  model.ball.z = lerpPos(b.pz, b.z, a);
  model.ball.visible = b.state !== 'held' || !!b.holder;

  model.marker = null;
  if (teams === 1 && b.state === 'live' && m.phase === 'rally' && b.lastHitter && b.lastHitter.team !== humanTeam) {
    if (cache.shotId !== w.shotId) { cache.shotId = w.shotId; cache.fb = firstBounce(b); }
    if (cache.fb && b.bounces === 0) model.marker = cache.fb;
  }
  model.serveBox = null;
  if (m.phase === 'serve' && humanIds.includes(serverOf(m).id)) {
    const rt = 1 - m.score.servingTeam, c = serverCourt(m.score);
    const sb = cache.sb || (cache.sb = {});
    sb.x = C.courtX(rt, c) * 5; sb.z = C.teamZ(rt) * 14.5; sb.w = 10; sb.d = 15;
    model.serveBox = sb;
  }
  return model;
}

const sumFaults = t => Object.values(t.faults).reduce((a, b) => a + b, 0);

export function resultsModel(m) {
  const st = m.stats, [a, b] = st.teams;
  const rows = [
    ['Points won', a.points, b.points],
    ['Rallies won', a.rallies, b.rallies],
    ['Aces', a.aces, b.aces],
    ['Unreturned shots', a.winners, b.winners],
    ['Volleys', a.volleys, b.volleys],
    ['Drives', a.shots.drive, b.shots.drive],
    ['Dinks', a.shots.dink, b.shots.dink],
    ['Lobs', a.shots.lob, b.shots.lob],
    ['Smashes', a.shots.smash, b.shots.smash],
    ['Faults', sumFaults(a), sumFaults(b)],
  ];
  for (const k of Object.keys(FAULTS)) {
    const fa = a.faults[k] || 0, fb = b.faults[k] || 0;
    if (fa || fb) rows.push([`· ${FAULTS[k]}`, fa, fb]);
  }
  return {
    teams: [0, 1].map(t => ({ name: teamName(m, t), color: m.teams[t][0].color, games: m.gamesWon[t] })),
    winner: m.winner,
    gameScores: m.gameScores,
    rows,
    longestRally: st.longestRally,
    rallies: st.rallies,
    duration: m.elapsed,
    faultsByTeam: [a.faults, b.faults],
    aces: [a.aces, b.aces],
    points: [a.points, b.points],
  };
}

export const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
