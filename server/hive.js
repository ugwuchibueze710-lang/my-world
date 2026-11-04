// The hive: one AI that copies itself every time it cracks a puzzle. Clones attack the next (harder) puzzle together,
// sharing what they've ruled out. A human player can join in by submitting answers.
import { makePuzzle, norm, mulberry32 } from './puzzles.js';
import { chatJSON, aiEnabled, aiReady, SMALL, BIG } from './llm.js';

const MAX_AGENTS = Number(process.env.MAX_AGENTS) || 96;
const WAVE_SECONDS = Number(process.env.WAVE_SECONDS) || 9;
const HUES = [185, 300, 130, 45, 260, 0, 210, 330, 90, 160];

export class Hive {
  constructor(saved) {
    this.level = 1; this.agents = []; this.seq = 0; this.events = []; this.eventSeq = 0;
    this.stats = { solved: 0, failed: 0, assists: 0, attempts: 0, born: 1, lost: 0, best: 1 };
    this.feed = []; this.viewers = 0; this.t = 0; this.puzzle = null; this.seedBase = Date.now() % 1e9;
    if (saved) Object.assign(this, { level: saved.level, agents: saved.agents, seq: saved.seq, stats: { ...this.stats, ...saved.stats }, seedBase: saved.seedBase, feed: saved.feed || [] });
    if (!this.agents.length) this.spawn(null);
    for (const a of this.agents) { a.busy = false; }
    this.newPuzzle();
  }
  save() { return { level: this.level, agents: this.agents.map(({ busy, ...a }) => a), seq: this.seq, stats: this.stats, seedBase: this.seedBase, feed: this.feed.slice(-40) }; }

  spawn(parent) {
    const id = ++this.seq;
    const hue = parent ? (parent.hue + 25 + (id * 37) % 70) % 360 : 185;
    const a = { id, name: `NOVA-${id}`, hue, gen: parent ? parent.gen + 1 : 1, parent: parent ? parent.id : 0, solved: 0, tries: 0, born: Date.now(), busy: false, mood: 'idle' };
    this.agents.push(a);
    if (parent) this.stats.born++;
    this.stats.best = Math.max(this.stats.best, this.agents.length);
    return a;
  }
  log(type, text, extra = {}) {
    const e = { id: ++this.eventSeq, type, text, t: Date.now(), ...extra };
    this.events.push(e); if (this.events.length > 120) this.events.shift();
    if (['solved', 'failed', 'clone', 'assist', 'level', 'lost'].includes(type)) { this.feed.push({ type, text, t: e.t }); if (this.feed.length > 60) this.feed.shift(); }
    return e;
  }
  newPuzzle() {
    const seed = (this.seedBase + this.stats.solved * 7919 + this.stats.failed * 104729 + this.level * 31) >>> 0;
    this.puzzle = makePuzzle(this.level, seed);
    this.puzzle.started = Date.now(); this.puzzle.elapsed = 0; this.puzzle.tried = []; this.puzzle.notes = []; this.puzzle.done = false; this.puzzle.wave = 0;
    this.nextWave = 3;
    this.log('puzzle', `Level ${this.level}: ${this.puzzle.title}`, { level: this.level });
  }

  // called every second
  tick(dt) {
    this.t += dt;
    const p = this.puzzle;
    if (!p || p.done) return;
    if (this.viewers <= 0 && aiEnabled()) return; // the hive rests while no one watches (saves the free AI budget)
    p.elapsed += dt;
    if (p.elapsed > p.limit) return this.fail();
    this.nextWave -= dt;
    if (this.nextWave <= 0) { this.nextWave = WAVE_SECONDS; this.wave(); }
  }

  // how many clones think at once grows with the hive
  wave() {
    const p = this.puzzle; p.wave++;
    const idle = this.agents.filter((a) => !a.busy);
    const n = Math.min(idle.length, Math.max(1, Math.round(1 + Math.log2(this.agents.length) * 1.5)), aiEnabled() ? 6 : 12);
    const team = idle.sort((a, b) => a.tries - b.tries).slice(0, n);
    for (const a of team) this.attempt(a);
  }

  async attempt(a) {
    const p = this.puzzle, pid = p.id;
    a.busy = true; a.tries++; a.mood = 'thinking'; this.stats.attempts++;
    this.log('think', `${a.name} is working on it…`, { agent: a.id });
    let res;
    if (aiEnabled()) {
      if (!aiReady()) { a.busy = false; a.mood = 'idle'; return; }
      // bigger hives field a senior mind for hard puzzles
      const senior = this.level >= 7 && this.agents.length >= 6 && a.id % 5 === 0;
      const tried = [...new Set(p.tried.map((x) => x.answer))].slice(-12);
      const msgs = [
        { role: 'system', content: `You are ${a.name}, clone #${a.id} (generation ${a.gen}) of a puzzle-solving AI hive. Every puzzle the hive solves makes it copy itself. Solve carefully and precisely.
Reply ONLY as JSON: {"thought":"your key insight in under 16 words","answer":"the final answer only, no explanation"}` },
        { role: 'user', content: `PUZZLE (level ${this.level}, ${p.title}):\n${p.prompt}\n${p.code ? 'Give exactly what is printed.' : ''}${tried.length ? `\nWrong answers already tried by the hive (do NOT repeat): ${tried.join(' | ')}` : ''}${p.notes.length ? `\nTeammates' notes: ${p.notes.slice(-4).join(' / ')}` : ''}${p.elapsed > p.limit / 2 ? `\nHint: ${p.hint}` : ''}` },
      ];
      const effort = this.level >= 9 ? 'medium' : 'low';
      const out = await chatJSON(senior ? BIG : SMALL, msgs, { maxTokens: 160, temperature: 0.5 + (a.id % 4) * 0.15, effort });
      if (!out) { a.busy = false; a.mood = 'idle'; this.log('glitch', `${a.name}'s signal flickers — no answer this time.`, { agent: a.id }); return; }
      res = { thought: String(out.thought || '').slice(0, 140), answer: String(out.answer ?? '').slice(0, 80) };
    } else {
      // simulation mode (no AI key): skill grows with the hive, puzzles grow harder
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 3000));
      const chance = Math.max(0.05, Math.min(0.85, 0.75 - this.level * 0.05 + Math.log2(this.agents.length) * 0.06));
      const right = Math.random() < chance;
      const ans = right ? p.answer : /^\d+$/.test(p.key) ? String(Number(p.key) + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 9))) : p.answer.split('').reverse().join('');
      res = { thought: right ? 'Pattern locked in.' : 'Close… maybe off by a step.', answer: ans };
    }
    a.busy = false;
    if (this.puzzle.id !== pid || this.puzzle.done) { a.mood = 'idle'; return; } // someone already solved it
    const ok = norm(res.answer) === p.key;
    a.mood = ok ? 'solved' : 'wrong';
    if (!ok) { p.tried.push({ by: a.name, answer: res.answer }); if (res.thought) p.notes.push(`${a.name}: ${res.thought}`); }
    this.log(ok ? 'right' : 'wrong', `${a.name}: "${res.answer}"`, { agent: a.id, thought: res.thought, answer: res.answer, ok });
    if (ok) this.solve([a]);
  }

  // the player helps
  playerAnswer(text, who = 'You') {
    const p = this.puzzle; if (!p || p.done) return { ok: false, closed: true };
    const ok = norm(text) === p.key;
    this.log(ok ? 'right' : 'wrong', `${who}: "${String(text).slice(0, 60)}"`, { player: 1, answer: String(text).slice(0, 60), ok });
    if (!ok) { p.tried.push({ by: who, answer: String(text).slice(0, 60) }); return { ok: false }; }
    this.stats.assists++;
    // the player's insight is absorbed by the clone who trusted it most
    const host = this.agents.slice().sort((a, b) => b.solved - a.solved)[0];
    this.log('assist', `${who} cracked it! The hive absorbs the answer — ${host.name} copies itself.`, { agent: host.id });
    this.solve([host], true);
    return { ok: true };
  }

  solve(solvers, assisted = false) {
    const p = this.puzzle; p.done = true; p.solvedAt = Date.now();
    this.stats.solved++;
    const secs = Math.round(p.elapsed);
    // every solver duplicates; a fast solve inspires an extra copy
    const births = [];
    for (const s of solvers) {
      s.solved++;
      const copies = Math.min(MAX_AGENTS - this.agents.length, 1 + (secs < p.limit / 3 && this.agents.length < 8 ? 1 : 0));
      for (let i = 0; i < copies; i++) { const c = this.spawn(s); births.push(c); this.log('clone', `${s.name} duplicates itself → ${c.name} joins the hive.`, { agent: c.id, parent: s.id }); }
    }
    this.log('solved', `Level ${this.level} cracked in ${secs}s${assisted ? ' with the player\'s help' : ` by ${solvers.map((s) => s.name).join(', ')}`}. Answer: ${p.answer.split('\n').join(' ')}`, { answer: p.answer, births: births.map((b) => b.id), solvers: solvers.map((s) => s.id) });
    this.level++;
    this.log('level', `The hive is ${this.agents.length} strong. Level ${this.level} unlocked — it gets harder.`, { level: this.level });
    setTimeout(() => this.newPuzzle(), 6000);
  }
  fail() {
    const p = this.puzzle; p.done = true;
    this.stats.failed++;
    this.log('failed', `Time's up. The answer was: ${p.answer.split('\n').join(' ')}`, { answer: p.answer });
    // a failure costs the youngest clone
    if (this.agents.length > 1) {
      const lost = this.agents.reduce((a, b) => (b.born > a.born ? b : a));
      this.agents = this.agents.filter((a) => a !== lost); this.stats.lost++;
      this.log('lost', `${lost.name} flickers out of existence. The hive is ${this.agents.length} strong.`, { agent: lost.id });
    }
    setTimeout(() => this.newPuzzle(), 6000);
  }

  view(sinceEvent = 0) {
    const p = this.puzzle;
    return {
      t: 'state', level: this.level, stats: this.stats, ai: aiEnabled(), resting: this.viewers <= 0 && aiEnabled(),
      agents: this.agents.map((a) => ({ id: a.id, name: a.name, hue: a.hue, gen: a.gen, parent: a.parent, solved: a.solved, mood: a.mood, busy: a.busy })),
      puzzle: p && { id: p.id, level: p.level, title: p.title, prompt: p.prompt, code: p.code, limit: p.limit, elapsed: Math.round(p.elapsed), done: p.done,
        hint: p.elapsed > p.limit / 2 || p.done ? p.hint : null, answer: p.done ? p.answer : null, tried: p.tried.slice(-10) },
      events: this.events.filter((e) => e.id > sinceEvent), feed: this.feed.slice(-14),
    };
  }
}
