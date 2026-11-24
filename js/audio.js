// Procedural sound effects (no audio files): paddle pop, bounce, net, applause.
let ac = null, master = null, noiseBuf = null;
let volume = 0.8;

export function unlockAudio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ac.createGain();
    master.gain.value = volume;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function noise(dur, freq, q, vol, attack = 0.002, delay = 0) {
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, type, vol, slide = 1, delay = 0) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(ev) {
  if (!ac || !volume) return;
  switch (ev) {
    case 'hit': noise(0.07, 1700, 3, 0.9); tone(1050, 0.05, 'triangle', 0.25, 0.7); break;
    case 'smash': noise(0.12, 1300, 2, 1); tone(700, 0.08, 'square', 0.15, 0.5); break;
    case 'bounce': noise(0.06, 600, 2.5, 0.5); tone(260, 0.06, 'sine', 0.3, 0.7); break;
    case 'net': noise(0.25, 250, 1, 0.6, 0.01); break;
    case 'point':
      for (let i = 0; i < 14; i++) noise(0.09, 1800 + Math.random() * 1500, 4, 0.08 + Math.random() * 0.08, 0.004, 0.05 + Math.random() * 0.9);
      noise(1.1, 900, 0.6, 0.12, 0.15);
      break;
    case 'good': tone(660, 0.1, 'sine', 0.25); tone(990, 0.16, 'sine', 0.25, 1, 0.09); break;
  }
}
