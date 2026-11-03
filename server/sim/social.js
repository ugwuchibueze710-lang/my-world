// Inner lives: opinions, memories, romance, affairs, jealousy, brawls, grief, grudges and plots against the crown.
// Modelled on RimWorld (opinion, romance, social fights), Crusader Kings (schemes, secrets, inherited grudges),
// Dwarf Fortress (memories that reshape people) and The Sims (sentiments). Nothing is scripted: every outcome
// comes from the people's traits, their history with each other, and chance.
import { ROLE, calendar } from '../../shared/constants.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// extra personality facets (added to older saves too)
export function ensurePersona(p, r) {
  const g = p.genes;
  for (const k of ['jealous', 'honor', 'vengeful', 'romantic', 'kind', 'abrasive', 'greed']) if (g[k] === undefined) g[k] = r();
  if (!p.ops) p.ops = {};
  if (!p.mem) p.mem = [];
}

export const opOf = (p, q) => (p.ops && q ? p.ops[q.id] || 0 : 0);

export function addOp(p, q, d) {
  if (!p || !q || p === q) return;
  const v = clamp((p.ops[q.id] || 0) + d, -100, 100);
  p.ops[q.id] = Math.round(v * 10) / 10;
  const keys = Object.keys(p.ops);
  if (keys.length > 28) { // forget the people who matter least
    keys.sort((a, b) => Math.abs(p.ops[a]) - Math.abs(p.ops[b]));
    for (const k of keys.slice(0, keys.length - 24)) delete p.ops[k];
  }
}

export function remember(sim, p, text, weight = 1) {
  p.mem.push({ y: calendar(sim.time).year, text, w: weight });
  if (p.mem.length > 10) { p.mem.sort((a, b) => b.w - a.w); p.mem.length = 8; }
}

export function compat(a, b) {
  const ks = ['social', 'aggr', 'kind', 'honor', 'ambit', 'romantic'];
  let d = 0; for (const k of ks) d += Math.abs((a.genes[k] ?? 0.5) - (b.genes[k] ?? 0.5));
  return 1 - d / ks.length; // 0..1
}

const married = (p) => !!p.spouseId;
const adult = (p) => p.ageY >= 16;
const related = (a, b) => a.id === b.motherId || a.id === b.fatherId || b.id === a.motherId || b.id === a.fatherId ||
  (a.motherId && a.motherId === b.motherId) || (a.fatherId && a.fatherId === b.fatherId);

// RimWorld-style choice of what kind of encounter two people have
export function chooseInteraction(sim, a, b) {
  const r = sim.rand;
  const op = opOf(a, b), c = compat(a, b);
  const w = {
    chat: 1,
    deep: 0.25 + c * 0.6,
    kind: a.genes.kind > 0.6 ? 0.3 : 0,
    insult: (a.genes.abrasive * 0.25 + a.genes.aggr * 0.1) * (op < 0 ? 1 + (-op / 100) * 5 : Math.max(0.1, 1 - op / 50)),
    flirt: 0,
  };
  if (adult(a) && adult(b) && a.sex !== b.sex && !related(a, b) && Math.abs(a.ageY - b.ageY) < 18 && a.spouseId !== b.id && opOf(b, a) >= 0) {
    const attraction = (a.attr?.[b.id] ?? (a.attr = a.attr || {}, a.attr[b.id] = r()));
    let f = attraction * (0.3 + a.genes.romantic) * (0.5 + c);
    if (married(a)) { const sp = sim.byId.get(a.spouseId); f *= sp ? clamp(0.15 + (40 - opOf(a, sp)) / 120, 0.02, 1) * (1.2 - a.genes.honor) : 1; }
    w.flirt = f * 0.9;
  }
  let sum = 0; for (const k in w) sum += w[k];
  let x = r() * sum;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; }
  return 'chat';
}

// apply the social consequences of an encounter; returns extra narrative info for the dialogue
export function applyInteraction(sim, a, b, kind) {
  const r = sim.rand, c = compat(a, b);
  const out = { kind, result: null };
  switch (kind) {
    case 'chat': addOp(a, b, 1); addOp(b, a, 1); break;
    case 'deep': addOp(a, b, 4 + c * 6); addOp(b, a, 4 + c * 6); break;
    case 'kind': addOp(b, a, 7); addOp(a, b, 2); break;
    case 'insult': {
      addOp(b, a, -9 - a.genes.abrasive * 6); addOp(a, b, -2);
      // RimWorld: insults can start a fistfight
      const fightChance = 0.05 * (0.5 + b.genes.aggr) * (0.5 + b.genes.vengeful) * (opOf(b, a) < -20 ? 2 : 1);
      if (r() < fightChance && adult(a) && adult(b)) { out.result = 'brawl'; startBrawl(sim, b, a); }
      break;
    }
    case 'flirt': {
      const want = (opOf(b, a) / 100 + (b.attr?.[a.id] ?? r()) * 0.6 + b.genes.romantic * 0.3) - (married(b) ? 0.45 * b.genes.honor + clamp(opOf(b, sim.byId.get(b.spouseId)) / 150, 0, 0.5) : 0);
      if (r() < clamp(want, 0.02, 0.9)) {
        out.result = 'accepted';
        addOp(a, b, 12); addOp(b, a, 12);
        if (!married(a) && !married(b)) {
          a.lover = b.id; b.lover = a.id;
          if (opOf(a, b) > 45 && opOf(b, a) > 40 && a.kingdom === b.kingdom) { out.result = 'proposal'; sim.marry(a, b); remember(sim, a, `Married ${b.name}`, 3); remember(sim, b, `Married ${a.name}`, 3); }
        } else if (!a.affair && !b.affair) {
          out.result = 'affair';
          a.affair = b.id; b.affair = a.id;
          sim.secrets.push({ id: ++sim.secretSeq, type: 'affair', a: a.id, b: b.id, t: sim.realTime, known: [] });
          remember(sim, a, `Fell into a secret affair with ${b.name}`, 2); remember(sim, b, `Fell into a secret affair with ${a.name}`, 2);
        }
      } else {
        out.result = 'rejected';
        addOp(a, b, -6); addOp(b, a, -3);
        if (married(b)) { const sp = sim.byId.get(b.spouseId); if (sp && Math.hypot(sp.x - a.x, sp.z - a.z) < 25) { out.result = 'caught_flirting'; jealousy(sim, sp, b, a, false); } }
      }
      break;
    }
  }
  return out;
}

export function startBrawl(sim, a, b) {
  for (const [x, y] of [[a, b], [b, a]]) { x.task = { type: 'brawl', target: y.id, t: 0, until: sim.realTime + 6 + sim.rand() * 4 }; x.thought = `Fighting ${y.name}!`; x.moodSet = 3; x.moodUntil = sim.realTime + 40; }
  const k = sim.kingdoms.get(a.kingdom);
  sim.event('brawl', `${sim.fullName(a)} and ${sim.fullName(b)} come to blows in ${k ? k.name : 'the wilds'}.`, { k: a.kingdom, x: a.x, z: a.z, minor: !(a.role >= 2 || b.role >= 2), pid: a.id });
}

// jealousy: what someone does on learning (or seeing) that their spouse betrayed them
export function jealousy(sim, spouse, cheat, lover, discovered) {
  const r = sim.rand, g = spouse.genes;
  addOp(spouse, cheat, discovered ? -70 : -18); addOp(spouse, lover, discovered ? -55 : -20);
  spouse.moodSet = 3; spouse.moodUntil = sim.realTime + 120;
  const k = sim.kingdoms.get(spouse.kingdom);
  const where = k ? k.name : 'the wilds';
  if (!discovered) { spouse.thought = `I saw ${lover.name} flirting with ${cheat.name}...`; remember(sim, spouse, `Saw ${lover.name} flirt with my spouse`, 1); return; }
  remember(sim, spouse, `Discovered ${cheat.name}'s affair with ${lover.name}`, 4);
  const rage = g.jealous * 0.5 + g.vengeful * 0.3 + g.aggr * 0.3 - g.kind * 0.3;
  const royal = spouse.role >= ROLE.RULER || cheat.role >= ROLE.RULER;
  let text, narr;
  if (rage > 0.62 && r() < 0.35 && adult(lover)) {
    // a crime of passion
    spouse.task = { type: 'vendetta', target: lover.id, t: 0 }; spouse.thought = `${lover.name} will pay for this.`;
    text = `${sim.fullName(spouse)} has learned of ${cheat.name}'s affair with ${lover.name}, and goes looking for ${lover.name} with murder in their heart.`;
    narr = `Love betrayed has turned to fury in ${where}. Will anyone stop ${spouse.name} before blood is spilled?`;
  } else if (rage > 0.42) {
    startBrawl(sim, spouse, lover);
    text = `${sim.fullName(spouse)} discovers ${cheat.name}'s affair with ${lover.name} and attacks ${lover.name} in a rage.`;
    narr = `The secret is out in ${where}. Some wounds heal. This one may not.`;
  } else {
    text = `${sim.fullName(spouse)} discovers that ${cheat.name} has been unfaithful with ${lover.name}.`;
    narr = g.honor > 0.6 ? `Will ${spouse.name} forgive, or will honour demand an end?` : `Heartbreak in ${where}. What will ${spouse.name} do now?`;
  }
  sim.event('scandal', text, { k: spouse.kingdom, x: spouse.x, z: spouse.z, pid: spouse.id, narr, major: royal });
  // divorce when the love is gone
  if (opOf(spouse, cheat) < -45 && r() < 0.35 + g.vengeful * 0.3 - g.honor * 0.2) {
    spouse.spouseId = 0; cheat.spouseId = 0;
    if (spouse.role === ROLE.CONSORT) spouse.role = ROLE.COMMONER; if (cheat.role === ROLE.CONSORT) cheat.role = ROLE.COMMONER;
    sim.event('divorce', `${sim.fullName(spouse)} casts out ${cheat.name}. Their marriage is over.`, { k: spouse.kingdom, pid: spouse.id, narr: `And ${lover.name}? Free now to claim what was stolen... or to be hated by all.` });
    remember(sim, cheat, `Was cast out by ${spouse.name}`, 3);
  }
}

// once a minute: secrets leak, feelings fade, lovers grow bolder, grief settles
export function socialTick(sim) {
  const r = sim.rand;
  // secrets come out
  for (let i = sim.secrets.length - 1; i >= 0; i--) {
    const s = sim.secrets[i];
    const a = sim.byId.get(s.a), b = sim.byId.get(s.b);
    if (!a || !b) { sim.secrets.splice(i, 1); continue; }
    if (s.type === 'affair') {
      const spA = sim.byId.get(a.spouseId), spB = sim.byId.get(b.spouseId);
      if (!spA && !spB) { sim.secrets.splice(i, 1); a.affair = b.affair = 0; continue; }
      const age = (sim.realTime - s.t) / 60;
      if (r() < 0.04 + age * 0.008) {
        sim.secrets.splice(i, 1); a.affair = b.affair = 0;
        if (spA) jealousy(sim, spA, a, b, true);
        if (spB && spB !== spA) jealousy(sim, spB, b, a, true);
      }
    }
  }
  // feelings fade slowly towards neutral (memories keep the strong ones alive longer)
  for (const p of sim.people) {
    if (!p.ops) continue;
    for (const id in p.ops) { const v = p.ops[id]; p.ops[id] = Math.abs(v) < 0.5 ? 0 : v * 0.985; if (!p.ops[id]) delete p.ops[id]; }
  }
}

// a person died: grief, and grudges against whoever caused it
export function onDeath(sim, dead, killer) {
  const mourners = new Set([...(dead.children || []), dead.spouseId, dead.motherId, dead.fatherId, dead.lover, ...Object.keys(dead.ops || {}).filter((id) => dead.ops[id] > 40).map(Number)]);
  for (const id of mourners) {
    const q = sim.byId.get(id); if (!q || q === dead) continue;
    const close = id === dead.spouseId || dead.children?.includes(id) || id === dead.motherId || id === dead.fatherId || opOf(q, dead) > 40;
    if (!close) continue;
    q.moodSet = 2; q.moodUntil = sim.realTime + 150;
    q.thought = `Grieving for ${dead.name}`;
    remember(sim, q, `Lost ${dead.name}`, 3);
    if (killer) {
      addOp(q, killer, -60);
      const kk = sim.kingdoms.get(killer.kingdom), qk = sim.kingdoms.get(q.kingdom);
      if (kk && qk && kk !== qk) {
        q.feud = q.feud || {}; q.feud[kk.id] = (q.feud[kk.id] || 0) + 1;
        if (q.id === qk.rulerId) { const rel = qk.relOf(kk.id); rel.tension = Math.min(100, (rel.tension || 0) + 30); rel.cb = `the murder of ${dead.name}`; }
      }
    }
  }
  if (dead.affair) { const l = sim.byId.get(dead.affair); if (l) { l.affair = 0; l.moodSet = 2; l.moodUntil = sim.realTime + 150; remember(sim, l, `Lost my secret love ${dead.name}`, 3); } }
}

// heirs inherit half of the old ruler's grudges (Crusader Kings)
export function inheritGrudges(sim, from, heir) {
  if (!from?.ops || !heir) return;
  for (const id in from.ops) if (from.ops[id] < -20) addOp(heir, sim.byId.get(+id), from.ops[id] * 0.5);
}

// ---------------- plots against the crown (Crusader Kings schemes) ----------------
export function plotTick(sim) {
  const r = sim.rand;
  for (const k of sim.kingdoms.values()) {
    const ruler = sim.byId.get(k.rulerId);
    if (!ruler || k.pop < 12) continue;
    let plot = sim.plots.find((p) => p.k === k.id);
    if (!plot) {
      // an ambitious, disloyal noble may begin to conspire
      if (r() > 0.25) continue;
      const cands = [...k.members].map((id) => sim.byId.get(id)).filter((p) => p && p !== ruler && p.ageY >= 20 && p.ageY < 60 &&
        p.genes.ambit > 0.7 && p.loyalty < 0.45 && opOf(p, ruler) < 5 && p.genes.honor < 0.6);
      if (!cands.length) continue;
      const owner = cands.sort((a, b) => (b.genes.ambit - b.loyalty) - (a.genes.ambit - a.loyalty))[0];
      plot = { k: k.id, owner: owner.id, target: ruler.id, progress: 0, agents: [], t: sim.realTime };
      sim.plots.push(plot);
      owner.thought = `${sim.title(ruler)} ${ruler.name} is unfit to rule. Something must be done.`;
      remember(sim, owner, `Began plotting against ${ruler.name}`, 2);
      if (r() < 0.5) sim.event('whisper', `In the shadows of ${k.name}, someone has begun to whisper of treason.`, { k: k.id, narr: `Who would dare? And how many will follow?`, minor: false, hideNames: true });
      continue;
    }
    const owner = sim.byId.get(plot.owner), target = sim.byId.get(plot.target);
    if (!owner || !target || owner.kingdom !== k.id || target.id !== k.rulerId) { sim.plots.splice(sim.plots.indexOf(plot), 1); continue; }
    // recruit the disaffected
    if (plot.agents.length < 6 && r() < 0.5) {
      const m = sim.byId.get([...k.members][Math.floor(r() * k.members.size)]);
      if (m && m !== owner && m !== target && !plot.agents.includes(m.id) && m.ageY >= 16 && opOf(m, target) < -10 && opOf(m, owner) > -5 && m.loyalty < 0.55) plot.agents.push(m.id);
    }
    plot.progress += 2 + plot.agents.length * 1.5 + owner.genes.intel * 3;
    // discovery
    const spot = 0.02 + plot.agents.length * 0.012 + target.genes.intel * 0.02;
    if (r() < spot) {
      sim.plots.splice(sim.plots.indexOf(plot), 1);
      const mercy = target.genes.kind * 0.5 + target.genes.honor * 0.2 - target.genes.vengeful * 0.4;
      if (mercy > 0.25 && r() < 0.6) {
        sim.event('treason', `${sim.fullName(target)} uncovers ${owner.name}'s plot — and, to everyone's surprise, shows mercy. ${owner.name} is banished from ${k.name}.`, { k: k.id, pid: owner.id, narr: `Mercy... or weakness? ${owner.name} will not forget this day.` });
        addOp(owner, target, -30); owner.loyalty = 0.05;
        const dest = [...sim.kingdoms.values()].filter((o) => o.id !== k.id).sort((a, b) => sim.relTension(b, k) - sim.relTension(a, k))[0];
        if (dest) { sim.transfer(owner, dest.id); owner.task = { type: 'migrate', dest: dest.id, t: 0, phase: 0 }; }
      } else {
        sim.event('treason', `${sim.fullName(target)} uncovers a plot against the crown. ${owner.name} is executed for treason${plot.agents.length ? `, with ${plot.agents.length} co-conspirator${plot.agents.length > 1 ? 's' : ''}` : ''}.`, { k: k.id, x: k.x, z: k.z, narr: `The message is clear. But fear is a poor foundation for a throne.` });
        for (const id of plot.agents) { const a = sim.byId.get(id); if (a && r() < 0.5) sim.die(a, `was executed for treason by ${sim.fullName(target)}`); }
        sim.die(owner, `was executed for treason by ${sim.fullName(target)}`);
      }
      continue;
    }
    if (plot.progress >= 100) {
      sim.plots.splice(sim.plots.indexOf(plot), 1);
      const success = r() < 0.45 + plot.agents.length * 0.06 + owner.genes.intel * 0.15 - target.genes.courage * 0.1;
      if (success) {
        sim.event('assassination', `${sim.fullName(target)} of ${k.name} has been assassinated! ${owner.name} seizes the throne.`, { k: k.id, x: k.x, z: k.z, narr: `A crown taken in blood. How long before someone takes it the same way?` });
        sim.usurp = { k: k.id, by: owner.id };
        sim.die(target, `was assassinated by ${owner.name}`);
      } else {
        sim.event('treason', `An attempt on the life of ${sim.fullName(target)} fails. ${owner.name} is caught and put to death.`, { k: k.id, x: k.x, z: k.z, narr: `The ruler of ${k.name} lives — but trusts no one now.` });
        sim.die(owner, `was executed after a failed assassination attempt`);
        for (const id of [...k.members]) { const p = sim.byId.get(id); if (p) p.loyalty -= 0.03; }
      }
    }
  }
}
