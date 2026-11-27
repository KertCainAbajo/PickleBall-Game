import * as C from './engine/constants.js';
import { createMatch, stepMatch, playerShot, playerDrop, FAULTS } from './engine/match.js';
import { createBrain, aiThink, LEVELS } from './engine/ai.js';
import { createPractice, stepPractice, practiceShot, practiceDrop, DRILLS } from './engine/practice.js';
import { createTournament, nextMatch, recordResult, entrant, ROUND_NAMES } from './engine/tournament.js';
import { createScore, rallyWon, scoreCall } from './engine/scoring.js';
import { firstBounce, renderAlpha, lerpPos } from './engine/world.js';
import { Renderer2D, PLAYER_COLORS } from './render/render2d.js';
import { CHARACTERS, charById, pickCharacters, drawPortrait, drawPreview } from './render/characters.js';
import { hudModel, sceneModel, resultsModel, fmtTime } from './app/view.js';
import { LESSONS } from './app/lessons.js';
import { hostRoom, joinRoom } from './net.js';
import { sfx, unlockAudio, setVolume } from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = v => Math.round(v * 100) / 100;
const touchDevice = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- persistence
const store = {
  get(k, d) { try { const v = localStorage.getItem('pickle-rally:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pickle-rally:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const settings = Object.assign({ name: 'You', color: 0, char: 'ace', graphics: 'auto', volume: 0.8, marker: true, hints: true, dev: false }, store.get('settings', {}));
// Older saves defaulted to 'high'; switch them to the adaptive mode once.
const setup = Object.assign({ doubles: false, format: 'sideout', target: 11, games: 1, level: 'intermediate', p2name: 'Player 2', p2color: 1, p2char: 'luna' }, store.get('setup', {}));
const defaultCareer = () => ({ matches: 0, wins: 0, losses: 0, local: 0, online: 0, pointsFor: 0, pointsAgainst: 0, aces: 0, longestRally: 0, faults: {}, playTime: 0, tournaments: 0, titles: 0, bestFinish: null, practice: { attempts: 0, success: 0 } });
let career = Object.assign(defaultCareer(), store.get('career', {}));
let tour = store.get('tournament', null);
setVolume(settings.volume);

// ---------------------------------------------------------------- renderer
// Graphics levels: High / Medium / Low use the 3D renderer; Lite 2D runs on anything.
// Auto picks a level from the hardware, then only steps DOWN when measured frame
// times stay too long (stable thresholds + cooldown, so it never flip-flops).
const LADDER = ['high', 'medium', 'low', '2d'];
const renderer2d = new Renderer2D($('#view'));
let renderer = renderer2d, renderer3d = null, gfx = '2d', level = '2d', loading3d = null;

/** Does this browser have a real (hardware) GPU for WebGL? */
function probeGPU() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { ok: false, gpu: 'no WebGL' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: !/swiftshader|software|llvmpipe|basic render/i.test(gpu), gpu };
  } catch { return { ok: false, gpu: 'error' }; }
}
const gpuInfo = probeGPU();
// WebGL that runs on a software renderer (e.g. "Microsoft Basic Render Driver") means
// Chrome's graphics acceleration is broken; compositing then caps the game around
// 25-30 FPS. Measured fixes: a working GPU, or acceleration switched off (60 FPS).
const brokenGPU = !gpuInfo.ok && !/no WebGL|error/.test(gpuInfo.gpu);
if (settings.graphics === '3d') { settings.graphics = 'auto'; store.set('settings', settings); }   // old setting name

function use2D(note) {
  gfx = '2d'; level = '2d';
  renderer = renderer2d;
  $('#view').hidden = false;
  $('#view3d').hidden = true;
  if (note) toast(note);
}

/** Load 3D in the background (2D keeps running), then switch when fully ready. */
async function use3D(q) {
  level = q;
  if (renderer3d) { renderer3d.setQuality(q); show3D(); return; }
  if (loading3d) return;
  const bar = $('#load3d'), fill = bar.querySelector('i'), label = bar.querySelector('span');
  const progress = p => { fill.style.width = `${Math.round(p * 100)}%`; label.textContent = `Loading realistic 3D… ${Math.round(p * 100)}%`; };
  bar.hidden = false; progress(0.02);
  loading3d = (async () => {
    try {
      const mod = await import('./render/scene3d.js');
      progress(0.1);
      const r3 = new mod.Renderer3D($('#view3d'));
      r3.setQuality(level === '2d' ? 'medium' : level);
      await r3.prepare(p => progress(0.1 + 0.9 * p));
      renderer3d = r3;
      if (level !== '2d') show3D();
    } catch (e) {
      console.warn('3D unavailable, using 2D', e);
      use2D('Realistic 3D could not load, so the game is using Lite 2D.');
    } finally {
      bar.hidden = true;
      loading3d = null;
    }
  })();
}

function show3D() {
  gfx = '3d';
  renderer = renderer3d;
  renderer3d.setQuality(level);
  perf.reset(performance.now());
  $('#view3d').hidden = false;
  $('#view').hidden = true;
}

function applyGraphics() {
  const want = settings.graphics;
  if (want === '2d' || (want === 'auto' && !gpuInfo.ok)) return use2D();
  use3D(want === 'auto' ? 'medium' : want);
}

/** Frame-time watchdog for Auto: two bad 2-second windows in a row -> one step down, then an 8 s cooldown. */
const perf = {
  win: [], winStart: 0, strikes: 0, cooldownUntil: 0,
  reset(now) { this.win.length = 0; this.winStart = now; this.strikes = 0; this.cooldownUntil = now + 6000; },
  sample(ms, now) {
    if (settings.graphics !== 'auto' || gfx !== '3d' || document.hidden || ms > 250) return;
    this.win.push(ms);
    if (now - this.winStart < 2000) return;
    const sorted = [...this.win].sort((x, y) => x - y);
    const avg = this.win.reduce((x, y) => x + y, 0) / this.win.length, p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.win.length = 0; this.winStart = now;
    this.strikes = avg > 19 || p90 > 30 ? this.strikes + 1 : 0;
    if (this.strikes >= 2 && now > this.cooldownUntil) {
      const next = LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(level) + 1)];
      if (next === '2d') use2D('Switched to Lite 2D graphics to keep the game smooth.');
      else { level = next; renderer3d.setQuality(next); toast(`Graphics lowered to ${next[0].toUpperCase() + next.slice(1)} to keep the game smooth.`); }
      this.reset(now);
    }
  },
};

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------------------------------------------------------------- screens
let screen = null;
const backStack = [];
const onShow = {};
function show(id, push = true) {
  if (push && screen && screen !== id) backStack.push(screen);
  screen = id;
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  onShow[id]?.();
}
function back() { const prev = backStack.pop(); if (prev) show(prev, false); else show('scr-main', false); }
function hideScreens() { for (const s of $$('.screen')) s.hidden = true; screen = null; backStack.length = 0; }
$$('[data-back]').forEach(b => b.addEventListener('click', () => { if (screen === 'scr-room') closeRoom(); back(); }));

// ---------------------------------------------------------------- input
const SCHEMES = {
  solo: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], drive: ['KeyJ', 'Space'], dink: ['KeyK'], lob: ['KeyL'], drop: ['KeyH'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drive: ['KeyF'], dink: ['KeyG'], lob: ['KeyR'], drop: ['KeyQ'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drive: ['Period', 'Numpad2'], dink: ['Comma', 'Numpad1'], lob: ['Slash', 'Numpad3'], drop: ['Enter', 'NumpadEnter', 'Numpad0'] },
};
const KEY_LABELS = {
  solo: { drive: 'J', dink: 'K', lob: 'L', drop: 'H', move: 'WASD' },
  p1: { drive: 'F', dink: 'G', lob: 'R', drop: 'Q', move: 'WASD' },
  p2: { drive: '.', dink: ',', lob: '/', drop: 'Enter', move: 'arrows' },
};
const GAME_KEYS = new Set(Object.values(SCHEMES).flatMap(s => Object.values(s).flat()));
const keys = new Set();
const stick = { active: false, x: 0, y: 0 };

function actionFor(scheme, code) {
  for (const a of ['drive', 'dink', 'lob', 'drop']) if (SCHEMES[scheme][a].includes(code)) return a;
  return null;
}

function applyHumanInput(h, p, view) {
  const k = SCHEMES[h.scheme], on = a => k[a].some(c => keys.has(c));
  let sx = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
  let sy = (on('up') ? 1 : 0) - (on('down') ? 1 : 0);
  if (h.scheme === 'solo' && stick.active) { sx += stick.x; sy += stick.y; }
  const flip = view === 'far' ? -1 : 1;
  const mx = C.clamp(sx, -1, 1) * flip, mz = -C.clamp(sy, -1, 1) * flip;
  p.intent.mx = mx;
  p.intent.mz = mz;
  p.intent.aimX = mx;
  p.intent.aimZ = C.clamp(-mz * C.teamZ(p.team), -1, 1);
}

addEventListener('keydown', e => {
  unlockAudio();
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Escape' || (e.code === 'KeyP' && S && S.type !== 'demo')) {
    e.preventDefault();
    if (screen === 'scr-pause') resume();
    else if (S && S.type !== 'demo' && !screen) pause();
    else if (screen && screen !== 'scr-main' && screen !== 'scr-results') back();
    return;
  }
  if (GAME_KEYS.has(e.code) && S && S.type !== 'demo' && !screen) e.preventDefault();
  keys.add(e.code);
  if (!S || S.type === 'demo' || S.paused || screen || e.repeat) return;
  for (const h of S.humans) { const a = actionFor(h.scheme, e.code); if (a) doAction(h, a); }
});
addEventListener('keyup', e => keys.delete(e.code));
// F3 toggles the developer performance monitor.
addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); settings.dev = !settings.dev; store.set('settings', settings); } });
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', unlockAudio);

// touch joystick and buttons
(() => {
  const el = $('#stick'), knob = el.querySelector('.knob');
  let id = null;
  const move = e => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    stick.x = Math.abs(dx) < 0.18 ? 0 : dx; stick.y = Math.abs(dy) < 0.18 ? 0 : -dy;
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  };
  el.addEventListener('pointerdown', e => { id = e.pointerId; el.setPointerCapture(id); stick.active = true; move(e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; stick.active = false; stick.x = stick.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  $$('.shot-pad button').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S && S.humans[0] && !S.paused) doAction(S.humans[0], b.dataset.act);
    b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120);
  }));
})();

function doAction(h, act) {
  if (S.type === 'practice') { act === 'drop' ? practiceDrop(S.pr) : practiceShot(S.pr, act); return; }
  if (S.type === 'guest') {
    S.room?.send(act === 'drop' ? { t: 'drop' } : { t: 'shot', k: act });
    if (act !== 'drop') S.localSwing = { t: C.SWING_ANIM, kind: act };
    return;
  }
  const p = S.m.players[h.id];
  if (act === 'drop') playerDrop(S.m, p); else playerShot(S.m, p, act);
}

// ---------------------------------------------------------------- sessions
let S = null;
const CPU_NAMES = ['Rico', 'Mae', 'Jonah', 'Ava', 'Theo', 'Lena', 'Dax', 'Iris'];
const pickCpu = n => [...CPU_NAMES].sort(() => Math.random() - 0.5).slice(0, n);
const otherColor = (...used) => [0, 1, 2, 3, 4, 5].find(c => !used.includes(c));

function matchSession(type, m, humans, extra = {}) {
  const brains = new Map();
  for (const p of m.players) if (p.ctrl === 'ai') brains.set(p.id, createBrain(p.level));
  return { type, m, humans, brains, view: 'near', cache: {}, paused: false, ended: false, endT: 0, ...extra };
}

function enterGame() {
  hideScreens();
  $('#hud').hidden = false;
  $('#touch').hidden = !touchDevice || !S.humans.some(h => h.scheme === 'solo');
  $('#hud-practice').hidden = S.type !== 'practice';
  $('.scorebug').hidden = $('.callbox').hidden = S.type === 'practice';
}

function startDemo() {
  const names = pickCpu(4), chars = pickCharacters(4);
  const m = createMatch({ doubles: true, format: 'rally', target: 11, teams: [[0, 1].map(i => ({ name: names[i], color: 0, level: 'advanced', char: chars[i] })), [2, 3].map(i => ({ name: names[i], color: 1, level: 'advanced', char: chars[i] }))] });
  S = matchSession('demo', m, []);
  $('#hud').hidden = true;
  $('#touch').hidden = true;
}

function toMenu() {
  if (S?.type === 'practice') savePractice();
  closeRoom();
  startDemo();
  show('scr-main', false);
  backStack.length = 0;
}

function you() { return { name: settings.name || 'You', color: settings.color, char: settings.char, ctrl: 'human' }; }

/** Give every player spec without a character a random one not already in use. */
function assignChars(specs) {
  const used = specs.map(s => s.char).filter(Boolean);
  const free = pickCharacters(specs.length, used);
  let i = 0;
  for (const s of specs) if (!s.char) s.char = free[i++];
}

function startQuick() {
  const me = you(), cpuColor = otherColor(me.color), names = pickCpu(3), lvl = setup.level;
  const t0 = [me], t1 = [{ name: names[0], color: cpuColor, level: lvl }];
  if (setup.doubles) { t0.push({ name: names[1], color: me.color, level: lvl }); t1.push({ name: names[2], color: cpuColor, level: lvl }); }
  assignChars([...t0, ...t1]);
  const m = createMatch({ ...matchCfg(), teams: [t0, t1] });
  S = matchSession('match', m, [{ id: 0, scheme: 'solo' }], { mode: 'quick', myTeam: 0, restart: startQuick });
  enterGame();
}

function startLocal() {
  const c1 = settings.color, c2 = setup.p2color === c1 ? otherColor(c1) : setup.p2color;
  const p1 = { name: settings.name || 'Player 1', color: c1, char: settings.char, ctrl: 'human' }, p2 = { name: setup.p2name || 'Player 2', color: c2, char: setup.p2char, ctrl: 'human' };
  const names = pickCpu(2), t0 = [p1], t1 = [p2];
  if (setup.doubles) { t0.push({ name: names[0], color: c1, level: setup.level }); t1.push({ name: names[1], color: c2, level: setup.level }); }
  assignChars([...t0, ...t1]);
  const m = createMatch({ ...matchCfg(), teams: [t0, t1] });
  const p2id = m.teams[1][0].id;
  S = matchSession('match', m, [{ id: 0, scheme: 'p1' }, { id: p2id, scheme: 'p2' }], { mode: 'local', myTeam: null, restart: startLocal });
  enterGame();
}

function startTournamentMatch() {
  const nm = nextMatch(tour);
  if (!nm) return;
  const me = you(), oppColor = otherColor(me.color), ts = tour.settings;
  const oppNames = nm.opponent.name.split(' & ');
  const t0 = [me], t1 = [{ name: oppNames[0], color: oppColor, level: nm.level }];
  if (ts.doubles) { t0.push({ name: 'Partner', color: me.color, level: 'advanced' }); t1.push({ name: oppNames[1] || 'Partner', color: oppColor, level: nm.level }); }
  assignChars([...t0, ...t1]);
  const m = createMatch({ doubles: ts.doubles, format: ts.format, target: ts.target, games: 1, teams: [t0, t1] });
  S = matchSession('match', m, [{ id: 0, scheme: 'solo' }], { mode: 'tournament', myTeam: 0, restart: startTournamentMatch, roundName: nm.roundName });
  enterGame();
}

function startPractice(drill) {
  if (S?.type === 'practice') savePractice();
  const pr = createPractice(drill, { name: settings.name, color: settings.color, char: settings.char });
  S = { type: 'practice', pr, humans: [{ id: 0, scheme: 'solo' }], view: 'near', paused: false, restart: () => startPractice(drill) };
  $('#hud-practice .pc-title').textContent = pr.info.name;
  $('#hud-practice .pc-goal').textContent = pr.info.goal;
  enterGame();
}

function savePractice() {
  if (S?.type !== 'practice' || S.saved) return;
  S.saved = true;
  career.practice.attempts += S.pr.attempts;
  career.practice.success += S.pr.success;
  store.set('career', career);
}

const matchCfg = () => ({ doubles: setup.doubles, format: setup.format, target: setup.target, games: setup.games });

// ---------------------------------------------------------------- per-frame update
function update(dt) {
  if (S.type === 'practice') {
    applyHumanInput(S.humans[0], S.pr.player, 'near');
    stepPractice(S.pr, dt);
    S.pr.world.events.splice(0).forEach(sfx);
    return;
  }
  if (S.type === 'guest') { guestUpdate(dt); return; }
  const m = S.m;
  for (const h of S.humans) applyHumanInput(h, m.players[h.id], S.view);
  for (const [id, brain] of S.brains) aiThink(brain, m, m.players[id], dt);
  stepMatch(m, dt);
  const ev = m.world.events.splice(0);
  if (S.type !== 'demo') ev.forEach(sfx);
  if (S.online) hostSend(ev);
  if (S.type === 'demo') { if (m.phase === 'matchOver') startDemo(); return; }
  if (m.phase === 'matchOver' && !S.ended) { S.ended = true; S.endT = 2.2; }
  if (S.ended && S.endT > 0) { S.endT -= dt; if (S.endT <= 0) finishMatch(); }
}

// ---------------------------------------------------------------- HUD
const rows = $$('.sb-row');
function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }

function renderHud(h, humanTeams, prompt) {
  h.teams.forEach((t, i) => {
    const row = rows[i];
    const chip = row.querySelector('.sb-chip'), col = PLAYER_COLORS[t.color % PLAYER_COLORS.length];
    if (chip.dataset.c !== col) { chip.dataset.c = col; chip.style.background = col; }
    setText(row.querySelector('.sb-name'), t.name);
    setText(row.querySelector('.sb-tag'), t.point === 'match' ? 'MATCH PT' : t.point === 'game' ? 'GAME PT' : '');
    const sv = row.querySelector('.sb-serve');
    sv.classList.toggle('on', t.serving);
    if (t.serving && t.serverNum) sv.dataset.n = t.serverNum; else delete sv.dataset.n;
    setText(row.querySelector('.sb-games'), h.game.includes('of') ? t.games : '');
    setText(row.querySelector('.sb-pts'), t.score);
  });
  setText($('#hud-call'), h.call);
  setText($('#hud-game'), h.game);
  setText($('#hud-format'), h.format);
  setText($('#hud-time'), fmtTime(h.time));
  const bn = $('#hud-banner');
  if (h.banner) {
    if (bn.hidden || bn.dataset.key !== h.banner.title + h.banner.sub) {
      bn.dataset.key = h.banner.title + h.banner.sub;
      bn.className = `banner ${h.banner.kind || ''}`;
      bn.querySelector('b').textContent = h.banner.title;
      bn.querySelector('span').textContent = h.banner.sub;
      bn.hidden = false;
    }
  } else bn.hidden = true;
  const clock = $('#hud-clock');
  const myServe = h.phase === 'serve' && S.humanIds?.includes(h.serverId);
  clock.hidden = !(myServe && h.serveClock <= 5.5);
  if (!clock.hidden) setText(clock, `Serve within ${Math.max(0, Math.ceil(h.serveClock))}s`);
  const pe = $('#hud-prompt');
  pe.hidden = !prompt;
  if (prompt && pe.dataset.p !== prompt) { pe.dataset.p = prompt; pe.innerHTML = prompt; }
}

function promptFor(h) {
  const server = S.humans.find(x => x.id === h.serverId);
  if (h.phase === 'serve' && server) {
    if (touchDevice && server.scheme === 'solo') return 'Your serve: tap Drive, Soft or Lob, or Drop for a drop serve';
    const k = KEY_LABELS[server.scheme];
    const who = S.humans.length > 1 ? `${S.m?.players[server.id]?.name || ''}: ` : 'Your serve: ';
    return `${esc(who)}<kbd>${k.drive}</kbd> drive · <kbd>${k.dink}</kbd> soft · <kbd>${k.lob}</kbd> lob · <kbd>${k.drop}</kbd> drop serve · aim with ${k.move}`;
  }
  if (!settings.hints || h.phase !== 'rally' || h.ballBounced) return '';
  const teams = S.humanTeams || [];
  if (h.hits === 1 && teams.some(t => t !== h.servingTeam)) return 'Let the serve bounce before you hit it';
  if (h.hits === 2 && teams.includes(h.servingTeam)) return 'Let the return bounce';
  return '';
}

function renderPracticeHud(pr) {
  for (const k of ['success', 'attempts', 'streak', 'best']) setText($(`#hud-practice [data-k=${k}]`), pr[k]);
  const fb = $('#hud-feedback');
  if (pr.phase === 'result' && pr.feedback) {
    fb.hidden = false;
    fb.className = `feedback ${pr.feedback.success ? 'good' : 'bad'}`;
    setText(fb, pr.feedback.text);
  } else fb.hidden = true;
  const pe = $('#hud-prompt');
  let p = '';
  if (pr.phase === 'serve') p = touchDevice ? 'Tap a shot to serve, or Drop' : 'Serve: <kbd>J</kbd> drive · <kbd>K</kbd> soft · <kbd>L</kbd> lob · <kbd>H</kbd> drop · aim with WASD';
  else if (settings.hints) p = esc(pr.info.tip);
  pe.hidden = !p;
  if (p && pe.dataset.p !== p) { pe.dataset.p = p; pe.innerHTML = p; }
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), booted = false, pausedDrawn = false;

/**
 * Frame pacing. When the browser can't present 60 frames a second (measured:
 * two 2-second windows averaging over 24 ms), draw every other display frame
 * for an even 30 FPS instead of an uneven 20-30. Physics keeps its fixed 120 Hz
 * step with interpolation, so game speed and ball behavior are unchanged.
 * It locks once per session and never flips back and forth.
 */
const pacing = {
  half: false, tick: 0, win: 0, n: 0, start: 0, strikes: 0,
  sample(ms, now) {
    if (this.half || document.hidden || ms > 250 || !S || S.paused) return;
    this.win += ms; this.n++;
    if (now - this.start < 2000) return;
    const avg = this.win / this.n;
    this.win = 0; this.n = 0; this.start = now;
    this.strikes = avg > 24 ? this.strikes + 1 : 0;
    if (this.strikes >= 2) { this.half = true; console.info('Frame pacing: locked to 30 FPS for even frame times.'); }
  },
};
const dev = { el: $('#fps'), frames: [], t: 0, simMs: 0, drawMs: 0, n: 0 };

/** Developer-only performance monitor (Settings -> Developer mode, or F3). */
function devMonitor(ms, now) {
  dev.frames.push(ms);
  if (now - dev.t < 500) return;
  dev.t = now;
  dev.el.hidden = !settings.dev;
  if (!settings.dev) { dev.frames.length = 0; dev.simMs = dev.drawMs = dev.n = 0; return; }
  const f = dev.frames, avg = f.reduce((a, b) => a + b, 0) / f.length, max = Math.max(...f);
  dev.hist = (dev.hist || []).concat(1000 / avg).slice(-20);
  const lines = [
    `FPS ${Math.round(1000 / avg)}  avg ${Math.round(dev.hist.reduce((a, b) => a + b, 0) / dev.hist.length)}  min ${Math.round(1000 / max)}`,
    `frame ${avg.toFixed(1)} ms  max ${max.toFixed(1)} ms`,
    `CPU sim ${(dev.simMs / Math.max(1, dev.n)).toFixed(2)} ms  render ${(dev.drawMs / Math.max(1, dev.n)).toFixed(2)} ms`,
    `${gfx === '3d' ? `3D ${level}` : 'Lite 2D'}  ·  ${gpuInfo.gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 42)}`,
  ];
  if (gfx === '3d') {
    const i = renderer3d.renderer.info;
    lines.push(`draw calls ${i.render.calls}  triangles ${(i.render.triangles / 1000).toFixed(0)}k  geo ${i.memory.geometries}  tex ${i.memory.textures}`);
  }
  if (performance.memory) lines.push(`JS heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB`);
  lines.push(`players ${S?.m ? S.m.players.length : S?.pr ? 1 : 0}  ·  F3 hides this`);
  dev.el.textContent = lines.join('\n');
  f.length = 0; dev.simMs = dev.drawMs = dev.n = 0;
}

function frame(now) {
  if (pacing.half && (pacing.tick++ & 1)) { requestAnimationFrame(frame); return; }
  const ms = now - last;
  const dt = Math.min(0.05, ms / 1000);
  last = now;
  perf.sample(ms, now);
  pacing.sample(ms, now);
  const t0 = performance.now();
  if (S && !S.paused) update(dt);
  const t1 = performance.now();
  // While paused, the picture doesn't change: draw once, then stop rendering.
  // Behind menus on a broken-GPU browser, redraw the demo only every 6th frame:
  // an unchanged canvas composites cheaply, so the menu itself stays responsive.
  const menuThrottle = brokenGPU && screen && S?.type === 'demo' && (dev.n % 6) !== 0;
  if (S && !menuThrottle && (!S.paused || !pausedDrawn)) { draw(dt); pausedDrawn = !!S.paused; }
  if (S && !S.paused) pausedDrawn = false;
  const t2 = performance.now();
  dev.simMs += t1 - t0; dev.drawMs += t2 - t1; dev.n++;
  devMonitor(ms, now);
  if (!booted) { booted = true; const boot = $('#boot'); boot.classList.add('done'); setTimeout(() => boot.remove(), 500); }
  requestAnimationFrame(frame);
}

// The HUD only needs ~15 updates a second; rebuilding it every frame wastes time.
let hudAt = 0;
function hudDue() {
  const now = performance.now();
  if (now - hudAt < 66) return false;
  hudAt = now;
  return true;
}

function draw(dt) {
  let model;
  if (S.type === 'practice') {
    const pr = S.pr, b = pr.world.ball, p = pr.player;
    let marker = null;
    if (b.state === 'live' && pr.fromMachine && b.bounces === 0) {
      if (S.cacheShot !== pr.world.shotId) { S.cacheShot = pr.world.shotId; S.fb = firstBounce(b); }
      marker = S.fb;
    }
    const serveBox = pr.phase === 'serve' ? { x: C.courtX(1, pr.court) * 5, z: -14.5, w: 10, d: 15 } : null;
    const a = renderAlpha(pr.world);
    model = {
      players: [{ id: 0, team: 0, color: p.color, x: lerpPos(p.px, p.x, a), z: lerpPos(p.pz, p.z, a), vx: p.vx, vz: p.vz, swingAnim: p.swingAnim, swingKind: p.swingKind, human: true }],
      ball: { x: lerpPos(b.px, b.x, a), y: lerpPos(b.py, b.y, a), z: lerpPos(b.pz, b.z, a), visible: true }, marker, serveBox, view: 'near',
    };
    if (hudDue()) renderPracticeHud(pr);
  } else if (S.type === 'guest') {
    model = guestModel();
    if (S.hud && hudDue()) renderHud(S.hud, [1], promptFor(S.hud));
  } else {
    S.humanIds = S.humans.map(h => h.id);
    S.humanTeams = [...new Set(S.humans.map(h => S.m.players[h.id].team))];
    model = sceneModel(S.m, S.humanIds, S.view, S.cache);
    if (S.type !== 'demo' && hudDue()) { const h = hudModel(S.m); renderHud(h, S.humanTeams, promptFor(h)); }
  }
  if (!settings.marker) model.marker = null;
  renderer.update(model, dt);
}

// ---------------------------------------------------------------- pause / results
function pause() {
  if (!S || S.type === 'demo') return;
  if (S.online || S.type === 'guest') { show('scr-pause'); $('#btn-restart').hidden = true; return; }
  S.paused = true;
  $('#btn-restart').hidden = false;
  show('scr-pause');
}
function resume() { hideScreens(); if (S) S.paused = false; }
$('#btn-pause').addEventListener('click', pause);
$('#btn-resume').addEventListener('click', resume);
$('#btn-restart').addEventListener('click', () => { if (S?.restart) { if (S.type === 'practice') savePractice(); S.restart(); } });
$('#btn-pause-settings').addEventListener('click', () => show('scr-settings'));
$('#btn-quit').addEventListener('click', toMenu);

function finishMatch() {
  const m = S.m, res = resultsModel(m), mine = S.myTeam;
  recordCareer(res, mine, S.mode);
  if (S.mode === 'tournament') {
    const g = m.gameScores[m.gameScores.length - 1];
    recordResult(tour, m.winner === 0, g);
    if (tour.status === 'complete') finishTournament();
    store.set('tournament', tour);
  }
  if (S.online) S.room?.send({ t: 'end', res });
  showResults(res, mine);
}

function recordCareer(res, mine, mode) {
  career.playTime += res.duration;
  if (mine === null || mine === undefined) { career.local++; store.set('career', career); return; }
  career.matches++;
  if (res.winner === mine) career.wins++; else career.losses++;
  if (mode === 'online') career.online++;
  career.pointsFor += res.points[mine];
  career.pointsAgainst += res.points[1 - mine];
  career.aces += res.aces[mine];
  career.longestRally = Math.max(career.longestRally, res.longestRally);
  for (const [k, v] of Object.entries(res.faultsByTeam[mine])) career.faults[k] = (career.faults[k] || 0) + v;
  store.set('career', career);
}

const FINISH_RANK = ['Champion', 'Runner-up', 'Semifinalist', 'Quarterfinalist'];
function finishTournament() {
  if (tour.placement === 'Champion') career.titles++;
  if (!career.bestFinish || FINISH_RANK.indexOf(tour.placement) < FINISH_RANK.indexOf(career.bestFinish)) career.bestFinish = tour.placement;
  store.set('career', career);
}

function showResults(res, mine) {
  $('#hud').hidden = true;
  $('#touch').hidden = true;
  const title = mine === null || mine === undefined ? `${res.teams[res.winner].name} win${res.teams[res.winner].name.includes('&') ? '' : 's'}` : res.winner === mine ? 'Victory' : 'Defeat';
  $('#res-title').textContent = title;
  const team = (t, i) => `<div class="res-team"><span class="stars" style="color:${PLAYER_COLORS[t.color % 6]}">●</span><b>${esc(t.name)}</b>${res.winner === i ? '<span class="badge">Winner</span>' : ''}</div>`;
  const better = (row, i) => {
    const [label, a, b] = row; const lowerBetter = label.startsWith('·') || label === 'Faults';
    const v = i === 0 ? a : b, o = i === 0 ? b : a;
    return v !== o && (lowerBetter ? v < o : v > o) ? ' class="better"' : '';
  };
  $('#res-body').innerHTML = `
    <div class="res-head">${team(res.teams[0], 0)}<div class="res-games">${res.teams[0].games} – ${res.teams[1].games}</div>${team(res.teams[1], 1)}</div>
    <p class="res-meta">Games: ${res.gameScores.map(g => g.join('–')).join(', ')} · Time ${fmtTime(res.duration)} · ${res.rallies} rallies · Longest rally ${res.longestRally} shots</p>
    <div class="res-wrap"><table class="res-table"><tr><th>Statistic</th><th>${esc(res.teams[0].name)}</th><th>${esc(res.teams[1].name)}</th></tr>
    ${res.rows.map(r => `<tr><td>${esc(r[0])}</td><td${better(r, 0)}>${r[1]}</td><td${better(r, 1)}>${r[2]}</td></tr>`).join('')}</table></div>`;
  const acts = $('#res-actions');
  acts.innerHTML = '';
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${cls}`; b.textContent = label; b.addEventListener('click', fn); acts.append(b); return b; };
  if (S.mode === 'tournament') btn('Continue', 'primary', () => { toMenu(); show('scr-tournament'); });
  else if (S.type === 'guest') btn('Rematch', 'primary', e => { S.room?.send({ t: 'rematch' }); e.target.disabled = true; e.target.textContent = 'Waiting for host…'; });
  else if (S.restart) btn('Rematch', 'primary', () => S.restart());
  btn('Main menu', '', toMenu);
  show('scr-results', false);
}

// ---------------------------------------------------------------- menus & setup
$$('[data-go]').forEach(b => b.addEventListener('click', () => {
  const go = b.dataset.go;
  if (go === 'quick' || go === 'local') openSetup(go);
  else show(`scr-${go}`);
}));

let setupMode = 'quick';
function openSetup(mode) {
  setupMode = mode;
  const titles = { quick: 'Quick Match', local: 'Local Multiplayer', online: 'Host online match', tournament: 'New tournament' };
  $('#setup-title').textContent = titles[mode];
  $('#btn-start').textContent = mode === 'online' ? 'Create room' : mode === 'tournament' ? 'Start tournament' : 'Start match';
  show('scr-setup');
}

function syncSegs() {
  $$('#scr-setup .seg[data-key]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(setup[seg.dataset.key]))));
  $$('#scr-settings .seg[data-set]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(settings[seg.dataset.set]))));
}
const cast = v => (v === 'true' ? true : v === 'false' ? false : isNaN(Number(v)) ? v : Number(v));
$$('#scr-setup .seg[data-key]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setup[seg.dataset.key] = cast(b.dataset.v);
  store.set('setup', setup);
  onShow['scr-setup']();
}));

// Animated previews in character pickers: one shared loop, only while a picker is on screen.
const previews = new Set();
let previewRaf = 0;
function previewLoop(now) {
  previewRaf = 0;
  for (const pv of previews) {
    if (!pv.canvas.isConnected) { previews.delete(pv); continue; }
    if (pv.canvas.offsetParent) drawPreview(pv.canvas, charById(pv.id), pv.color, (now - pv.start) / 1000);
  }
  if (previews.size) previewRaf = requestAnimationFrame(previewLoop);
}

/** Scrollable row of character portraits with a live animated preview of the selected one. */
function charPicker(current, colorIdx, onPick) {
  const box = document.createElement('div');
  box.className = 'char-pick-box';
  const stage = document.createElement('div');
  stage.className = 'char-stage';
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 380;
  cv.setAttribute('aria-label', 'Selected character preview');
  const nameEl = document.createElement('b');
  nameEl.textContent = charById(current).name;
  stage.append(cv, nameEl);
  const pv = { canvas: cv, id: current, color: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length], start: performance.now() };
  previews.add(pv);
  if (!previewRaf) previewRaf = requestAnimationFrame(previewLoop);

  const wrap = document.createElement('div');
  wrap.className = 'char-picker';
  wrap.setAttribute('role', 'listbox');
  wrap.setAttribute('aria-label', 'Choose a character');
  for (const c of CHARACTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = c.id === current ? 'char on' : 'char';
    b.setAttribute('aria-pressed', c.id === current);
    const cv = document.createElement('canvas');
    cv.width = 196; cv.height = 256;   // drawn at 2x for sharp portraits
    drawPortrait(cv, c, PLAYER_COLORS[colorIdx % PLAYER_COLORS.length]);
    const label = document.createElement('span');
    label.textContent = c.name;
    b.append(cv, label);
    b.addEventListener('click', () => {
      onPick(c.id);
      pv.id = c.id; pv.start = performance.now();   // restart: the new pick swings straight away
      nameEl.textContent = c.name;
      wrap.querySelectorAll('.char').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    });
    wrap.append(b);
  }
  requestAnimationFrame(() => wrap.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  box.append(stage, wrap);
  return box;
}

function swatches(current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  PLAYER_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c; b.className = i === current ? 'on' : '';
    b.setAttribute('aria-label', `Color ${i + 1}`);
    b.addEventListener('click', () => { onPick(i); onShow[screen]?.(); });
    wrap.append(b);
  });
  return wrap;
}

onShow['scr-setup'] = () => {
  syncSegs();
  const mode = setupMode, list = $('#setup-players');
  list.innerHTML = '';
  const card = (side, html, extra) => { const d = document.createElement('div'); d.className = 'pcard'; d.innerHTML = `<div class="side">${side}</div>${html}`; if (extra) d.append(...extra); list.append(d); return d; };
  const nameInput = (val, key, obj) => { const i = document.createElement('input'); i.maxLength = 16; i.value = val; i.addEventListener('input', () => { obj[key] = i.value; store.set(obj === settings ? 'settings' : 'setup', obj); }); return i; };
  const lvl = LEVELS[setup.level].label;
  const n = setup.doubles;
  if (mode === 'local') {
    card('Near side · Player 1 · WASD + F/G/R/Q', '', [nameInput(settings.name, 'name', settings), swatches(settings.color, i => { settings.color = i; store.set('settings', settings); }), charPicker(settings.char, settings.color, id => { settings.char = id; store.set('settings', settings); })]);
    if (n) card('Near side partner', `<span class="who">CPU · ${lvl}</span>`);
    card('Far side · Player 2 · Arrows + . , / Enter', '', [nameInput(setup.p2name, 'p2name', setup), swatches(setup.p2color, i => { setup.p2color = i; store.set('setup', setup); }), charPicker(setup.p2char, setup.p2color, id => { setup.p2char = id; store.set('setup', setup); })]);
    if (n) card('Far side partner', `<span class="who">CPU · ${lvl}</span>`);
  } else {
    card('You', '', [nameInput(settings.name, 'name', settings), swatches(settings.color, i => { settings.color = i; store.set('settings', settings); }), charPicker(settings.char, settings.color, id => { settings.char = id; store.set('settings', settings); })]);
    if (n) card('Your partner', `<span class="who">CPU · ${mode === 'tournament' ? 'Advanced' : lvl}</span>`);
    const opp = mode === 'online' ? 'Your friend (joins with the room code)' : mode === 'tournament' ? 'Seven entrants, rated by skill' : `CPU · ${lvl}`;
    card(n && mode !== 'tournament' ? 'Opponents' : 'Opponent', `<span class="who">${opp}${n && mode === 'online' ? ' + CPU partner' : n && mode === 'quick' ? ' (×2)' : ''}</span>`);
  }
  const hasAI = mode === 'quick' || (n && mode !== 'tournament');
  $('#field-level').hidden = !hasAI;
  const notes = {
    quick: '',
    local: 'Both players share the keyboard. Player 2 plays the far side and moves relative to the screen.',
    online: 'You host and play the near side. Your friend plays the far side.',
    tournament: 'Every round is one game. Opponents get stronger as you advance.',
  };
  $('#setup-note').textContent = notes[mode];
  $('[data-key=games]').closest('.field').hidden = mode === 'tournament';
};

$('#btn-start').addEventListener('click', () => {
  if (setupMode === 'quick') startQuick();
  else if (setupMode === 'local') startLocal();
  else if (setupMode === 'online') createRoom();
  else if (setupMode === 'tournament') {
    tour = createTournament({ playerName: settings.name || 'You', doubles: setup.doubles, format: setup.format, target: setup.target });
    career.tournaments++;
    store.set('career', career);
    store.set('tournament', tour);
    backStack.pop();
    show('scr-tournament', false);
  }
});

// ---------------------------------------------------------------- practice screen
onShow['scr-practice'] = () => {
  const list = $('#drill-list');
  list.innerHTML = '';
  for (const [id, d] of Object.entries(DRILLS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card';
    b.innerHTML = `<b>${esc(d.name)}</b><span>${esc(d.goal)}</span>`;
    b.addEventListener('click', () => startPractice(id));
    list.append(b);
  }
};

// ---------------------------------------------------------------- tournament screen
onShow['scr-tournament'] = () => {
  const body = $('#tour-body');
  if (!tour) {
    body.innerHTML = `<div class="prose"><p>Enter an 8-player single-elimination bracket: quarterfinal, semifinal and final. Opponents are rated from beginner to advanced. Lose once and you’re out.</p></div>
      <footer><button type="button" class="btn primary" id="tour-new">Set up tournament</button></footer>`;
    $('#tour-new').addEventListener('click', () => openSetup('tournament'));
    return;
  }
  const stars = r => r ? '★'.repeat(r) : '';
  const col = (round, ri) => `<div class="round"><h4>${ROUND_NAMES[ri]}</h4>${round.map(mt => {
    const row = id => { const e = entrant(tour, id); const cls = mt.winner === null ? '' : mt.winner === id ? 'w' : 'l'; const sc = mt.score ? (id === mt.a ? mt.score[0] : mt.score[1]) : ''; return `<div class="${cls} ${e.you ? 'you' : ''}"><span>${esc(e.name)} <span class="stars">${stars(e.rating)}</span></span><span>${sc}</span></div>`; };
    return `<div class="bm">${row(mt.a)}${row(mt.b)}</div>`;
  }).join('')}</div>`;
  const cols = [0, 1, 2].map(i => tour.rounds[i] ? col(tour.rounds[i], i) : `<div class="round"><h4>${ROUND_NAMES[i]}</h4><div class="bm"><div class="l">TBD</div><div class="l">TBD</div></div></div>`).join('');
  const nm = nextMatch(tour);
  const fmt = `${tour.settings.doubles ? 'Doubles' : 'Singles'} · ${tour.settings.format === 'rally' ? 'Rally' : 'Side-out'} scoring to ${tour.settings.target}`;
  let status;
  if (nm) status = `<p class="lede small">${fmt}</p><div class="prose"><p>Next: <b>${nm.roundName}</b> vs <b>${esc(nm.opponent.name)}</b> (${LEVELS[nm.level].label})</p></div>`;
  else status = `<p class="lede small">${fmt}</p><div class="prose"><p>${tour.placement === 'Champion' ? '🏆 <b>Champion!</b> You won the tournament.' : `Finished as <b>${esc(tour.placement || '—')}</b>. Champion: <b>${esc(entrant(tour, tour.champion).name)}</b>.`}</p></div>`;
  body.innerHTML = `${status}<div class="bracket">${cols}</div>
    <footer>${nm ? '<button type="button" class="btn ghost" id="tour-quit">Abandon tournament</button><button type="button" class="btn primary" id="tour-play">Play match</button>' : '<button type="button" class="btn primary" id="tour-again">New tournament</button>'}</footer>`;
  $('#tour-play')?.addEventListener('click', startTournamentMatch);
  $('#tour-again')?.addEventListener('click', () => openSetup('tournament'));
  $('#tour-quit')?.addEventListener('click', () => { if (confirm('Abandon this tournament?')) { tour = null; store.set('tournament', null); onShow['scr-tournament'](); } });
};

// ---------------------------------------------------------------- tutorials & quiz
onShow['scr-tutorials'] = () => {
  const list = $('#lesson-list');
  list.innerHTML = '';
  LESSONS.forEach((l, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card';
    b.innerHTML = `<span class="badge">Lesson ${i + 1}</span><b>${esc(l.title)}</b><span>${esc(l.summary)}</span>`;
    b.addEventListener('click', () => openLesson(l));
    list.append(b);
  });
  const q = document.createElement('button');
  q.type = 'button'; q.className = 'card';
  q.innerHTML = '<span class="badge">Quiz</span><b>Scoring quiz</b><span>Call the score after a run of rallies.</span>';
  q.addEventListener('click', () => show('scr-quiz'));
  list.append(q);
};

function openLesson(l) {
  $('#lesson-title').textContent = l.title;
  $('#lesson-body').innerHTML = l.body.map(p => `<p>${p}</p>`).join('');
  const acts = $('#lesson-actions');
  acts.innerHTML = '';
  if (l.practice) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = `Try it: ${DRILLS[l.practice].name} drill`; b.addEventListener('click', () => startPractice(l.practice)); acts.append(b); }
  if (l.quiz) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = 'Take the scoring quiz'; b.addEventListener('click', () => show('scr-quiz')); acts.append(b); }
  show('scr-lesson');
}

const quiz = { right: 0, total: 0 };
const EVENT_LABEL = { point: 'point', sideout: 'side out', second_server: 'second server', game: 'game' };
function makeQuestion() {
  const variants = [
    { format: 'sideout', doubles: true, label: 'Traditional doubles' },
    { format: 'sideout', doubles: false, label: 'Traditional singles' },
    { format: 'rally', doubles: true, label: 'Rally scoring doubles' },
  ];
  const v = variants[Math.floor(Math.random() * variants.length)];
  let s = createScore({ ...v, target: 11 });
  const names = ['Blue', 'Orange'], start = scoreCall(s), steps = [], trail = [];
  const n = 2 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const serving = s.servingTeam, w = Math.random() < 0.55 ? serving : 1 - serving;
    const r = rallyWon(s, w);
    steps.push(`${names[w]} (${w === serving ? 'serving' : 'receiving'}) wins the rally`);
    trail.push(`${names[w]} wins → ${EVENT_LABEL[r.event]} → <b>${scoreCall(r.state)}</b>`);
    s = r.state;
  }
  const correct = scoreCall(s);
  const [a, b, c] = correct.split('-').map(Number);
  const tail = c ? `-${c}` : '';
  const cands = [`${b}-${a}${tail}`, c ? `${a}-${b}-${c === 1 ? 2 : 1}` : `${a + 1}-${b}`, `${a}-${b + 1}${tail}`, `${Math.max(0, a - 1)}-${b}${tail}`, c ? `${b}-${a}-${c === 1 ? 2 : 1}` : `${a}-${Math.max(0, b - 1)}`];
  const opts = [...new Set(cands)].filter(x => x !== correct).slice(0, 2);
  opts.push(correct);
  opts.sort(() => Math.random() - 0.5);
  return { v, start, steps, trail, correct, opts };
}
onShow['scr-quiz'] = () => {
  const q = makeQuestion(), body = $('#quiz-body');
  body.innerHTML = `<div class="quiz-q"><p><b>${q.v.label}</b>. Blue serves first; the score is called <b>${q.start}</b>.</p><ol>${q.steps.map(s => `<li>${s}</li>`).join('')}</ol><p>What is the score call now?</p></div>
    <div class="answers">${q.opts.map(o => `<button type="button" class="btn" data-a="${o}">${o}</button>`).join('')}</div>
    <div class="explain" hidden></div>
    <footer><span class="status">Score: ${quiz.right}/${quiz.total}</span><button type="button" class="btn primary" id="quiz-next" hidden>Next question</button></footer>`;
  body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
    if (body.dataset.done === '1') return;
    body.dataset.done = '1';
    quiz.total++;
    const ok = b.dataset.a === q.correct;
    if (ok) quiz.right++;
    body.querySelectorAll('[data-a]').forEach(x => x.classList.add(x.dataset.a === q.correct ? 'right' : x === b ? 'wrong' : 'x'));
    const ex = body.querySelector('.explain');
    ex.hidden = false;
    ex.innerHTML = `${ok ? '✅ Correct.' : `❌ The call is <b>${q.correct}</b>.`}<br>${q.start} · ${q.trail.join('<br>')}`;
    body.querySelector('.status').textContent = `Score: ${quiz.right}/${quiz.total}`;
    $('#quiz-next').hidden = false;
  }));
  body.dataset.done = '0';
  $('#quiz-next').addEventListener('click', () => onShow['scr-quiz']());
};

// ---------------------------------------------------------------- stats & settings
onShow['scr-stats'] = () => {
  const c = career, pct = c.matches ? Math.round((c.wins / c.matches) * 100) : 0;
  const tile = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const faults = Object.entries(c.faults).sort((a, b) => b[1] - a[1]);
  $('#stats-body').innerHTML = `<div class="statgrid">
    ${tile(c.matches, 'Matches played')}${tile(`${c.wins}–${c.losses}`, 'Won–lost')}${tile(`${pct}%`, 'Win rate')}
    ${tile(c.pointsFor, 'Points won')}${tile(c.pointsAgainst, 'Points conceded')}${tile(c.aces, 'Aces')}
    ${tile(c.longestRally, 'Longest rally')}${tile(c.online, 'Online matches')}${tile(c.local, 'Local matches')}
    ${tile(c.tournaments, 'Tournaments entered')}${tile(c.titles, 'Titles')}${tile(c.bestFinish || '—', 'Best finish')}
    ${tile(c.practice.attempts ? `${Math.round((c.practice.success / c.practice.attempts) * 100)}%` : '—', `Practice success (${c.practice.attempts} attempts)`)}${tile(fmtTime(c.playTime), 'Time played')}
  </div>
  <div class="res-wrap"><table><tr><th>Your faults</th><th>Count</th></tr>${faults.length ? faults.map(([k, v]) => `<tr><td>${esc(FAULTS[k] || k)}</td><td>${v}</td></tr>`).join('') : '<tr><td colspan="2">No faults recorded yet.</td></tr>'}</table></div>`;
};
$('#btn-reset-stats').addEventListener('click', () => {
  if (!confirm('Reset all statistics?')) return;
  career = defaultCareer();
  store.set('career', career);
  onShow['scr-stats']();
});

onShow['scr-settings'] = () => {
  syncSegs();
  $('#set-name').value = settings.name;
  $('#set-volume').value = settings.volume;
  const sw = $('#set-color');
  sw.replaceWith(Object.assign(swatches(settings.color, i => { settings.color = i; store.set('settings', settings); }), { id: 'set-color' }));
  $('#set-char').replaceWith(Object.assign(charPicker(settings.char, settings.color, id => { settings.char = id; store.set('settings', settings); }), { id: 'set-char' }));
};
$('#set-name').addEventListener('input', e => { settings.name = e.target.value; store.set('settings', settings); });
$('#set-volume').addEventListener('input', e => { settings.volume = Number(e.target.value); setVolume(settings.volume); store.set('settings', settings); });
$$('#scr-settings .seg[data-set]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings[seg.dataset.set] = cast(b.dataset.v);
  store.set('settings', settings);
  if (seg.dataset.set === 'graphics') applyGraphics();
  syncSegs();
}));

// ---------------------------------------------------------------- online
let room = null;
function closeRoom() { if (room) { room.close(); room = null; } }
const roomStatus = (msg, err) => { const el = $('#room-status'); el.textContent = msg; el.classList.toggle('err', !!err); };
const joinStatus = (msg, err) => { const el = $('#join-status'); el.textContent = msg; el.classList.toggle('err', !!err); };

$('#btn-host').addEventListener('click', () => openSetup('online'));

function createRoom() {
  closeRoom();
  show('scr-room');
  $('#room-code').textContent = '·····';
  $('#room-link').value = '';
  roomStatus('Creating room…');
  room = hostRoom({
    onCode(code) {
      $('#room-code').textContent = code;
      $('#room-link').value = `${location.origin}${location.pathname}?room=${code}`;
      roomStatus('Waiting for your opponent to join…');
    },
    onOpen: startHostMatch,
    onData: hostData,
    onClose: () => disconnected('Your opponent left the match.'),
    onError: msg => roomStatus(msg, true),
  });
}

function startHostMatch() {
  const me = you(), c2 = otherColor(me.color), names = pickCpu(2);
  const t0 = [me], t1 = [{ name: 'Guest', color: c2, ctrl: 'remote' }];
  if (setup.doubles) { t0.push({ name: names[0], color: me.color, level: setup.level }); t1.push({ name: names[1], color: c2, level: setup.level }); }
  assignChars([...t0, ...t1]);
  const m = createMatch({ ...matchCfg(), teams: [t0, t1] });
  const remote = m.teams[1][0];
  S = matchSession('match', m, [{ id: 0, scheme: 'solo' }], { mode: 'online', myTeam: 0, online: true, room, remoteId: remote.id, restart: startHostMatch, frame: 0 });
  room.send({ t: 'start', players: roster(m), you: remote.id });
  enterGame();
}

const roster = m => m.players.map(p => ({ id: p.id, team: p.team, color: p.color, name: p.name, char: p.char }));

function hostData(d) {
  if (!S?.online) return;
  const m = S.m, p = m.players[S.remoteId];
  if (d.t === 'hello' && typeof d.name === 'string') {
    p.name = d.name.slice(0, 16) || 'Guest';
    if (CHARACTERS.some(c => c.id === d.char)) p.char = d.char;
    S.room?.send({ t: 'roster', players: roster(m) });
  }
  else if (d.t === 'in') {
    const n = v => (Number.isFinite(v) ? C.clamp(v, -1, 1) : 0);
    Object.assign(p.intent, { mx: n(d.mx), mz: n(d.mz), aimX: n(d.ax), aimZ: n(d.az) });
  } else if (d.t === 'shot' && C.SHOT_KINDS.includes(d.k)) playerShot(m, p, d.k, 1.3);
  else if (d.t === 'drop') playerDrop(m, p);
  else if (d.t === 'rematch' && m.phase === 'matchOver') startHostMatch();
}

function hostSend(ev) {
  const m = S.m, b = m.world.ball;
  S.frame++;
  const guestScene = sceneModel(m, [S.remoteId], 'far', S.guestCache || (S.guestCache = {}));
  const msg = {
    t: 's',
    p: m.players.map(p => [r2(p.x), r2(p.z), r2(p.vx), r2(p.vz), r2(p.swingAnim), p.swingKind]),
    b: [r2(b.x), r2(b.y), r2(b.z), guestScene.ball.visible ? 1 : 0, r2(b.vx), r2(b.vy), r2(b.vz), b.state === 'live' || b.state === 'drop' ? 1 : 0],
    mk: guestScene.marker ? [r2(guestScene.marker.x), r2(guestScene.marker.z)] : 0,
    sb: guestScene.serveBox || 0,
    ev,
  };
  if (S.frame % 3 === 0 || ev.length) msg.hud = hudModel(m);
  S.room?.send(msg);
}

function join(code) {
  code = code.trim().toUpperCase();
  if (code.length !== 5) return joinStatus('Room codes are 5 characters.', true);
  closeRoom();
  joinStatus('Connecting…');
  room = joinRoom(code, {
    onOpen: () => { joinStatus('Connected! Waiting for the host…'); room.send({ t: 'hello', name: settings.name || 'Guest', char: settings.char }); },
    onData: guestData,
    onClose: () => disconnected('The host left the match.'),
    onError: msg => { joinStatus(msg, true); closeRoom(); },
  });
}
$('#join-form').addEventListener('submit', e => { e.preventDefault(); join($('#join-code').value); });
$('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#btn-copy').addEventListener('click', async () => {
  const link = $('#room-link').value;
  if (!link) return;
  try { await navigator.clipboard.writeText(link); $('#btn-copy').textContent = 'Copied!'; } catch { $('#room-link').select(); }
  setTimeout(() => { $('#btn-copy').textContent = 'Copy'; }, 1500);
});

function guestData(d) {
  if (d.t === 'start') {
    S = { type: 'guest', room, humans: [{ id: d.you, scheme: 'solo' }], players: d.players, you: d.you, view: 'far', snap: null, snapAt: 0, hud: null, paused: false, myTeam: 1, mode: 'online', humanIds: [d.you], humanTeams: [1] };
    enterGame();
  } else if (d.t === 'roster' && S?.type === 'guest') {
    S.players = d.players;
  } else if (d.t === 's' && S?.type === 'guest') {
    S.snap = d; S.snapAt = performance.now();
    if (d.hud) S.hud = d.hud;
    (d.ev || []).forEach(sfx);
  } else if (d.t === 'end' && S?.type === 'guest') {
    recordCareer(d.res, 1, 'online');
    showResults(d.res, 1);
  } else if (d.t === 'full') { joinStatus('That room is already full.', true); closeRoom(); }
}

function guestUpdate() {
  const me = S.players.find(p => p.id === S.you);
  const fake = { team: me.team, intent: {} };
  applyHumanInput(S.humans[0], fake, 'far');
  S.room?.send({ t: 'in', mx: r2(fake.intent.mx), mz: r2(fake.intent.mz), ax: r2(fake.intent.aimX), az: r2(fake.intent.aimZ) });
  if (S.localSwing) { S.localSwing.t -= 1 / 60; if (S.localSwing.t <= 0) S.localSwing = null; }
}

function guestModel() {
  const s = S.snap;
  const players = S.players.map((p, i) => {
    const a = s ? s.p[i] : [0, C.teamZ(p.team) * 20, 0, 0, 0, 'drive'];
    const age = s ? Math.min(0.1, (performance.now() - S.snapAt) / 1000) : 0;
    const own = p.id === S.you && S.localSwing;
    return { id: p.id, team: p.team, color: p.color, char: p.char, x: a[0] + a[2] * age, z: a[1] + a[3] * age, vx: a[2], vz: a[3], swingAnim: own ? S.localSwing.t : a[4], swingKind: own ? S.localSwing.kind : a[5], human: p.id === S.you };
  });
  let ball = { x: 0, y: 2, z: 0, visible: false };
  if (s) {
    const age = s.b[7] ? Math.min(0.1, (performance.now() - S.snapAt) / 1000) : 0;
    ball = { x: s.b[0] + s.b[4] * age, y: Math.max(C.BALL_R, s.b[1] + s.b[5] * age - 16 * age * age), z: s.b[2] + s.b[6] * age, visible: !!s.b[3] };
  }
  return { players, ball, marker: s && s.mk ? { x: s.mk[0], z: s.mk[1] } : null, serveBox: s ? s.sb || null : null, view: 'far' };
}

function disconnected(msg) {
  toMenu();
  show('scr-online');
  joinStatus(msg, true);
}

// ---------------------------------------------------------------- boot
startDemo();
applyGraphics();
if (brokenGPU && !store.get('gpuTipDismissed', false)) {
  $('#gpu-tip').hidden = false;
  $('#gpu-tip button').addEventListener('click', () => { $('#gpu-tip').hidden = true; store.set('gpuTipDismissed', true); });
}
show('scr-main', false);
const invite = new URLSearchParams(location.search).get('room');
if (invite) {
  history.replaceState(null, '', location.pathname);
  show('scr-online');
  $('#join-code').value = invite.toUpperCase();
  join(invite);
}
requestAnimationFrame(frame);
