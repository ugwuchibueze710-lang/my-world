// Ravens between thrones: kingdoms write letters (threats, demands, insults, gifts, marriage offers),
// and each ruler answers according to their own character. Tension builds until something breaks.
import { calendar } from '../../shared/constants.js';
import { opOf } from './social.js';

const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function tensionTick(sim) {
  // tension drifts towards a pressure set by borders, envy, grudges and fear
  const ks = [...sim.kingdoms.values()];
  for (const k of ks) for (const o of ks) {
    if (k.id >= o.id) continue;
    const r1 = k.relOf(o.id), r2 = o.relOf(k.id);
    const d = Math.hypot(k.x - o.x, k.z - o.z);
    const border = clamp(1 - (d - k.radius - o.radius) / 1500, 0, 1) * 30;
    const envy = clamp(Math.abs(k.food / (k.pop + 1) - o.food / (o.pop + 1)) * 2, 0, 15);
    const grudge = ((r1.grudge || 0) + (r2.grudge || 0)) * 25;
    const war = r1.state === 'war' ? 90 : 0, ally = r1.state === 'ally' ? -35 : 0;
    const target = clamp(border + envy + grudge + war + ally + (k.capital || o.capital ? 10 : 0), 0, 100);
    const t = (r1.tension ?? target);
    const nt = t + (target - t) * 0.03;
    r1.tension = r2.tension = Math.round(nt * 10) / 10;
  }
}

function ruler(sim, k) { return sim.byId.get(k.rulerId); }
function sig(sim, k) { const r = ruler(sim, k); return r ? `${sim.title(r)} ${r.name} of ${k.name}` : `the council of ${k.name}`; }

// each ruler, now and then, decides whether to write to another realm
export function diplomacyTick(sim) {
  const r = sim.rand;
  // deliver ravens in flight
  for (let i = sim.ravens.length - 1; i >= 0; i--) {
    const l = sim.ravens[i];
    if (sim.realTime < l.arrive) continue;
    sim.ravens.splice(i, 1);
    receive(sim, l);
  }
  for (const k of sim.kingdoms.values()) {
    const ru = ruler(sim, k); if (!ru) continue;
    k.letterT = (k.letterT ?? 20 + r() * 40) - 10;
    if (k.letterT > 0) continue;
    k.letterT = 40 + r() * 70 - ru.genes.social * 20;
    const others = [...sim.kingdoms.values()].filter((o) => o !== k && Math.hypot(o.x - k.x, o.z - k.z) < 5000);
    if (!others.length) continue;
    // write to whoever is on their mind: the most tense, or a neighbour
    others.sort((a, b) => (k.relOf(b.id).tension || 0) - (k.relOf(a.id).tension || 0));
    const o = r() < 0.7 ? others[0] : pick(r, others);
    const rel = k.relOf(o.id), t = rel.tension || 0, g = ru.genes;
    if (rel.state === 'war') continue;
    const ratio = (k.power + 1) / (o.power + 1);
    const w = {
      gift: (g.kind * 0.6 + g.honor * 0.4) * (t < 40 ? 1 : 0.3) * (ratio < 1 ? 1.4 : 0.7),
      marriage: marriageable(sim, k, o) ? (0.5 + g.social * 0.5) * (t < 55 ? 1 : 0.2) : 0,
      tribute: (g.greed * 0.6 + g.ambit * 0.4) * (ratio > 1.4 ? 1.3 : 0) * (rel.tributeUntil > sim.realTime ? 0 : 1),
      threat: g.aggr * (t > 35 ? 1.2 : 0.2) * (ratio > 0.9 ? 1 : 0.4),
      insult: (g.abrasive * 0.6 + g.vengeful * 0.4) * (t > 50 ? 1 : 0.1),
      accuse: rel.cb ? 1.2 + g.vengeful : 0,
      nothing: 1.2,
    };
    let sum = 0; for (const x in w) sum += w[x];
    let roll = r() * sum, kind = 'nothing';
    for (const x in w) { roll -= w[x]; if (roll <= 0) { kind = x; break; } }
    if (kind === 'nothing') continue;
    send(sim, k, o, kind);
  }
}

function marriageable(sim, k, o) {
  const single = (kk) => [...kk.members].map((id) => sim.byId.get(id)).find((p) => p && (p.role === 2 || p.role === 4) && !p.spouseId && p.ageY >= 16 && p.ageY < 40);
  const a = single(k), b = single(o);
  return a && b && a.sex !== b.sex ? [a, b] : null;
}

function send(sim, k, o, kind) {
  const r = sim.rand, ru = ruler(sim, k), their = ruler(sim, o);
  const tn = their ? `${sim.title(their)} ${their.name}` : `the lords of ${o.name}`;
  const rel = k.relOf(o.id);
  let text = '', extra = {};
  switch (kind) {
    case 'gift': {
      const amt = Math.round(Math.min(k.food * 0.08, 25));
      if (amt < 3) return;
      k.food -= amt; extra.food = amt;
      text = pick(r, [`To ${tn}: accept these ${amt} sacks of grain as a token of friendship between our peoples. May our borders stay quiet.`,
        `${tn}, the harvest was kind to ${k.name}. We send ${amt} sacks of grain, and our good will.`]);
      break;
    }
    case 'marriage': {
      const pair = marriageable(sim, k, o); if (!pair) return;
      extra.a = pair[0].id; extra.b = pair[1].id;
      text = `${tn}, let our houses be joined. I offer the hand of ${sim.fullName(pair[0])} to ${sim.fullName(pair[1])}. Let blood bind ${k.name} and ${o.name} in peace.`;
      break;
    }
    case 'tribute': {
      const amt = Math.round(clamp(o.food * 0.25, 10, 80));
      extra.food = amt;
      text = pick(r, [`${tn}. ${k.name} grows strong, and the strong protect the weak — for a price. Send ${amt} sacks of grain before the next moon, or I will come and take them.`,
        `To ${tn}: your granaries overflow while my soldiers hunger. ${amt} sacks of grain. Consider it the cost of peace.`]);
      break;
    }
    case 'threat': {
      const why = rel.cb ? `you will answer for ${rel.cb}` : (k.food / (k.pop + 1) < 2 ? 'my people starve while yours grow fat' : o.capital ? 'you call yourselves the capital of the world' : 'your borders creep closer to mine every season');
      text = pick(r, [`${tn}. I will say this once: ${why}. Bend the knee to ${k.name}, or I will burn your fields and salt your earth.`,
        `To the so-called ruler of ${o.name}: ${why}. My patience ends with this letter. Choose your next words carefully.`]);
      break;
    }
    case 'insult':
      text = pick(r, [`${tn}, I am told you rule ${o.name}. I had assumed it was ruled by goats. The resemblance is remarkable.`,
        `To ${tn}: your father was a coward, and you are his worthy heir. ${k.name} laughs at you.`,
        `${o.name} is a realm of thieves ruled by a fool. Tell me I am wrong — if you have the courage.`]);
      break;
    case 'accuse':
      text = `${tn}. You answer for ${rel.cb}. ${k.name} demands justice — the guilty delivered to us in chains — or we shall take it ourselves.`;
      break;
  }
  const letter = { from: k.id, to: o.id, kind, text, arrive: sim.realTime + 15 + Math.random() * 20, ...extra };
  sim.ravens.push(letter);
  const narr = {
    threat: `A raven flies from ${k.name}. Its message is not a kind one.`,
    tribute: `${k.name} has made its demand. Now ${o.name} must decide: pay, or bleed.`,
    insult: `Words can wound as deeply as swords. ${their ? their.name : o.name} will read this... and remember.`,
    accuse: `Blood calls for blood. Will ${o.name} answer the charge, or ignore it?`,
    marriage: `A wedding could bind these realms together. But will ${their ? their.name : o.name} accept?`,
    gift: `A gesture of friendship. In times like these, it may be worth more than gold.`,
  }[kind];
  sim.event('letter', `✉ ${sig(sim, k)} writes to ${o.name}: “${text}”`, { k: k.id, k2: o.id, x: k.x, z: k.z, letter: kind, narr, quote: text, fromName: sig(sim, k) });
  rel.tension = clamp((rel.tension || 0) + ({ threat: 10, insult: 14, accuse: 12, tribute: 8, gift: -6, marriage: -4 }[kind] || 0), 0, 100);
  o.relOf(k.id).tension = rel.tension;
}

function receive(sim, l) {
  const r = sim.rand;
  const k = sim.kingdoms.get(l.to), from = sim.kingdoms.get(l.from);
  if (!k || !from) return;
  const ru = ruler(sim, k); if (!ru) return;
  const g = ru.genes, rel = k.relOf(from.id), back = from.relOf(k.id);
  const ratio = (k.power + 1) / (from.power + 1);
  const name = sim.fullName(ru);
  const setT = (d) => { rel.tension = back.tension = clamp((rel.tension || 0) + d, 0, 100); };
  let text = '', narr = '', kind = 'reply';
  switch (l.kind) {
    case 'gift':
      k.food += l.food || 0; setT(-12); rel.grudge = Math.max(0, (rel.grudge || 0) - 0.15);
      text = `${name} accepts the gift from ${from.name} with thanks.`;
      break;
    case 'marriage': {
      const a = sim.byId.get(l.a), b = sim.byId.get(l.b);
      const yes = a && b && !a.spouseId && !b.spouseId && r() < 0.35 + g.social * 0.3 + g.honor * 0.2 - (rel.tension || 0) / 150 + (ratio < 1 ? 0.15 : 0);
      if (yes) {
        sim.marry(a, b);
        rel.state = back.state = 'ally'; setT(-35);
        text = `${name} accepts! ${sim.fullName(a)} and ${sim.fullName(b)} are wed. ${k.name} and ${from.name} are now bound by blood and alliance.`;
        narr = `Two houses become one. But alliances made at the altar can be broken on the battlefield.`;
        kind = 'royal_wedding';
      } else { setT(8); text = `${name} refuses the marriage offer from ${from.name}. ${from.name} takes it as a slight.`; narr = `A proud refusal. ${from.name} will remember it.`; }
      break;
    }
    case 'tribute': {
      const fear = (1 / ratio) * (1.2 - g.courage) * (1.1 - g.aggr);
      if (fear > 0.8 && k.food >= l.food) {
        k.food -= l.food; from.food += l.food; setT(-4); rel.grudge = Math.min(1, (rel.grudge || 0) + 0.25);
        rel.tributeUntil = back.tributeUntil = sim.realTime + 600;
        text = `${name} pays ${l.food} sacks of grain to ${from.name}. The court of ${k.name} burns with shame.`;
        narr = `Peace has been bought. But humiliation is a debt that is always repaid.`;
      } else {
        setT(18); back.cb = `${k.name}'s refusal to pay tribute`;
        text = pick(r, [`${name} replies: “Come and take it.”`, `${name} tears the letter in half and sends the pieces back to ${from.name}.`, `${name} answers ${from.name}: “Not one grain.”`]);
        const fr = ruler(sim, from);
        narr = fr && fr.genes.aggr > 0.6 ? `Defiance. And ${fr.name} of ${from.name} is not known for patience...` : `${k.name} has called the bluff. Will ${from.name} dare to back its words with steel?`;
      }
      break;
    }
    case 'threat': case 'accuse': {
      const defiant = g.aggr * 0.5 + g.courage * 0.4 + g.honor * 0.2 + (ratio > 1 ? 0.25 : -0.15) > 0.55;
      if (defiant) {
        setT(14); back.cb = back.cb || `${k.name}'s defiance`;
        text = pick(r, [`${name} answers ${from.name}: “${k.name} bends the knee to no one. If you want war, you will have it.”`, `${name} sends the raven back with a single word: “Never.”`]);
        narr = `The gauntlet is thrown down. Somewhere, soldiers are sharpening their swords.`;
      } else {
        const amt = Math.round(Math.min(k.food * 0.1, 30));
        k.food -= amt; from.food += amt; setT(-8);
        text = `${name} sends a conciliatory reply to ${from.name}, with ${amt} sacks of grain as a peace offering.`;
        narr = `A soft answer turns away wrath — for now. But ${from.name} has learned that ${k.name} can be pushed.`;
      }
      break;
    }
    case 'insult': {
      if (g.vengeful > 0.55 || g.abrasive > 0.6) {
        setT(16); back.cb = back.cb || `the insult to the house of ${k.dynasty}`;
        text = `${name} is enraged by the insult from ${from.name} and swears that it will be answered in blood.`;
        narr = `Pride has been wounded. And wounded pride has started more wars than gold ever did.`;
      } else { setT(5); text = `${name} laughs off the insult from ${from.name}.`; }
      break;
    }
  }
  if (text) sim.event(kind, text, { k: k.id, k2: from.id, x: k.x, z: k.z, narr: narr || undefined, letterReply: l.kind });
  const hist = `Year ${calendar(sim.time).year}: ${l.kind === 'gift' ? 'received a gift from' : l.kind === 'marriage' ? 'a marriage was proposed by' : `received a ${l.kind} from`} ${from.name}.`;
  k.history.push(hist);
}

// the storyteller looks at the whole world and points at what matters most right now
export function storyteller(sim) {
  const r = sim.rand;
  const ideas = [];
  const ks = [...sim.kingdoms.values()];
  for (const k of ks) for (const o of ks) {
    if (k.id >= o.id) continue;
    const t = k.relOf(o.id).tension || 0;
    if (k.relOf(o.id).state !== 'war' && t > 55) ideas.push([t, `Between ${k.name} and ${o.name}, the air grows heavy. Letters fly; patience thins. How much longer can the peace hold?`]);
  }
  for (const k of ks) {
    const fpc = k.food / (k.pop + 1);
    if (k.pop > 8 && fpc < 1.2) ideas.push([60, `In ${k.name}, the granaries are nearly empty. Hungry people make dangerous choices.`]);
    if (k.atWar) ideas.push([50, `${k.name} is at war. Every mother there is counting her sons.`]);
    const ru = sim.byId.get(k.rulerId);
    if (ru && ru.ageY < 16) ideas.push([55, `A child sits on the throne of ${k.name}. Ambitious eyes are watching.`]);
  }
  if (sim.plots.length) ideas.push([65, `Somewhere, behind closed doors, a conspiracy grows. The crown does not yet know.`]);
  if (sim.secrets.length) ideas.push([45, `Not every marriage in this world is what it seems. Secrets have a way of coming out.`]);
  const cap = sim.kingdoms.get(sim.capitalId);
  if (cap) ideas.push([40, `${cap.name} sits at the top of the world. History has never been kind to those who stand highest.`]);
  if (!ideas.length) ideas.push([10, pick(r, [`For now, the land is quiet. But quiet never lasts.`, `The seasons turn. The people work, love and grow. Beneath it all, something is stirring.`])]);
  ideas.sort((a, b) => b[0] - a[0]);
  const top = ideas.slice(0, 3);
  sim.recentNarr = sim.recentNarr || [];
  const fresh = top.filter(([, t]) => !sim.recentNarr.includes(t));
  if (!fresh.length) return;
  const [, text] = fresh[Math.floor(r() * fresh.length)];
  sim.recentNarr.push(text); if (sim.recentNarr.length > 6) sim.recentNarr.shift();
  sim.event('narration', text, { narr: text, narrOnly: true });
}
