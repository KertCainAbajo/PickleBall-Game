// Pure scoring state machine. Every function returns new state; nothing here
// touches physics or UI. See docs/RULES.md for the rules it implements.
//
// State shape:
//   format       'sideout' (traditional) | 'rally'
//   doubles      boolean
//   target       points needed (11, 15, 21 ...), winBy margin (2)
//   scores       [team0, team1]
//   servingTeam  0 | 1
//   serverNum    1 | 2  (traditional doubles only; game starts at 0-0-2)
//   pos          pos[team] = [playerInRightCourt, playerInLeftCourt] (team-local indexes)
//   server       team-local index of the current server
//   winner       -1 until the game is won

export function createScore({ format = 'sideout', doubles = false, target = 11, winBy = 2, firstServer = 0 } = {}) {
  return {
    format, doubles, target, winBy,
    scores: [0, 0],
    servingTeam: firstServer,
    serverNum: doubles && format === 'sideout' ? 2 : 1,   // 0-0-2 start
    pos: doubles ? [[0, 1], [0, 1]] : [[0], [0]],
    server: 0,                                             // the player starting in the right court
    winner: -1,
  };
}

export function cloneScore(s) {
  return { ...s, scores: [...s.scores], pos: s.pos.map(p => [...p]) };
}

/** Which service court ('R' | 'L') the current server serves from. */
export function serverCourt(s) {
  if (!s.doubles) return s.scores[s.servingTeam] % 2 === 0 ? 'R' : 'L';
  return s.pos[s.servingTeam][0] === s.server ? 'R' : 'L';
}

/** Team-local index of the player who must receive (diagonally opposite the server). */
export function receiverIndex(s) {
  if (!s.doubles) return 0;
  const rt = 1 - s.servingTeam;
  return serverCourt(s) === 'R' ? s.pos[rt][0] : s.pos[rt][1];
}

/** Court ('R' | 'L') a player is positioned in. */
export function courtOfPlayer(s, team, idx) {
  if (!s.doubles) {
    // Singles: both players line up on the side given by the server's score.
    return serverCourt(s);
  }
  return s.pos[team][0] === idx ? 'R' : 'L';
}

/**
 * Apply the result of a rally won by `team`.
 * Returns { state, event } where event is one of
 * 'point' | 'second_server' | 'sideout' | 'game'.
 */
export function rallyWon(prev, team) {
  const s = cloneScore(prev);
  if (s.winner >= 0) return { state: s, event: 'none' };
  const serving = s.servingTeam;
  let event;

  if (s.format === 'rally') {
    // Every rally scores a point.
    s.scores[team]++;
    if (team === serving) {
      event = 'point';
      if (s.doubles) s.pos[team].reverse();   // server switches sides, keeps serving
    } else {
      event = 'sideout';
      s.servingTeam = team;
      if (s.doubles) {
        // Receivers don't switch sides; the player in the court matching the
        // new score (even = right, odd = left) serves.
        s.server = s.pos[team][s.scores[team] % 2 === 0 ? 0 : 1];
      }
    }
  } else if (team === serving) {
    s.scores[team]++;
    event = 'point';
    if (s.doubles) s.pos[team].reverse();
  } else if (s.doubles && s.serverNum === 1) {
    s.serverNum = 2;
    s.server = 1 - s.server;                  // partner serves from where they stand
    event = 'second_server';
  } else {
    s.servingTeam = team;
    event = 'sideout';
    if (s.doubles) {
      s.serverNum = 1;
      s.server = s.pos[team][0];              // player in the right court serves first
    }
  }

  const other = 1 - team;
  if (s.scores[team] >= s.target && s.scores[team] - s.scores[other] >= s.winBy) {
    s.winner = team;
    event = 'game';
  }
  return { state: s, event };
}

/** Score as announced before a serve: "server-receiver[-serverNumber]". */
export function scoreCall(s) {
  const a = s.scores[s.servingTeam], b = s.scores[1 - s.servingTeam];
  return s.format === 'sideout' && s.doubles ? `${a}-${b}-${s.serverNum}` : `${a}-${b}`;
}

/** True if `team` wins the game by winning the next rally. */
export function isGamePoint(s, team) {
  return s.winner < 0 && rallyWon(s, team).state.winner === team;
}
