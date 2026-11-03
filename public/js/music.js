// Cinematic score composed live with Web Audio (no audio files): strings, choir, harp, horns, timpani and war drums.
// Pieces are triggered by real world events and play "once in a while", never constantly.
const N = (semi, base = 110) => base * Math.pow(2, semi / 12);

const MOODS = {
  peace:   { root: 2,  prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], chord: 4.2, harp: true, vol: 0.5 },
  love:    { root: 5,  prog: [[0, 4, 7, 11], [9, 12, 16], [5, 9, 12, 16], [7, 11, 14]], chord: 4.5, harp: true, choir: false, vol: 0.5 },
  tension: { root: 0,  prog: [[0, 3, 7], [8, 12, 15], [0, 3, 7], [7, 11, 14]], chord: 3.2, pulse: true, timpani: true, vol: 0.55 },
  war:     { root: 0,  prog: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [7, 11, 14]], chord: 2.4, drums: true, horns: true, pulse: true, vol: 0.62 },
  sorrow:  { root: -3, prog: [[0, 3, 7], [5, 8, 12], [0, 3, 7], [7, 10, 14]], chord: 5.2, choir: true, vol: 0.5 },
  triumph: { root: 2,  prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], chord: 2.8, horns: true, drums: true, vol: 0.6 },
};
const EVENT_MOOD = {
  war: 'war', siege: 'war', raid: 'war', march: 'war', conquest: 'triumph', capital: 'triumph', coronation: 'triumph',
  letter: 'tension', reply: 'tension', treason: 'tension', whisper: 'tension', murder: 'tension', scandal: 'tension', alliance: 'tension',
  royal_death: 'sorrow', fall: 'sorrow', assassination: 'sorrow', disaster: 'sorrow',
  royal_wedding: 'love', royal_birth: 'love', founding: 'peace', peace: 'peace', secession: 'tension', dynasty: 'tension',
};

export class Music {
  constructor(audio) { this.audio = audio; this.busyUntil = 0; this.nextAmbient = performance.now() + 120000; }

  init() {
    const a = this.audio; if (!a.ctx || this.out) return !!this.out;
    const c = a.ctx;
    this.out = c.createGain(); this.out.gain.value = 0;
    // generated hall reverb
    const len = c.sampleRate * 3.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const verb = c.createConvolver(); verb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.55; const dry = c.createGain(); dry.gain.value = 0.6;
    this.out.connect(dry).connect(a.master); this.out.connect(verb).connect(wet).connect(a.master);
    return true;
  }

  onEvent(e) {
    if (!this.audio.on || e.minor) return;
    const mood = EVENT_MOOD[e.type];
    if (!mood) return;
    if (e.type === 'letter' && !['threat', 'insult', 'accuse', 'tribute'].includes(e.letter)) return;
    const urgent = mood === 'war' || mood === 'sorrow';
    if (performance.now() < this.busyUntil && !urgent) return;
    if (performance.now() < this.busyUntil - 20000) return; // something is already playing
    this.play(mood);
  }

  tick() {
    if (!this.audio.on) return;
    const now = performance.now();
    if (now > this.nextAmbient && now > this.busyUntil) { this.nextAmbient = now + 360000 + Math.random() * 300000; this.play(Math.random() < 0.7 ? 'peace' : 'love'); }
  }

  play(moodName) {
    if (!this.init()) return;
    const m = MOODS[moodName], c = this.audio.ctx, t0 = c.currentTime + 0.1;
    const bars = 8, dur = bars * m.chord;
    this.busyUntil = performance.now() + (dur + 6) * 1000;
    this.mood = moodName;
    const g = this.out.gain;
    g.cancelScheduledValues(t0); g.setValueAtTime(g.value, t0); g.linearRampToValueAtTime(m.vol, t0 + 3); g.setValueAtTime(m.vol, t0 + dur - 4); g.linearRampToValueAtTime(0, t0 + dur + 2);
    const base = 110 * Math.pow(2, m.root / 12);
    for (let b = 0; b < bars; b++) {
      const ch = m.prog[b % m.prog.length], t = t0 + b * m.chord;
      for (const s of ch) this.pad(N(s, base), t, m.chord + 0.6, moodName === 'sorrow' ? 900 : moodName === 'war' ? 1600 : 1200, 0.05);
      this.bass(N(ch[0] - 12, base), t, m.chord);
      if (m.choir) for (const s of ch) this.choir(N(s + 12, base), t, m.chord + 0.5);
      if (m.harp) for (let i = 0; i < 8; i++) this.pluck(N(ch[i % ch.length] + 12 + (i >= 4 ? 12 : 0), base), t + i * (m.chord / 8), 0.09);
      if (m.pulse) for (let i = 0; i < m.chord * 2; i++) this.pulse(N(ch[0], base), t + i * 0.5, 0.06);
      if (m.timpani && b % 2 === 1) this.timpani(N(ch[0] - 12, base), t + m.chord - 1.2);
      if (m.drums) for (let i = 0; i < m.chord * 2; i++) { const tt = t + i * 0.5; if (i % 4 === 0 || i % 4 === 3) this.drum(tt, i % 4 === 0 ? 0.5 : 0.3); }
      if (m.horns && b % 2 === 0) { const top = ch[ch.length - 1]; this.horn(N(top, base * 2), t + 0.1, m.chord * 0.9); this.horn(N(ch[0], base * 2), t + m.chord * 0.5, m.chord * 0.5); }
    }
  }

  env(t, a, d, r, peak) { const g = this.audio.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + d); g.gain.linearRampToValueAtTime(0, t + a + d + r); g.connect(this.out); return g; }
  pad(f, t, len, cut, vol) {
    const c = this.audio.ctx, g = this.env(t, 1.2, len - 2, 1.5, vol);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 0.5; lp.connect(g);
    for (const det of [-9, 0, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + len + 0.5); }
  }
  bass(f, t, len) { const c = this.audio.ctx, g = this.env(t, 0.6, len - 1, 0.8, 0.12); const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + len + 0.5); }
  choir(f, t, len) {
    const c = this.audio.ctx, g = this.env(t, 1.5, len - 2.5, 1.5, 0.035);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.value = 4; vib.connect(vg).connect(o.frequency);
    for (const [ff, q] of [[700, 6], [1150, 8]]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; o.connect(bp).connect(g); }
    o.start(t); vib.start(t); o.stop(t + len + 0.5); vib.stop(t + len + 0.5);
  }
  pluck(f, t, vol) { const c = this.audio.ctx, g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4); g.connect(this.out); const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 1.5); }
  pulse(f, t, vol) { const c = this.audio.ctx, g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); g.connect(this.out); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(g); const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 0.4); }
  horn(f, t, len) {
    const c = this.audio.ctx, g = this.env(t, 0.35, Math.max(0.1, len - 0.8), 0.5, 0.06);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1500, t + 0.4); lp.connect(g);
    for (const det of [-4, 4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + len + 0.2); }
  }
  drum(t, vol) {
    const c = this.audio.ctx, g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); g.connect(this.out);
    const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35); o.connect(g); o.start(t); o.stop(t + 0.55);
    const n = c.createBufferSource(); n.buffer = this.audio.white; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = c.createGain(); ng.gain.setValueAtTime(vol * 0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); n.connect(lp).connect(ng).connect(this.out); n.start(t, Math.random(), 0.2);
  }
  timpani(f, t) { for (let i = 0; i < 10; i++) { const tt = t + i * 0.07, c = this.audio.ctx, g = c.createGain(); const v = 0.05 + i * 0.012; g.gain.setValueAtTime(v, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6); g.connect(this.out); const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(tt); o.stop(tt + 0.6); } }
}
