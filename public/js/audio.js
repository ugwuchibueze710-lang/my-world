// Procedural soundscape (no audio files): wind, ocean, rivers, rain, thunder, birds, crickets, village life,
// battle, fire — plus spoken voices for conversations and a cinematic narrator.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioSys {
  constructor() {
    this.on = false; this.narratorOn = true; this.voicesOn = true;
    this.voices = [];
    this.queue = [];
    this.speaking = null;
    if ('speechSynthesis' in window) {
      const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
      load(); speechSynthesis.onvoiceschanged = load;
    }
  }

  async enable() {
    this.userMuted = false;
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); if (!this.voices.length) this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); }
    if (this.ctx) { await this.ctx.resume(); this.on = true; this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.3); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.duck = ctx.createGain(); this.duck.connect(this.master);
    // shared noise buffers
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    this.white = white; this.brown = brown;
    const layer = (buf, type, freq, q = 0.7) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = Math.random();
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.duck); src.start(0, Math.random() * 2);
      return { g, f };
    };
    this.wind = layer(brown, 'lowpass', 500);
    this.gust = layer(white, 'bandpass', 700, 1.5);
    this.ocean = layer(brown, 'lowpass', 700);
    this.surf = layer(white, 'bandpass', 1200, 0.5);
    this.rain = layer(white, 'highpass', 1800);
    this.river = layer(white, 'bandpass', 1100, 0.8);
    this.crowd = layer(brown, 'bandpass', 380, 2.5);
    // crickets: amplitude-modulated tone
    const cr = ctx.createOscillator(); cr.frequency.value = 4400;
    const am = ctx.createOscillator(); am.frequency.value = 28; const amg = ctx.createGain(); amg.gain.value = 0.5;
    const crg = ctx.createGain(); crg.gain.value = 0; const crBase = ctx.createGain(); crBase.gain.value = 0.5;
    am.connect(amg).connect(crBase.gain); cr.connect(crBase).connect(crg).connect(this.duck); cr.start(); am.start();
    this.crickets = { g: crg };
    this.on = true;
    this.t = 0;
  }

  disable() { this.userMuted = true; this.on = false; if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); if ('speechSynthesis' in window) speechSynthesis.cancel(); this.queue = []; this.speaking = null; }

  set(layer, v, tc = 0.6) { if (layer) layer.g.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // env: {camH, wind, rain, nearSea, nearRiver, village, night, forest, battle, fire}
  update(dt, env) {
    if (!this.on || !this.ctx) return;
    this.t += dt;
    const high = clamp(env.camH / 1500, 0, 1), low = 1 - high;
    this.set(this.wind, 0.05 + clamp(env.wind / 18, 0, 1) * 0.45 + high * 0.15);
    this.set(this.gust, clamp((env.wind - 6) / 12, 0, 1) * 0.25 * (0.5 + 0.5 * Math.sin(this.t * 0.7)));
    this.wind.f.frequency.setTargetAtTime(300 + env.wind * 40, this.ctx.currentTime, 1);
    const swell = 0.6 + 0.4 * Math.sin(this.t * 0.55);
    this.set(this.ocean, env.nearSea * 0.5 * swell * (0.4 + 0.6 * low), 0.4);
    this.set(this.surf, env.nearSea * 0.12 * swell * swell * low, 0.3);
    this.set(this.rain, env.rain * 0.35 * (0.5 + 0.5 * low));
    this.set(this.river, env.nearRiver * 0.16 * low);
    this.set(this.crowd, env.village * 0.12 * low * (env.night ? 0.3 : 1));
    this.set(this.crickets, env.night && env.camH < 400 ? 0.012 * (1 - env.rain) : 0, 1.2);
    // one-shot sounds
    if (!env.night && env.forest > 0.15 && env.camH < 350 && env.rain < 0.3 && Math.random() < dt * (0.5 + env.forest * 1.5)) this.bird();
    if (env.battle > 0 && Math.random() < dt * Math.min(8, env.battle * 1.5)) this.clang(env.battle);
    if (env.fire > 0 && Math.random() < dt * 12 * env.fire) this.crackle();
    if (env.building > 0 && env.camH < 150 && Math.random() < dt * env.building * 1.2) this.knock();
    // duck ambience under speech
    this.duck.gain.setTargetAtTime(this.speaking ? 0.45 : 1, this.ctx.currentTime, 0.3);
  }

  env(a, d) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, this.ctx.currentTime); g.gain.linearRampToValueAtTime(a, this.ctx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d); g.connect(this.duck); return g; }

  bird() {
    const c = this.ctx, t0 = c.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 2400;
    const pan = c.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.duck);
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator(), g = c.createGain();
      const s = t0 + i * (0.09 + Math.random() * 0.08);
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), s + 0.06);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.04, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      o.connect(g).connect(pan); o.start(s); o.stop(s + 0.12);
    }
  }
  clang(n) {
    const c = this.ctx, g = this.env(0.06 + Math.random() * 0.05, 0.25 + Math.random() * 0.2);
    for (const f of [520, 1310, 2470, 3600]) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f * (0.95 + Math.random() * 0.1); o.connect(g); o.start(); o.stop(c.currentTime + 0.5); }
  }
  crackle() {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.white;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
    const g = this.env(0.08 * Math.random(), 0.03); s.connect(f).connect(g); s.start(0, Math.random() * 2, 0.04);
  }
  knock() {
    const c = this.ctx, o = c.createOscillator(); o.frequency.setValueAtTime(180, c.currentTime); o.frequency.exponentialRampToValueAtTime(70, c.currentTime + 0.08);
    const g = this.env(0.12, 0.1); o.connect(g); o.start(); o.stop(c.currentTime + 0.12);
  }
  thunder(dist) {
    if (!this.on || !this.ctx || dist > 4000) return;
    const c = this.ctx, delay = dist / 340, vol = clamp(1 - dist / 4000, 0.1, 1) * 0.6;
    const s = c.createBufferSource(); s.buffer = this.brown;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160 + 400 * (1 - dist / 4000);
    const g = c.createGain(); const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.05 + Math.random() * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5 + Math.random() * 2);
    s.connect(f).connect(g).connect(this.duck); s.start(t, Math.random()); s.stop(t + 5);
  }

  // ---------- voices ----------
  voiceFor(seed, female) {
    const vs = this.voices.length ? this.voices : ('speechSynthesis' in window ? speechSynthesis.getVoices() : []);
    if (!vs.length) return null;
    const fem = vs.filter((v) => /female|zira|samantha|susan|hazel|libby|sonia|aria|jenny|karen|moira|tessa|fiona|victoria/i.test(v.name));
    const mal = vs.filter((v) => /male|david|mark|daniel|george|ryan|guy|alex|fred|oliver|thomas|arthur|james/i.test(v.name) && !/female/i.test(v.name));
    let pool = (female ? fem : mal).length ? (female ? fem : mal) : vs;
    const local = pool.filter((v) => v.localService); if (local.length) pool = local; // online voices start slowly
    return pool[seed % pool.length];
  }
  narratorVoice() {
    const vs = this.voices.length ? this.voices : speechSynthesis.getVoices();
    const pref = [/en-GB.*(george|ryan|arthur|thomas|daniel|male)/i, /(george|ryan|arthur|thomas|daniel)/i, /(david|guy|mark|james|alex)/i, /male/i];
    const loc = vs.filter((v) => v.localService);
    for (const list of [loc, vs]) for (const re of pref) { const v = list.find((x) => re.test(x.name + ' ' + x.lang) && !/female/i.test(x.name)); if (v) return v; }
    return vs[0] || null;
  }

  // say a line; hooks drive lip sync. kind: 'talk' | 'narrator'
  say(text, opts = {}) {
    if (!this.on || !('speechSynthesis' in window)) return false;
    if (opts.kind === 'narrator' && !this.narratorOn) return false;
    if (opts.kind === 'talk' && !this.voicesOn) return false;
    const item = { text, opts, at: performance.now() };
    if (opts.kind === 'talk') {
      // dialogue is time-critical: it jumps ahead of the narrator
      if (this.queue.filter((q) => q.opts.kind === 'talk').length > 1) return false;
      const i = this.queue.findIndex((q) => q.opts.kind !== 'talk');
      if (i < 0) this.queue.push(item); else this.queue.splice(i, 0, item);
    } else {
      if (this.queue.length > 3) return false;
      this.queue.push(item);
    }
    this.pump();
    return true;
  }
  pump() {
    if (this.speaking || !this.queue.length) return;
    let item;
    while ((item = this.queue.shift())) { // stale lines are worthless
      const age = performance.now() - item.at;
      if (item.opts.kind === 'talk' ? age < 2500 : age < 25000) break;
    }
    if (!item) return;
    const { text, opts } = item;
    const u = new SpeechSynthesisUtterance(text);
    if (opts.kind === 'narrator') { u.voice = this.narratorVoice(); u.rate = 0.9; u.pitch = 0.6; u.volume = 1; }
    else { u.voice = this.voiceFor(opts.seed || 0, opts.female); u.rate = opts.child ? 1.15 : opts.elder ? 0.92 : 1.05; u.pitch = opts.child ? 1.7 : opts.female ? 1.2 : opts.elder ? 0.7 : 0.85; u.volume = opts.volume ?? 0.9; }
    let finished = false;
    const done = () => {
      if (finished) return; finished = true;
      clearTimeout(guard);
      if (this.speaking === u) this.speaking = null;
      opts.onend?.();
      setTimeout(() => this.pump(), opts.kind === 'narrator' ? 300 : 80);
    };
    u.onstart = () => opts.onstart?.();
    u.onboundary = (e) => opts.onboundary?.(e);
    u.onend = done; u.onerror = done;
    this.speaking = u;
    // Chrome bug: the engine can wedge with a phantom utterance; clear it before speaking
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    // if Chrome never reports the end, unstick it ourselves
    const guard = setTimeout(() => { speechSynthesis.cancel(); done(); }, 2500 + text.length * 85);
  }
  // Chrome stops long sessions silently; keep the engine awake
  keepAlive() { if (this.on && 'speechSynthesis' in window && !this.speaking && speechSynthesis.speaking) speechSynthesis.cancel(); }
  clearTalk() { this.queue = this.queue.filter((q) => q.opts.kind !== 'talk'); }
}
