// Turns simulation state into plain-English fact sheets for the AI voice (nothing invented, nothing omitted that matters).
import { calendar, STATE_NAMES } from '../../shared/constants.js';
import { opOf } from './social.js';

const T = [['ambit', 'ambitious', 'content with little'], ['aggr', 'hot-tempered', 'gentle'], ['courage', 'brave', 'timid'], ['loyal', 'loyal to the crown', 'disloyal'],
  ['social', 'talkative', 'quiet'], ['kind', 'kind-hearted', 'cold'], ['jealous', 'jealous', null], ['honor', 'honourable', 'dishonest'], ['vengeful', 'vengeful', 'forgiving'],
  ['romantic', 'romantic', null], ['greed', 'greedy', 'generous'], ['abrasive', 'blunt and rude', null], ['intel', 'clever', 'simple-minded'], ['dilig', 'hard-working', 'lazy']];
export function traits(p) {
  const out = [];
  for (const [k, hi, lo] of T) { const v = p.genes[k]; if (v > 0.72) out.push(hi); else if (lo && v < 0.25) out.push(lo); }
  return out.slice(0, 6).join(', ') || 'ordinary';
}
const feel = (v) => v >= 60 ? 'loves' : v >= 30 ? 'is fond of' : v >= 10 ? 'likes' : v > -10 ? 'feels neutral about' : v > -40 ? 'dislikes' : 'hates';

export function personSheet(sim, p, label) {
  const k = sim.kingdoms.get(p.kingdom);
  const title = sim.title(p);
  const sp = sim.byId.get(p.spouseId);
  const kids = (p.children || []).map((id) => sim.byId.get(id)).filter((c) => c && c.alive);
  const needs = [];
  if (p.satiety < 0.3) needs.push('hungry'); if (p.hydration < 0.3) needs.push('thirsty'); if (p.energy < 0.3) needs.push('exhausted');
  if (p.sick > 0) needs.push('sick with plague'); if (p.pregnant) needs.push('pregnant'); if (p.health < 40) needs.push('injured');
  const lines = [
    `${label}: ${title ? title + ' ' : ''}${p.name} of ${k ? k.name : 'no kingdom'}, ${p.sex === 'F' ? 'woman' : 'man'}, age ${Math.floor(p.ageY)}.`,
    `  Personality: ${traits(p)}.`,
    `  Doing: ${STATE_NAMES[p.state] || 'idle'}; thinking "${p.thought}". ${needs.length ? 'Currently ' + needs.join(', ') + '.' : ''}`,
    `  Family: ${sp ? `married to ${sp.name}` : 'unmarried'}${kids.length ? `; children: ${kids.map((c) => `${c.name} (${Math.floor(c.ageY)})`).join(', ')}` : '; no children'}.`,
  ];
  if (p.affair) { const l = sim.byId.get(p.affair); if (l) lines.push(`  SECRET (only ${p.name} knows; would never say it openly in front of others): having an affair with ${l.name}.`); }
  if (sim.plots.some((x) => x.owner === p.id)) lines.push(`  SECRET: secretly plotting against the ruler.`);
  if (p.soldier) lines.push(`  Is a soldier in the army.`);
  if (p.mem?.length) lines.push(`  Memories: ${p.mem.slice(-3).map((m) => m.text).join('; ')}.`);
  return lines.join('\n');
}

export function kingdomSheet(sim, k) {
  const ru = sim.byId.get(k.rulerId);
  const fpc = k.food / Math.max(1, k.pop);
  const wars = [...k.rel.entries()].filter(([id, r]) => r.state === 'war' && sim.kingdoms.has(id)).map(([id]) => sim.kingdoms.get(id).name);
  const tense = [...k.rel.entries()].filter(([id, r]) => r.state !== 'war' && sim.kingdoms.has(id) && (r.tension || 0) > 30).map(([id, r]) => `${sim.kingdoms.get(id).name} (tension ${Math.round(r.tension)}/100${r.cb ? ', grievance: ' + r.cb : ''})`);
  const allies = [...k.rel.entries()].filter(([id, r]) => r.state === 'ally' && sim.kingdoms.has(id)).map(([id]) => sim.kingdoms.get(id).name);
  const letters = sim.events.slice(-60).filter((e) => (e.type === 'letter' || e.type === 'reply') && (e.k === k.id || e.k2 === k.id)).slice(-2).map((e) => e.text.slice(0, 180));
  return [
    `Kingdom ${k.name}: ruled by ${ru ? sim.fullName(ru) : 'no one'}; ${k.pop} people (${k.kids} children); ${['', 'a tiny hamlet', 'a village', 'a walled town', 'a great citadel'][k.tier]}.`,
    `  Food: ${fpc > 6 ? 'plentiful' : fpc > 2 ? 'enough' : fpc > 0.8 ? 'running low' : 'nearly gone, people are starving'}. ${k.capital ? 'It is the capital of the world.' : ''}`,
    wars.length ? `  AT WAR with ${wars.join(', ')}.` : '  At peace.',
    tense.length ? `  Strained relations: ${tense.join('; ')}.` : '', allies.length ? `  Allies: ${allies.join(', ')}.` : '',
    letters.length ? `  Recent royal letters: ${letters.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
}

export function worldLine(sim, x, z) {
  const cal = calendar(sim.time), h = sim.hour();
  const part = h < 5 ? 'night' : h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  const storms = sim.weather.storms.filter((s) => Math.hypot(s.x - x, s.z - z) < s.r + 300 && s.type !== 'rain').map((s) => s.type);
  const raining = sim.weather.storms.some((s) => (s.type === 'rain' || s.type === 'snow') && Math.hypot(s.x - x, s.z - z) < s.r);
  return `Time: ${part}, ${cal.seasonName} of year ${cal.year}.${raining ? ' It is raining/snowing.' : ''}${storms.length ? ' Danger nearby: ' + storms.join(', ') + '.' : ''} The world has ${sim.kingdoms.size} kingdoms and ${sim.people.length} people in total.`;
}

const INTERACTION = {
  chat: 'friendly small talk', deep: 'a meaningful, personal conversation', kind: 'A says something kind to B',
  insult: 'A insults B', flirt: 'A flirts with B',
};
export function interactionLine(sim, a, b, res) {
  let s = INTERACTION[res.kind] || 'conversation';
  if (res.result === 'accepted') s += ' and B welcomes it';
  if (res.result === 'rejected') s += ' but B rejects A';
  if (res.result === 'affair') s += ' — both are married to others, and they begin a secret affair (they whisper)';
  if (res.result === 'proposal') s += ' — A proposes marriage and B says yes';
  if (res.result === 'brawl') s += ' — it ends with B punching A, a fight breaks out';
  if (res.result === 'caught_flirting') s += ` — and B's spouse sees it and is furious`;
  if (a.spouseId === b.id && res.kind !== 'insult') s += ' (they are husband and wife, affectionate)';
  return `INTERACTION: ${s}. A ${feel(opOf(a, b))} B (${Math.round(opOf(a, b))}); B ${feel(opOf(b, a))} A (${Math.round(opOf(b, a))}).`;
}
