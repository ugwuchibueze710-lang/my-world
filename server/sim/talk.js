// Conversations: people who meet talk about what is actually happening in their lives and their realm.
import { STATE, ROLE } from '../../shared/constants.js';
import { chooseInteraction, applyInteraction, opOf } from './social.js';

export const MOOD = { NEUTRAL: 0, HAPPY: 1, SAD: 2, ANGRY: 3, SCARED: 4 };
const pick = (r, a) => a[Math.floor(r() * a.length)];

// mood from a person's situation (shown on their face)
export function moodOf(sim, p) {
  if (p.state === STATE.FIGHT) return MOOD.ANGRY;
  if (p.state === STATE.FLEE || (p.task?.type === 'flee')) return MOOD.SCARED;
  if (p.sick > 0 || p.health < 35 || p.satiety < 0.15 || p.hydration < 0.15) return MOOD.SAD;
  if (p.moodUntil > sim.realTime) return p.moodSet;
  if (p.state === STATE.COURT || p.state === STATE.PLAY) return MOOD.HAPPY;
  if (p.soldier && p.genes.aggr > 0.6) return MOOD.ANGRY;
  if (p.satiety > 0.6 && p.nourish > 0.75 && p.genes.social > 0.55) return MOOD.HAPPY;
  return MOOD.NEUTRAL;
}

export function maybeTalk(sim) {
  const r = sim.rand;
  const ppl = sim.people;
  if (ppl.length < 2) return;
  const tries = Math.min(ppl.length, 25);
  for (let t = 0; t < tries; t++) {
    const a = ppl[Math.floor(r() * ppl.length)];
    if (!a.alive || a.ageY < 4 || a.talkUntil > sim.realTime) continue;
    if (a.state === STATE.MARCH || a.state === STATE.MIGRATE) { if (r() > 0.15) continue; }
    let b = null;
    const sp = a.spouseId ? sim.byId.get(a.spouseId) : null;
    if (sp && sp.alive && sp.talkUntil <= sim.realTime && Math.hypot(sp.x - a.x, sp.z - a.z) < 12) b = sp; // couples talk to each other first
    if (!b) sim.spatial.query(a.x, a.z, 6, (q) => {
      if (q === a || q.ageY < 4 || q.talkUntil > sim.realTime || !q.alive) return;
      b = q; return false;
    });
    if (!b) continue;
    if (r() > 0.35 + a.genes.social * 0.5) continue;
    const kind = a.kingdom === b.kingdom && !sim.atWar(a.kingdom, b.kingdom) ? chooseInteraction(sim, a, b) : 'chat';
    const res = kind === 'chat' ? { kind } : applyInteraction(sim, a, b, kind);
    const convo = compose(sim, a, b, res);
    if (!convo) continue;
    const dur = convo.lines.length * 3.4 + 1;
    a.talkUntil = b.talkUntil = sim.realTime + dur + 20;
    for (const [x, y] of [[a, b], [b, a]]) {
      const busy = x.task && ['fight', 'flee', 'march', 'migrate', 'defend'].includes(x.task.type);
      if (!busy && x.ageY >= 3) { x.task = { type: 'talk', partner: y.id, until: sim.realTime + dur, t: 0 }; x.thought = `Talking with ${y.name}`; }
    }
    const c = { id: ++sim.talkSeq, a: a.id, b: b.id, k: a.kingdom, t: +sim.realTime.toFixed(1), lines: convo.lines };
    sim.talks.push(c);
    if (sim.talks.length > 60) sim.talks.shift();
    // conversations shape opinions
    if (convo.effect) convo.effect();
  }
}

function compose(sim, a, b, res = { kind: 'chat' }) {
  const r = sim.rand;
  const ka = sim.kingdoms.get(a.kingdom), kb = sim.kingdoms.get(b.kingdom);
  if (!ka || !kb) return null;
  const ruler = sim.byId.get(ka.rulerId);
  const rulerName = ruler ? `${sim.title(ruler)} ${ruler.name}` : 'the crown';
  const L = []; let effect = null;
  const say = (p, text, mood) => L.push({ s: p.id, n: (sim.title(p) ? sim.title(p) + ' ' : '') + p.name, f: p.sex === 'F' ? 1 : 0, c: p.ageY < 13 ? 1 : p.ageY > 60 ? 2 : 0, text, mood: mood ?? moodOf(sim, p) });
  const enemy = [...ka.rel.entries()].find(([, rel]) => rel.state === 'war');
  const enemyName = enemy ? sim.kingdoms.get(enemy[0])?.name : null;
  const fpc = ka.food / Math.max(1, ka.pop);
  const storm = sim.weather.storms.find((s) => Math.hypot(s.x - a.x, s.z - a.z) < s.r + 400 && s.type !== 'rain');
  const kid = (p) => p.ageY < 13;

  // enemies meeting
  if (a.kingdom !== b.kingdom && sim.atWar(a.kingdom, b.kingdom)) {
    say(a, pick(r, [`For ${ka.name}! Your king will fall!`, `Leave our lands, dog of ${kb.name}!`, `I'll send you back to ${kb.name} in pieces!`]), 3);
    say(b, pick(r, [`${kb.name} fears no one!`, `Come then, and die!`, `Your ${ka.name} is nothing!`]), 3);
    return { lines: L };
  }
  if (a.kingdom !== b.kingdom) {
    say(a, pick(r, [`Greetings, traveller of ${kb.name}.`, `You're far from ${kb.name}, friend.`, `How fares ${kb.name} these days?`]));
    say(b, kb.food / Math.max(1, kb.pop) > 4 ? `Our granaries are full. ${kb.name} prospers.` : `Times are hard in ${kb.name}. The harvests are thin.`);
    say(a, pick(r, [`May the rains be kind to us both.`, `Safe roads to you.`, `Then may peace hold between our crowns.`]));
    return { lines: L };
  }
  // children
  if (kid(a) && kid(b)) {
    say(a, pick(r, [`Race you to the well!`, `When I grow up I'll be a soldier!`, `I saw a storm cloud shaped like a dragon!`, `My mother says I can't go past the river.`]), 1);
    say(b, pick(r, [`You're too slow!`, `I want to be queen one day.`, `Liar! Dragons aren't real!`, `I'm not scared of the river.`]), 1);
    return { lines: L };
  }
  if (kid(a) !== kid(b)) {
    const adult = kid(a) ? b : a, child = kid(a) ? a : b;
    const pairs = fpc < 2
      ? [[`I'm hungry...`, `I know, little one. We all are. Be strong.`, 2], [`Is there any bread left?`, `Tomorrow, I promise. Tomorrow.`, 2]]
      : [[`Can I come to the fields?`, `When you're older. Go help your mother.`, 0], [`Tell me about the old wars!`, `Another time. Some stories are too sad for children.`, 1],
         [`Why is the sky so dark?`, `Storms, child. Stay close to the castle.`, 4], [`Will I be a knight one day?`, `If you eat your supper and grow strong.`, 1]];
    const [q, ans, m] = pick(r, pairs);
    say(child, q, m); say(adult, ans);
    return { lines: L };
  }
  // the interaction chosen by their relationship decides the shape of the conversation
  if (res.kind === 'insult') {
    const sp = sim.byId.get(b.spouseId);
    say(a, pick(r, [`Out of my way, ${b.name}.`, `Everyone knows you're a fool, ${b.name}.`, sp ? `Does ${sp.name} know what you get up to?` : `No wonder nobody will marry you.`, `You smell like the pig pens.`, `Lazy as ever, I see.`]), 3);
    say(b, opOf(b, a) < -20 ? pick(r, [`Say that again. I dare you.`, `I've had enough of you!`]) : pick(r, [`What did I ever do to you?`, `Leave me be.`]), opOf(b, a) < -20 ? 3 : 2);
    if (res.result === 'brawl') say(b, `That's it!`, 3);
    return { lines: L };
  }
  if (res.kind === 'flirt') {
    const married = a.spouseId || b.spouseId;
    say(a, married ? pick(r, [`Meet me by the river tonight. No one has to know.`, `I can't stop thinking about you.`, `We shouldn't be talking like this... but I don't care.`]) : pick(r, [`You have the kindest eyes in all of ${ka.name}.`, `Would you walk with me by the river?`, `I've been hoping to see you today.`]), 1);
    if (res.result === 'accepted' || res.result === 'affair' || res.result === 'proposal') say(b, married ? pick(r, [`...I'll be there.`, `This is madness. Yes.`]) : pick(r, [`I'd like that very much.`, `I was hoping you'd ask.`]), 1);
    else say(b, pick(r, [`I'm sorry. My heart belongs to another.`, `No. Please don't ask again.`, `You're not my type.`]), 0);
    if (res.result === 'proposal') say(a, `Then marry me. Today.`, 1);
    if (res.result === 'caught_flirting') { const sp = sim.byId.get(b.spouseId); if (sp) say(sp, `What is going on here?!`, 3); }
    return { lines: L };
  }
  if (res.kind === 'kind') { say(a, pick(r, [`You work harder than anyone here. Thank you.`, `If you ever need help, come to me.`, `Your children are a credit to you.`]), 1); say(b, pick(r, [`That means a great deal.`, `Bless you, friend.`]), 1); return { lines: L }; }
  const topics = [];
  if (storm) topics.push('storm');
  if (enemyName) topics.push('war', 'war');
  if (fpc < 2.5) topics.push('hunger', 'hunger');
  else topics.push('harvest');
  if (a.spouseId === b.id) { topics.length = 0; topics.push('spouse', 'spouse', 'spouse', 'spouse'); if (enemyName) topics.push('war'); if (fpc < 2) topics.push('hunger'); if (a.pregnant || b.pregnant) topics.push('baby', 'baby'); }
  if (!a.spouseId && !b.spouseId && a.sex !== b.sex && a.ageY > 15 && b.ageY > 15 && Math.abs(a.ageY - b.ageY) < 14) topics.push('flirt', 'flirt');
  if (a.genes.ambit > 0.68 && a.loyalty < 0.5) topics.push('rebel');
  if (a.loyalty < 0.4 && fpc < 1) topics.push('defect');
  if (sim.capitalId && sim.capitalId !== ka.id) topics.push('capital');
  if (ka.capital) topics.push('glory');
  topics.push('king', 'gossip', 'weather');
  if (a.pregnant || b.pregnant) topics.push('baby');
  const topic = pick(r, topics);

  switch (topic) {
    case 'storm': {
      const nm = { hurricane: 'hurricane', tornado: 'twister', blizzard: 'blizzard', wildfire: 'fire', flood: 'flood', drought: 'drought', plague: 'plague', thunderstorm: 'storm', heatwave: 'heat', windstorm: 'wind', snow: 'snow' }[storm.type] || 'storm';
      say(a, pick(r, [`Do you see it? The ${nm} is coming this way!`, `The ${nm}... I've never seen one so fierce.`, `Gods save us from this ${nm}.`]), 4);
      say(b, pick(r, [`Get the children inside!`, `We should run for the castle!`, `If it takes our crops, we starve.`]), 4);
      break;
    }
    case 'war':
      say(a, pick(r, [`They say ${enemyName} will march on us before the snows.`, `My cousin died fighting ${enemyName}.`, `${rulerName} will crush ${enemyName}, you'll see.`]), a.genes.courage > 0.5 ? 3 : 4);
      say(b, b.genes.courage > 0.5 ? pick(r, [`Let them come. I'll stand at the gate myself.`, `${ka.name} has never bowed to anyone.`]) : pick(r, [`I don't want to die for ${rulerName}'s pride.`, `I pray it ends soon.`]), b.genes.courage > 0.5 ? 3 : 2);
      if (r() < 0.5) say(a, pick(r, [`Sharpen your spear, then.`, `Then may our gods be stronger than theirs.`]));
      break;
    case 'hunger':
      say(a, pick(r, [`The stores are almost empty.`, `I haven't had a proper meal in days.`, `The fields gave us nothing this season.`]), 2);
      say(b, b.loyalty < 0.45 ? `${rulerName} eats while we starve. It isn't right.` : `We must work harder. The harvest will come.`, b.loyalty < 0.45 ? 3 : 2);
      if (b.loyalty < 0.45) effect = () => { a.loyalty -= 0.04; };
      break;
    case 'harvest':
      say(a, pick(r, [`Good harvest this year. The barns are full.`, `The wheat stands tall in the east fields.`, `We'll eat well this winter.`]), 1);
      say(b, pick(r, [`Praise the rains!`, `Then we'll have a feast at the castle.`, `May it last. Fat years never do.`]), 1);
      break;
    case 'spouse': {
      const royal = a.role === ROLE.RULER || b.role === ROLE.RULER;
      const bt = b.sex === 'F' ? 'queen' : 'king', at = a.sex === 'F' ? 'queen' : 'king';
      say(a, pick(r, royal ? [`My ${bt}... you light up this cold castle.`, `Every crown is heavy, except when I'm with you.`, `Walk with me, my love. Just us, tonight.`, `Our kingdom needs an heir... and I need you.`]
        : [`There you are, my love.`, `I missed you in the fields today.`, `Come here. Let me hold you.`, `You're even lovelier than the day we wed.`]), 1);
      say(b, pick(r, royal ? [`And you are my ${at}, in every way.`, `Then come to bed early tonight.`, `Let us give ${ka.name} a prince... or a princess.`] : [`Always, for you.`, `Come home early tonight.`, `Only if you promise me another dance.`]), 1);
      if (!a.pregnant && !b.pregnant && r() < 0.6) say(a, pick(r, [`I want a big family with you.`, `Let's have another child.`, `Our children will grow up strong.`]), 1);
      a.ops[b.id] = Math.min(100, (a.ops[b.id] || 0) + 6); b.ops[a.id] = Math.min(100, (b.ops[a.id] || 0) + 6);
      effect = () => { a.moodUntil = b.moodUntil = sim.realTime + 60; a.moodSet = b.moodSet = 1; };
      break;
    }
    case 'flirt':
      say(a, pick(r, [`I've seen you at the well every morning.`, `You have the kindest eyes in all of ${ka.name}.`, `Would you walk with me by the river?`]), 1);
      if (b.genes.social > 0.4) { say(b, pick(r, [`Maybe I go there to see you.`, `You're bold. I like that.`, `I would like that very much.`]), 1); effect = () => { a.moodUntil = b.moodUntil = sim.realTime + 40; a.moodSet = b.moodSet = 1; }; }
      else say(b, pick(r, [`I'm busy.`, `Not today.`, `You talk too much.`]), 0);
      break;
    case 'rebel':
      say(a, `Do you ever think... we could rule ourselves? A realm of our own?`, 0);
      say(b, b.loyalty < 0.5 ? `Hush! But... yes. I'd follow you.` : `That's treason. Don't let ${rulerName} hear you.`, b.loyalty < 0.5 ? 1 : 4);
      if (b.loyalty < 0.5) effect = () => { b.loyalty -= 0.06; a.loyalty -= 0.03; };
      break;
    case 'defect': {
      const rich = [...sim.kingdoms.values()].filter((o) => o.id !== ka.id && !sim.atWar(o.id, ka.id)).sort((x, y) => y.food / (y.pop + 1) - x.food / (x.pop + 1))[0];
      say(a, rich ? `They say ${rich.name} has bread for everyone. I'm thinking of leaving.` : `I'm thinking of leaving this place.`, 2);
      say(b, pick(r, [`And abandon your own people?`, `Take me with you.`, `You'd be called a traitor.`]));
      break;
    }
    case 'capital': {
      const cap = sim.kingdoms.get(sim.capitalId);
      say(a, `${cap?.name} calls itself the capital of the world now.`, 3);
      say(b, pick(r, [`Not for long. Every realm hates them.`, `They grow too strong. Someone must stop them.`, `Better to bow than to burn.`]));
      break;
    }
    case 'glory':
      say(a, `We are the capital of the world! ${ka.name} above all!`, 1);
      say(b, pick(r, [`And every realm wants to tear us down for it.`, `Long live ${rulerName}!`]), 1);
      break;
    case 'baby': {
      const mum = a.pregnant ? a : b, other = mum === a ? b : a;
      say(other, `How is the little one coming along?`, 1);
      say(mum, pick(r, [`Kicking like a soldier!`, `Any day now, I think.`, `I pray it's a healthy child.`]), 1);
      break;
    }
    case 'king':
      if (ruler && (ruler.id === a.id || ruler.id === b.id)) {
        const subj = ruler.id === a.id ? b : a;
        say(subj, pick(r, [`Your Majesty.`, `My liege, the people ask for more bread.`, `Long live the crown!`]), 0);
        say(ruler, ruler.genes.aggr > 0.6 ? pick(r, [`Bread is earned with the sword.`, `Keep working. ${ka.name} needs strong backs.`]) : pick(r, [`I hear them. We'll share the stores.`, `Thank you, friend. Go in peace.`]), ruler.genes.aggr > 0.6 ? 3 : 1);
      } else {
        say(a, pick(r, [`What do you make of ${rulerName}?`, `${rulerName} looked troubled today.`, `Did you see ${rulerName} riding out this morning?`]));
        say(b, b.loyalty > 0.6 ? pick(r, [`A wise ruler. We're lucky.`, `I'd die for the crown.`]) : pick(r, [`Too proud. It'll be our ruin.`, `Rulers come and go. The fields stay.`]), b.loyalty > 0.6 ? 1 : 0);
      }
      break;
    case 'gossip': {
      const others = [...ka.members].map((id) => sim.byId.get(id)).filter((q) => q && q !== a && q !== b && q.ageY > 14);
      const g = others.length ? pick(r, others) : null;
      if (!g) { say(a, `Quiet day.`); say(b, `Aye. Quiet.`); break; }
      say(a, g.pregnant ? `Did you hear? ${g.name} is with child!` : g.spouseId ? `${g.name} and their spouse were arguing again.` : g.soldier ? `${g.name} joined the army. Can you believe it?` : `${g.name} has been acting strange lately.`, g.pregnant ? 1 : 0);
      say(b, pick(r, [`No! Really?`, `I always knew it.`, `Keep your voice down.`, `That's none of our business.`]));
      break;
    }
    default:
      say(a, pick(r, [`Fine weather today.`, `My back aches from the fields.`, `Have you seen the birds? Winter is coming.`, `The river is high this year.`]));
      say(b, pick(r, [`Aye, it is.`, `Mine too, friend.`, `Let's hope it holds.`, `Good for the crops.`]));
  }
  return { lines: L, effect };
}
