// 8-entry single-elimination tournament. You play every one of your matches;
// the other matches in each round are simulated from the entrants' ratings.

const NAMES = ['Rico Vega', 'Mae Santos', 'Jonah Reyes', 'Ava Lim', 'Theo Cruz', 'Lena Park', 'Dax Moreno', 'Iris Tan',
  'Noah Bell', 'Kai Duran', 'Sana Ortiz', 'Milo Grant', 'Tess Avila', 'Omar Flores'];
const LEVEL_OF = { 1: 'beginner', 2: 'intermediate', 3: 'advanced' };
export const ROUND_NAMES = ['Quarterfinal', 'Semifinal', 'Final'];

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createTournament({ playerName = 'You', doubles = false, format = 'sideout', target = 11 } = {}) {
  const names = shuffle([...NAMES]);
  const ratings = shuffle([1, 1, 2, 2, 2, 3, 3]);
  const entrants = [{ id: 0, name: playerName, you: true, rating: 0 }];
  for (let i = 0; i < 7; i++) {
    const name = doubles ? `${names[i * 2].split(' ')[0]} & ${names[i * 2 + 1].split(' ')[0]}` : names[i];
    entrants.push({ id: i + 1, name, you: false, rating: ratings[i] });
  }
  // Seed the strongest away from you in round one.
  const order = shuffle(entrants.slice(1)).sort((a, b) => a.rating - b.rating);
  const seeded = [entrants[0], order[0], order[3], order[4], order[1], order[5], order[2], order[6]];
  const t = {
    settings: { doubles, format, target, playerName },
    entrants, rounds: [], round: 0, status: 'active', placement: null, history: [],
  };
  t.rounds.push(pairUp(seeded.map(e => e.id)));
  return t;
}

function pairUp(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 2) out.push({ a: ids[i], b: ids[i + 1], winner: null, score: null });
  return out;
}

export const entrant = (t, id) => t.entrants.find(e => e.id === id);

/** Your match in the current round, or null if you're out / finished. */
export function nextMatch(t) {
  if (t.status !== 'active') return null;
  const m = t.rounds[t.round].find(x => (x.a === 0 || x.b === 0) && x.winner === null);
  if (!m) return null;
  const opp = entrant(t, m.a === 0 ? m.b : m.a);
  return { match: m, opponent: opp, level: LEVEL_OF[opp.rating], roundName: ROUND_NAMES[t.round] };
}

function simulate(t, m) {
  const ra = entrant(t, m.a).rating, rb = entrant(t, m.b).rating;
  const pA = 0.5 + 0.2 * (ra - rb);
  const aWins = Math.random() < pA;
  const lose = Math.floor(Math.random() * 9);
  m.winner = aWins ? m.a : m.b;
  m.score = aWins ? [t.settings.target, lose] : [lose, t.settings.target];
}

/** Record your result, simulate the rest of the round and advance. */
export function recordResult(t, youWon, score) {
  const nm = nextMatch(t);
  if (!nm) return;
  const m = nm.match;
  m.winner = youWon ? 0 : (m.a === 0 ? m.b : m.a);
  m.score = m.a === 0 ? score : [score[1], score[0]];
  t.history.push({ round: ROUND_NAMES[t.round], opponent: nm.opponent.name, won: youWon, score });
  if (!youWon) t.placement = ['Quarterfinalist', 'Semifinalist', 'Runner-up'][t.round];
  finishRound(t);
  while (t.status === 'active' && !youStillIn(t)) finishRound(t);
}

function youStillIn(t) {
  return t.rounds[t.round].some(m => m.a === 0 || m.b === 0);
}

function finishRound(t) {
  for (const m of t.rounds[t.round]) if (m.winner === null) simulate(t, m);
  const winners = t.rounds[t.round].map(m => m.winner);
  if (winners.length === 1) {
    t.status = 'complete';
    t.champion = winners[0];
    if (winners[0] === 0) t.placement = 'Champion';
    return;
  }
  t.round++;
  t.rounds.push(pairUp(winners));
}
