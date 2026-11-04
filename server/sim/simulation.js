// The autonomous world: people with free will, kingdoms, harvest, mating, war, alliances, secession, weather.
import { createWorld, GRID, CELL, HALF, WORLD_SIZE, clamp } from '../../shared/world.js';
import { mulberry32 } from '../../shared/noise.js';
import { HOURS_PER_YEAR, STATE, ROLE, calendar, seasonalOffset, AGENT_BYTES, MSG_AGENTS, MSG_LAND, STATE_NAMES } from '../../shared/constants.js';
import { Culture } from './names.js';
import { SpatialHash } from './spatial.js';
import { Weather } from './weather.js';
import { maybeTalk, moodOf } from './talk.js';
import { ensurePersona, socialTick, plotTick, onDeath, inheritGrudges, opOf, addOp, remember } from './social.js';
import { tensionTick, diplomacyTick, storyteller } from './diplomacy.js';

const YEAR = HOURS_PER_YEAR;
// curtain-wall half size (tier 1: palisade radius) and keep half-extents [x, z, corner tower radius], matching buildings.js
const WALL_R = [0, 17, 24, 34, 50];
const KEEP = [null, [7.3, 4.3, 0], [6.5, 6.5, 3.8], [8.5, 8.5, 4.8], [11.5, 11.5, 4.8]];
// population pace (tunable on Render without code changes)
const GROWTH = Number(process.env.GROWTH_RATE) || 20;         // childhood passes 6x faster than the calendar
const PREG_DAYS = Number(process.env.PREGNANCY_DAYS) || 30;   // world days from conception to birth
const BIRTH_GAP_DAYS = Number(process.env.BIRTH_GAP_DAYS) || 20;
const FERTILITY = Number(process.env.FERTILITY) || 5;          // conception chance multiplier
const SETTLER_POP = Number(process.env.SETTLER_POP) || 60;      // kingdoms below this size attract settler families
const SETTLER_SECS = Number(process.env.SETTLER_SECONDS) || 120; // at most one family per kingdom every 7 real minutes
const FIELD_GROWTH = Number(process.env.FIELD_GROWTH) || 3;     // how fast fields regrow
const TWINS = Number(process.env.TWINS) || 0.15;
const N = GRID * GRID;
const OWN = 128, OCELL = WORLD_SIZE / OWN;
const PALETTE = ['#c0392b', '#2e6fd8', '#e0a526', '#27ae60', '#8e44ad', '#16a2a2', '#d35400', '#c2185b', '#6d8a16', '#5d4fd1',
  '#a0522d', '#1abc9c', '#e84393', '#3f7f3f', '#b8860b', '#4682b4', '#9b2335', '#00838f', '#7b5ea7', '#cf6a32'];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

let PID = 1, KID = 1;
export { Person, Kingdom };
export const ids = { get: () => ({ PID, KID }), set: (o) => { PID = o.PID; KID = o.KID; } };

class Person {
  constructor(o) {
    this.id = PID++;
    Object.assign(this, {
      name: '', house: '', sex: 'M', birth: 0, kingdom: 0, x: 0, z: 0, heading: 0,
      fatherId: 0, motherId: 0, spouseId: 0, children: [], gen: 1,
      health: 100, satiety: 0.9, hydration: 0.9, energy: 1, nourish: 0.8, sick: 0,
      state: STATE.IDLE, task: null, thinkT: 0, scanT: 0, attackCd: 0, carry: 0, carryMin: 0,
      role: ROLE.COMMONER, soldier: false, pregnant: null, lastBirth: -1e9, kills: 0,
      thought: 'Looking around', alive: true, ageY: 0, loyalty: 0.7, lastCause: '', pushed: 0,
    }, o);
  }
}

class Kingdom {
  constructor(o) {
    this.id = KID++;
    Object.assign(this, {
      name: '', color: '#fff', founded: 0, parentId: 0, rulerId: 0, x: 0, z: 0, food: 80, minerals: 0, armory: 0,
      houses: [], members: new Set(), rel: new Map(), army: { state: 'none' }, capital: false,
      wins: 0, losses: 0, conquests: 0, history: [], pop: 0, fighters: 0, soldiers: 0, power: 0, nourish: 0.8,
      radius: 140, tier: 1, needsHouse: false, buildProgress: 0, buildSite: null, defense: false, defenseT: 0,
      hasWell: false, weaponLevel: 0, mineralNeed: 0.5, thinkT: 0, dynasty: '', siege: 0, kills: 0, deaths: 0,
      coalition: false, housesVer: 0, monarchs: 0,
    }, o);
  }
  local(lx, lz) { const c = Math.cos(this.rot), s = Math.sin(this.rot); return [this.x + lx * c + lz * s, this.z - lx * s + lz * c]; }
  wallR() { return [0, 18, 25, 36, 52][this.tier]; }
  relOf(id) {
    let r = this.rel.get(id);
    if (!r) { r = { state: 'peace', since: 0, truceUntil: 0, grudge: 0, ourDead: 0, theirDead: 0 }; this.rel.set(id, r); }
    return r;
  }
}

export class Simulation {
  constructor({ seed = 20261103, hoursPerSecond = 1, maxPopulation = 4000, restore = null, daySeconds = 360 } = {}) {
    this.daySeconds = daySeconds; this.dayClock = 0.27; // days elapsed on the life clock (0.27 = 06:30 on day 1)
    this.seed = seed; this.hps = hoursPerSecond; this.maxPop = maxPopulation;
    this.rand = mulberry32((seed ^ Date.now()) >>> 0);
    const t0 = Date.now();
    this.world = createWorld(seed);
    console.log(`[world] generated in ${Date.now() - t0} ms, ${this.world.rivers.length} rivers`);
    this.time = 6;            // world hours since creation (start at dawn, day 1, spring, year 1)
    this.realTime = 0;
    this.people = []; this.byId = new Map(); this.kingdoms = new Map();
    this.events = []; this.eventSeq = 0; this.fx = []; this.ruins = [];
    this.food = new Float32Array(N); this.cult = new Float32Array(N); this.minLeft = new Float32Array(N);
    this.dynBias = new Float32Array(N); this.growMul = new Float32Array(N);
    this.owner = new Uint8Array(OWN * OWN);
    for (let c = 0; c < N; c++) {
      this.food[c] = this.world.fert[c] * 10; this.minLeft[c] = this.world.minerals[c] * 40; this.dynBias[c] = 1;
    }
    this.spatial = new SpatialHash(WORLD_SIZE, 32);
    this.weather = new Weather(this);
    this.stats = { births: 0, deaths: 0, wars: 0, conquests: 0, kingdomsFounded: 0, peakPop: 0, maxGen: 1, causes: {} };
    this._sec = 0; this._landT = 0; this._biasT = 0; this.seconds = 0;
    this._wfx = {};
    this.landVersion = 0;
    this.capitalId = 0;
    this.talks = []; this.talkSeq = 0;
    this.secrets = []; this.secretSeq = 0; this.plots = []; this.ravens = []; this.usurp = null;
    this.viewers = 0; this.pairLines = new Map();
    if (restore) restore(this); else this.genesis();
  }

  // ---------------------------------------------------------------- setup
  genesis() {
    const r = this.rand;
    const a = this.findSite(-1800, 0, 0, 2200, []);
    const b = this.findSite(1800, 0, 0, 2200, [a]);
    for (const site of [a, b]) {
      const culture = new Culture(mulberry32((r() * 1e9) | 0));
      const k = this.createKingdom(site, culture, 0);
      const king = this.makePerson({ sex: 'M', kingdom: k.id, x: k.x + 3, z: k.z + 2, birth: this.time - (20 + r() * 4) * YEAR }, culture);
      const queen = this.makePerson({ sex: 'F', kingdom: k.id, x: k.x - 3, z: k.z + 2, birth: this.time - (18 + r() * 3) * YEAR }, culture);
      king.house = queen.house = k.dynasty;
      this.marry(king, queen, true);
      k.rulerId = king.id; king.role = ROLE.RULER; queen.role = ROLE.CONSORT; k.monarchs = 1;
      this.event('founding', `${this.title(king)} ${king.name} and Queen ${queen.name} of House ${k.dynasty} found the Kingdom of ${k.name}.`, { k: k.id, x: k.x, z: k.z });
      k.history.push(`Year 1: founded by King ${king.name} and Queen ${queen.name}.`);
      this.addHouse(k); this.addHouse(k);
    }
    this.updateKingdomStats(); this.computeTerritory();
  }

  findSite(cx, cz, minD, maxD, avoid) {
    const w = this.world, r = this.rand;
    let best = null, bs = -1e9;
    for (let k = 0; k < 900; k++) {
      const a = r() * Math.PI * 2, d = minD + Math.sqrt(r()) * (maxD - minD);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const c = w.cellIndex(x, z);
      if (c < 0 || w.gh[c] < 3 || w.gh[c] > 220 || w.river[c] || w.slope[c] > 0.22) continue;
      let f = 0, n = 0;
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
        const cc = c + dj * GRID + di; if (cc < 0 || cc >= N) continue;
        f += w.fert[cc]; n++;
      }
      f /= n;
      const rd = w.rdist[c];
      let s = f * 3 + (rd >= 1 && rd <= 4 ? 1.2 : rd <= 8 ? 0.4 : -0.6) - w.slope[c] * 3 + w.minerals[c] * 0.2;
      for (const o of avoid) { const dd = Math.hypot(o.x - x, o.z - z); if (dd < 2500) s -= (2500 - dd) / 400; }
      for (const o of this.kingdoms.values()) { const dd = Math.hypot(o.x - x, o.z - z); if (dd < 900) s -= (900 - dd) / 150; }
      if (s > bs) { bs = s; best = { x, z, score: s }; }
    }
    return best;
  }

  createKingdom(site, culture, parentId) {
    const used = new Set([...this.kingdoms.values()].map((k) => k.color));
    const color = PALETTE.find((c) => !used.has(c)) || `hsl(${Math.floor(this.rand() * 360)},65%,50%)`;
    const k = new Kingdom({ x: site.x, z: site.z, name: culture.realm(), color, founded: this.time, parentId, culture, dynasty: culture.house() });
    k.rot = Math.round(((k.id * 1.7) % (Math.PI * 2)) * 1000) / 1000;
    const c = this.world.cellIndex(k.x, k.z);
    k.hasWell = this.world.rdist[c] <= 6 || this.world.moist[c] > 0.55;
    this.kingdoms.set(k.id, k);
    this.stats.kingdomsFounded++;
    return k;
  }

  randGenes(r) {
    return { str: 0.75 + r() * 0.5, fert: 0.6 + r() * 0.6, aggr: r(), loyal: r(), ambit: r(), courage: r(), dilig: 0.3 + r() * 0.7, social: r(), intel: r() };
  }
  inherit(a, b) {
    const r = this.rand, g = {};
    for (const key of Object.keys(a)) {
      const m = (a[key] + b[key]) / 2 + (r() + r() + r() - 1.5) * 0.18;
      g[key] = key === 'str' ? clamp(m, 0.5, 1.6) : key === 'fert' ? clamp(m, 0.3, 1.4) : clamp(m, 0, 1);
    }
    return g;
  }

  makePerson(o, culture) {
    const p = new Person(o);
    if (!p.genes) p.genes = this.randGenes(this.rand);
    if (!p.name) p.name = culture.person(p.sex);
    p.loyalty = 0.45 + p.genes.loyal * 0.5;
    ensurePersona(p, this.rand);
    p.ageY = (this.time - p.birth) / YEAR + (p.boost || 0);
    this.people.push(p); this.byId.set(p.id, p);
    const k = this.kingdoms.get(p.kingdom); if (k) k.members.add(p.id);
    return p;
  }

  title(p) {
    const k = this.kingdoms.get(p.kingdom);
    if (!k) return '';
    if (p.id === k.rulerId) return p.sex === 'F' ? 'Queen' : 'King';
    if (p.role === ROLE.CONSORT) return p.sex === 'F' ? 'Queen' : 'Prince Consort';
    if (p.role === ROLE.ROYAL) return p.sex === 'F' ? 'Princess' : 'Prince';
    if (p.role === ROLE.GENERAL) return 'General';
    if (p.soldier) return 'Soldier';
    return '';
  }
  fullName(p) { const t = this.title(p); return (t ? t + ' ' : '') + p.name; }

  event(type, text, data = {}) {
    const cal = calendar(this.time);
    const e = { id: ++this.eventSeq, type, text, year: cal.year, day: cal.day, season: cal.seasonName, ...data };
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    return e;
  }

  placeName(x, z) {
    let best = null, bd = 1e9;
    for (const k of this.kingdoms.values()) { const d = Math.hypot(k.x - x, k.z - z); if (d < bd) { bd = d; best = k; } }
    if (best && bd < best.radius * 1.3) return ` over ${best.name}`;
    if (best && bd < 1800) return ` near ${best.name}`;
    const ns = z < -1300 ? 'northern' : z > 1300 ? 'southern' : 'central';
    const ew = x < -1300 ? 'western' : x > 1300 ? 'eastern' : '';
    return ` in the ${ns}${ew ? ' ' + ew : ''} wilds`;
  }

  // ---------------------------------------------------------------- main loop
  tick(dt) {
    this.realTime += dt;
    this.dayClock += dt / this.daySeconds;
    this.time += dt * this.hps;
    this.weather.update(dt);
    this._sec += dt;
    if (this._sec >= 1) { this._sec -= 1; this.perSecond(); }
    this.spatial.rebuild(this.people);
    const ppl = this.people;
    for (let i = 0; i < ppl.length; i++) if (ppl[i].alive) this.updatePerson(ppl[i], dt);
    this.separate();
    if (this._dead) { this.people = this.people.filter((p) => p.alive); this._dead = 0; }
    for (const k of this.kingdoms.values()) {
      k.thinkT -= dt;
      if (k.thinkT <= 0) { k.thinkT = 3 + this.rand() * 2; this.kingdomThink(k); }
      this.updateArmy(k, dt);
    }
  }

  perSecond() {
    this.seconds++;
    this.regrow();
    this.lifeCycle(1);
    this.updateKingdomStats();
    this.stormDamage();
    this.diseaseSpread();
    if (this.seconds % 4 === 0) { this.society(); this.captiveTick(); }
    if (this.seconds % 2 === 0) maybeTalk(this);
    if (this.seconds % 10 === 0) { tensionTick(this); diplomacyTick(this); }
    if (this.seconds % 15 === 7) plotTick(this);
    if (this.seconds % 60 === 30) socialTick(this);
    if (this.seconds % 200 === 100) storyteller(this);
    this._biasT += 1;
    if (this._biasT >= 20) { this._biasT = 0; this.updateBias(); }
    this._landT += 1;
    if (this._landT >= 5) { this._landT = 0; this.computeTerritory(); }
    const pop = this.people.length;
    if (pop > this.stats.peakPop) this.stats.peakPop = pop;
  }

  hour() { return (this.dayClock % 1) * 24; }
  isNight() { const h = this.hour(); return h < 5.5 || h >= 21; }
  secsPerHour() { return this.daySeconds / 24; }
  // has a worker run out of daylight to get home before 21:00?
  mustHeadHome(p, k) {
    const h = this.hour();
    if (h < 5.5 || h >= 21) return true;
    if (h < 12) return false;
    const left = (20.8 - h) * this.secsPerHour();
    const [hx, hz] = this.homeOf(p, k);
    return Math.hypot(hx - p.x, hz - p.z) / 2.2 + 12 > left;
  }
  relTension(a, b) { return a && b ? (a.relOf(b.id).tension || 0) : 0; }

  // ---------------------------------------------------------------- land & food
  updateBias() {
    // the world's fortune drifts: fertile zones slowly move over the decades
    const w = this.world, t = this.time / (YEAR * 25);
    for (let c = 0; c < N; c++) {
      if (w.gh[c] <= 0.4) continue;
      const nx = w.cellX(c % GRID) / HALF, nz = w.cellX((c / GRID) | 0) / HALF;
      this.dynBias[c] = clamp(0.55 + 0.9 * (w.noise.fbm(w.noise.nMoist, nx * 1.1 + t, nz * 1.1 - t * 0.6, 2) * 0.5 + 0.5), 0.35, 1.5);
    }
  }

  regrow() {
    const w = this.world, food = this.food, cult = this.cult, mul = this.growMul;
    mul.fill(1);
    for (const s of this.weather.storms) {
      let m = 1, destroy = 0;
      switch (s.type) {
        case 'rain': case 'thunderstorm': m = 1 + 0.5 * s.i; break;
        case 'drought': m = 1 - 0.88 * s.i; break;
        case 'heatwave': m = 1 - 0.5 * s.i; break;
        case 'snow': m = 1 - 0.8 * s.i; break;
        case 'blizzard': m = 0; destroy = 0.02 * s.i; break;
        case 'hurricane': m = 0.4; destroy = 0.07 * s.i; break;
        case 'tornado': m = 0; destroy = 0.5; break;
        case 'wildfire': m = 0; destroy = 1; break;
        case 'flood': m = 0.5; destroy = 0.1; break;
        default: continue;
      }
      const i0 = Math.max(0, Math.floor((s.x - s.r + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.floor((s.x + s.r + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((s.z - s.r + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.floor((s.z + s.r + HALF) / CELL));
      const r2 = s.r * s.r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = w.cellX(i) - s.x, dz = w.cellX(j) - s.z;
        if (dx * dx + dz * dz > r2) continue;
        const c = j * GRID + i;
        if (s.type === 'flood' && w.rdist[c] > 3) continue;
        mul[c] *= m;
        if (destroy) { food[c] *= 1 - destroy; if (s.type === 'wildfire') cult[c] *= 0.6; }
      }
    }
    const seas = seasonalOffset(calendar(this.time).yearFrac);
    for (let c = 0; c < N; c++) {
      const f = w.fert[c];
      if (f <= 0) continue;
      const t = w.temp[c] + seas;
      const g = t < 1 ? 0 : t < 10 ? (t - 1) / 9 : t > 31 ? 0.5 : 1;
      const cap = (3 + f * 12 * (1 + cult[c])) * 1.5;
      food[c] = Math.min(cap, food[c] + f * this.dynBias[c] * g * (1 + 1.6 * cult[c]) * 0.0048 * FIELD_GROWTH * mul[c]);
      if (t < -3) food[c] *= 0.997;            // frost spoils standing crops
      if (cult[c] > 0) cult[c] *= 0.9993;      // untended fields go wild
      if (this.minLeft[c] < w.minerals[c] * 40) this.minLeft[c] += w.minerals[c] * 0.004;
    }
  }

  computeTerritory() {
    const own = this.owner; own.fill(0);
    const score = new Float32Array(OWN * OWN);
    const ks = [...this.kingdoms.values()];
    this.ownerIds = ks.map((k) => k.id);
    ks.forEach((k, idx) => {
      const R = k.radius * 1.25;
      const i0 = Math.max(0, Math.floor((k.x - R + HALF) / OCELL)), i1 = Math.min(OWN - 1, Math.floor((k.x + R + HALF) / OCELL));
      const j0 = Math.max(0, Math.floor((k.z - R + HALF) / OCELL)), j1 = Math.min(OWN - 1, Math.floor((k.z + R + HALF) / OCELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + (i + 0.5) * OCELL, z = -HALF + (j + 0.5) * OCELL;
        if (!this.world.isLand(x, z)) continue;
        const d = Math.hypot(x - k.x, z - k.z);
        if (d > R) continue;
        const s = (1 - d / R) * Math.sqrt(k.pop + 4);
        const c = j * OWN + i;
        if (s > score[c]) { score[c] = s; own[c] = idx + 1; }
      }
    });
    this.landVersion++;
  }

  // ---------------------------------------------------------------- calendar-driven life
  lifeCycle(dtReal) {
    const dYears = dtReal * this.hps / YEAR, dDays = dtReal * this.hps / 24;
    const r = this.rand;
    const pop = this.people.length;
    const capF = pop > this.maxPop * 0.75 ? clamp(1 - (pop - this.maxPop * 0.75) / (this.maxPop * 0.25), 0, 1) : 1;
    for (const p of this.people) {
      if (!p.alive) continue;
      // children grow up faster than the calendar (GROWTH_RATE x) so generations turn over within real hours
      if (p.ageY < 16) p.boost = (p.boost || 0) + dYears * (GROWTH - 1);
      p.ageY = (this.time - p.birth) / YEAR + (p.boost || 0);
      const a = p.ageY;
      // natural mortality (Gompertz) + childhood illness
      let hz = 0.0003 * Math.exp(0.088 * a);
      if (a < 5) hz += 0.008 * (1.3 - p.nourish);
      if (r() < 1 - Math.exp(-hz * dYears)) { this.die(p, a > 50 ? 'died of old age' : 'died of illness'); continue; }
      // loyalty drift
      const k = this.kingdoms.get(p.kingdom);
      if (k) {
        const fpc = k.food / Math.max(1, k.pop);
        const target = 0.2 + 0.55 * p.genes.loyal + clamp(fpc / 8, 0, 0.25) + (k.capital ? 0.08 : 0) - (k.atWar ? 0.06 : 0);
        p.loyalty += (target - p.loyalty) * 0.01;
      }
      // pregnancy
      if (p.pregnant && p.pregnant.due - this.time > PREG_DAYS * 24 * 1.06) p.pregnant.due = this.time + PREG_DAYS * 24 * 0.6; // older, longer pregnancies catch up
      if (p.pregnant && this.time >= p.pregnant.due) this.giveBirth(p);
      else if (p.sex === 'F' && !p.pregnant && p.spouseId && a >= 16 && a <= 45 && this.time - p.lastBirth > BIRTH_GAP_DAYS * 24) {
        const h = this.byId.get(p.spouseId);
        if (h && h.alive && h.ageY < 70 && Math.abs(h.x - p.x) < 900 && Math.abs(h.z - p.z) < 900 && !h.soldier && p.health > 40) {
          const fpc = k ? k.food / Math.max(1, k.pop) : 0;
          const inBed = p.task?.type === 'sleep' && p.task.phase === 1 && h.task?.type === 'sleep' && h.task.phase === 1 && Math.hypot(p.x - h.x, p.z - h.z) < 4;
          const love = 0.75 + Math.max(0, opOf(p, h)) / 120;
          const fert = Math.sqrt(p.genes.fert * h.genes.fert) * Math.min(1, p.nourish * 1.2) * (fpc > 1 ? 1 : 0.45) * capF * (a > 38 ? 0.55 : 1) * love;
          // a night together: ~35% chance per night for a healthy, well-fed couple (per real second in bed)
          const perSec = (inBed ? 0.0034 : 0.0004) * fert * FERTILITY;
          if (r() < perSec * dtReal) {
            let father = h.id;
            const lover = this.byId.get(p.affair);
            if (lover && r() < 0.3) { father = lover.id; this.secrets.push({ id: ++this.secretSeq, type: 'bastard', a: p.id, b: lover.id, t: this.realTime }); }
            p.pregnant = { due: this.time + PREG_DAYS * (0.95 + r() * 0.1) * 24, father };
            p.thought = 'Expecting a child';
          }
        }
      }
    }
  }

  giveBirth(m) {
    const r = this.rand, k = this.kingdoms.get(m.kingdom);
    const f = this.byId.get(m.pregnant.father);
    const twins = r() < TWINS ? 2 : 1;
    m.lastBirth = this.time; m.pregnant = null;
    for (let t = 0; t < twins; t++) {
      if (r() < 0.06 * (1.4 - m.nourish)) { this.stats.deaths++; this.cause('was stillborn'); continue; }
      const culture = k ? k.culture : new Culture(r);
      const fg = f ? f.genes : this.randGenes(r);
      const child = this.makePerson({
        sex: r() < 0.5 ? 'M' : 'F', kingdom: m.kingdom, x: m.x + (r() - 0.5) * 2, z: m.z + (r() - 0.5) * 2, birth: this.time,
        fatherId: f ? f.id : 0, motherId: m.id, genes: this.inherit(m.genes, fg), gen: Math.max(m.gen, f ? f.gen : 1) + 1,
        satiety: 1, hydration: 1, health: 100, nourish: m.nourish, house: f ? f.house : m.house,
      }, culture);
      m.children.push(child.id); if (f) f.children.push(child.id);
      this.stats.births++;
      if (child.gen > this.stats.maxGen) this.stats.maxGen = child.gen;
      if (k && (m.id === k.rulerId || (f && f.id === k.rulerId) || m.role === ROLE.CONSORT)) {
        child.role = ROLE.ROYAL;
        const ruler = this.byId.get(k.rulerId);
        this.event('royal_birth', `A ${child.sex === 'F' ? 'princess' : 'prince'}, ${child.name}, is born to ${ruler ? this.fullName(ruler) : 'the crown'} of ${k.name}.`, { k: k.id, pid: child.id, x: m.x, z: m.z });
        k.history.push(`Year ${calendar(this.time).year}: ${child.sex === 'F' ? 'Princess' : 'Prince'} ${child.name} born.`);
      } else {
        this.event('birth', `${child.name} is born to ${m.name}${f ? ' and ' + f.name : ''} in ${k ? k.name : 'the wilds'}.`, { k: m.kingdom, pid: child.id, minor: true });
      }
    }
    if (r() < 0.012 * (1.5 - m.nourish)) this.die(m, 'died in childbirth');
  }

  cause(c) { this.stats.causes[c] = (this.stats.causes[c] || 0) + 1; }

  die(p, cause) {
    if (!p.alive) return;
    p.alive = false; p.deathCause = cause; this._dead = (this._dead || 0) + 1;
    this.stats.deaths++; this.cause(cause.startsWith('was slain') ? 'slain in battle' : cause.startsWith('was executed') ? 'executed' : cause);
    this.byId.delete(p.id);
    const k = this.kingdoms.get(p.kingdom);
    if (k) { k.members.delete(p.id); k.deaths++; }
    if (p.spouseId) { const s = this.byId.get(p.spouseId); if (s) s.spouseId = 0; }
    this.fx.push({ kind: 'death', x: Math.round(p.x), z: Math.round(p.z) });
    try { onDeath(this, p, this.byId.get(p.lastKiller) || null); } catch (e) { console.warn('onDeath', e.message); }
    if (k && (p.id === k.rulerId || p.role === ROLE.CONSORT || p.role === ROLE.GENERAL)) {
      this.event('royal_death', `${this.fullName(p)} of ${k.name} ${cause} at age ${Math.floor(p.ageY)}.`, { k: k.id, x: p.x, z: p.z });
      k.history.push(`Year ${calendar(this.time).year}: ${this.fullName(p)} ${cause}.`);
      if (p.id === k.rulerId) this.succession(k, p);
    } else if (p.role === ROLE.ROYAL && k) {
      this.event('death', `${this.fullName(p)} of ${k.name} ${cause}.`, { k: k.id, x: p.x, z: p.z });
    } else {
      this.event('death', `${p.name} of ${k ? k.name : 'the wilds'} ${cause}, aged ${Math.floor(p.ageY)}.`, { k: p.kingdom, minor: true });
    }
    if (k && k.members.size === 0) this.removeKingdom(k, `The last of ${k.name} has perished. The kingdom is no more.`);
  }

  marry(a, b, silent) {
    a.spouseId = b.id; b.spouseId = a.id;
    if (a.ops && b.ops) { a.ops[b.id] = Math.max(a.ops[b.id] || 0, 45); b.ops[a.id] = Math.max(b.ops[a.id] || 0, 45); } // newlyweds love each other
    const husband = a.sex === 'M' ? a : b, wife = a.sex === 'M' ? b : a;
    if (wife.kingdom !== husband.kingdom) this.transfer(wife, husband.kingdom);
    const k = this.kingdoms.get(husband.kingdom);
    if (k && (k.rulerId === a.id || k.rulerId === b.id)) {
      const consort = k.rulerId === a.id ? b : a; consort.role = ROLE.CONSORT;
      if (!silent) {
        this.event('royal_wedding', `${this.fullName(this.byId.get(k.rulerId))} of ${k.name} weds ${consort.name}.`, { k: k.id, x: a.x, z: a.z });
        k.history.push(`Year ${calendar(this.time).year}: royal wedding to ${consort.name}.`);
      }
    } else if (!silent && (a.role === ROLE.ROYAL || b.role === ROLE.ROYAL)) {
      this.event('wedding', `${this.fullName(a)} marries ${this.fullName(b)}.`, { k: a.kingdom, x: a.x, z: a.z });
    } else if (!silent) {
      this.event('wedding', `${a.name} and ${b.name} are married in ${k ? k.name : 'the wilds'}.`, { k: a.kingdom, minor: true });
    }
  }

  transfer(p, kid) {
    const old = this.kingdoms.get(p.kingdom);
    if (old) { old.members.delete(p.id); if (old.rulerId === p.id) old.rulerId = 0; }
    p.kingdom = kid;
    const k = this.kingdoms.get(kid);
    if (k) k.members.add(p.id);
    if (p.role !== ROLE.RULER) p.role = ROLE.COMMONER;
    p.soldier = false;
    if (old && old.members.size === 0) this.removeKingdom(old, `${old.name} has dissolved; its last people joined ${k ? k.name : 'others'}.`);
  }

  succession(k, dead) {
    const r = this.rand;
    const alive = (id) => { const q = this.byId.get(id); return q && q.alive && q.kingdom === k.id ? q : null; };
    let heir = null;
    const kids = dead.children.map(alive).filter(Boolean).sort((a, b) => b.ageY - a.ageY);
    heir = kids.find((c) => c.ageY >= 16) || null;
    if (this.usurp && this.usurp.k === k.id) { const u = alive(this.usurp.by); this.usurp = null; if (u) { heir = u; u.house = k.culture.house(); k.dynasty = u.house; } }
    let consort = alive(dead.spouseId);
    if (!heir && consort && consort.ageY >= 16) heir = consort;
    if (!heir && kids.length) heir = kids[0];
    if (!heir) {
      const cands = [...k.members].map((id) => this.byId.get(id)).filter((q) => q && q.ageY >= 18 && q.ageY < 65);
      cands.sort((a, b) => (b.genes.ambit + this.strength(b)) - (a.genes.ambit + this.strength(a)));
      heir = cands[0] || null;
      if (heir) {
        heir.house = k.culture.house();
        k.dynasty = heir.house;
        this.event('dynasty', `With no heir, ${heir.name} seizes the throne of ${k.name}, founding House ${heir.house}.`, { k: k.id, x: k.x, z: k.z });
      }
    }
    // demote old roles
    for (const id of k.members) { const q = this.byId.get(id); if (q && (q.role === ROLE.CONSORT || q.role === ROLE.ROYAL) && q !== heir) q.role = ROLE.COMMONER; }
    if (!heir) { k.rulerId = 0; return; }
    k.rulerId = heir.id; heir.role = ROLE.RULER; heir.soldier = false; k.monarchs++;
    inheritGrudges(this, dead, heir);
    const sp = alive(heir.spouseId); if (sp) sp.role = ROLE.CONSORT;
    for (const cid of heir.children) { const c = alive(cid); if (c) c.role = ROLE.ROYAL; }
    this.event('coronation', `${this.fullName(heir)} is crowned ruler of ${k.name}${heir.ageY < 16 ? ` at only ${Math.floor(heir.ageY)} years old` : ''}.`, { k: k.id, pid: heir.id, x: k.x, z: k.z });
    k.history.push(`Year ${calendar(this.time).year}: ${this.fullName(heir)} crowned.`);
    // a weak or child ruler invites rebellion
    if (heir.ageY < 16) for (const id of k.members) { const q = this.byId.get(id); if (q) q.loyalty -= 0.15 * r(); }
  }

  // ---------------------------------------------------------------- society: marriage, migration
  society() {
    const r = this.rand;
    if (this.people.length === 0) {
      this.event('age', 'The old world is silent. From beyond the sea, new families arrive and a new age begins.', {});
      this.genesis(); return;
    }
    // settler families: small, fed kingdoms draw wandering families from the wilds (couples with children),
    // so young realms fill up, raise armies and come to blows within hours instead of days
    for (const k of this.kingdoms.values()) {
      if (k.pop >= SETTLER_POP || this.realTime - (k.lastSettlers ?? -SETTLER_SECS * 0.5) < SETTLER_SECS) continue;
      if (k.food / Math.max(1, k.pop) < 4) continue;
      k.lastSettlers = this.realTime;
      const a = r() * 6.283;
      let x = k.x + Math.cos(a) * 260, z = k.z + Math.sin(a) * 260;
      if (!this.world.isLand(x, z)) { x = k.x + Math.cos(a) * 90; z = k.z + Math.sin(a) * 90; }
      const cul = new Culture(mulberry32((r() * 1e9) | 0)), house = cul.house();
      const age1 = 18 + r() * 12, age2 = age1 + (r() - 0.4) * 8;
      const man = this.makePerson({ sex: 'M', kingdom: k.id, x, z, birth: this.time - age1 * YEAR, nourish: 0.7 }, cul);
      const wife = this.makePerson({ sex: 'F', kingdom: k.id, x: x + 1, z, birth: this.time - Math.max(17, age2) * YEAR, nourish: 0.7 }, cul);
      const fam = [man, wife];
      this.marry(man, wife, true);
      const nk = r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2;
      for (let i = 0; i < nk; i++) {
        const c = this.makePerson({ sex: r() < 0.5 ? 'M' : 'F', kingdom: k.id, x: x + 2 + i, z: z + 1, birth: this.time - (3 + r() * 9) * YEAR, nourish: 0.65, motherId: wife.id, fatherId: man.id, gen: 2 }, cul);
        man.children.push(c.id); wife.children.push(c.id); fam.push(c);
      }
      k.food += fam.length * 25; // they bring their own grain and livestock
      for (const q of fam) { q.house = house; q.task = { type: 'migrate', dest: k.id, t: 0, phase: 0 }; q.thought = `Settling in ${k.name} with the family`; }
      this.event('settlers', `A family of settlers, House ${house} — ${man.name}, ${wife.name}${nk ? ` and ${nk} child${nk > 1 ? 'ren' : ''}` : ''} — comes out of the wilds to make a home in ${k.name}.`, { k: k.id, pid: man.id, x, z });
    }
    // travellers from beyond the sea occasionally settle where people are lonely
    for (const k of this.kingdoms.values()) {
      const lonely = [...k.members].map((id) => this.byId.get(id)).find((p) => p && p.lonely >= 3 && !p.spouseId && p.ageY < 40);
      if (!lonely || r() > 0.04) continue;
      const a = r() * 6.283;
      let x = k.x + Math.cos(a) * 600, z = k.z + Math.sin(a) * 600;
      if (!this.world.isLand(x, z)) { x = k.x + Math.cos(a) * 200; z = k.z + Math.sin(a) * 200; }
      const sex = lonely.sex === 'M' ? 'F' : 'M';
      const s = this.makePerson({ sex, kingdom: k.id, x, z, birth: this.time - (lonely.ageY + (r() - 0.5) * 6) * YEAR, nourish: 0.6 }, new Culture(mulberry32((r() * 1e9) | 0)));
      s.house = 'the Wanderers';
      s.task = { type: 'migrate', dest: k.id, t: 0, phase: 0 }; s.thought = `A traveller seeking a new home in ${k.name}`;
      lonely.lonely = 0;
      this.event('stranger', `A traveller from beyond the sea, ${s.name}, arrives in ${k.name}.`, { k: k.id, pid: s.id, x, z, minor: true });
    }
    for (const p of this.people) {
      if (!p.alive || p.spouseId || p.ageY < 16 || p.ageY > 55 || p.task?.type === 'court') continue;
      if (r() > 0.05 * (0.4 + p.genes.social)) continue;
      const k = this.kingdoms.get(p.kingdom); if (!k) continue;
      // ensure someone eventually courts
      if (k.atWar && p.soldier) continue;
      this.startTask(p, k, 'court');
    }
  }

  diseaseSpread() {
    const r = this.rand;
    for (const p of this.people) {
      if (!p.alive || p.sick <= 0) continue;
      this.spatial.query(p.x, p.z, 6, (q) => {
        if (q !== p && q.sick <= 0 && !q.immune && r() < 0.06 * (1.3 - q.nourish)) q.sick = 40 + r() * 40;
      });
      if (p.sick - 1 <= 0) p.immune = true;
    }
  }

  stormDamage() {
    const r = this.rand;
    const lost = new Map();
    for (const s of this.weather.storms) {
      let base = 0;
      if (s.type === 'hurricane') base = 0.025; else if (s.type === 'tornado') base = 0.5; else if (s.type === 'windstorm') base = 0.003;
      else if (s.type === 'wildfire') base = 0.12; else if (s.type === 'flood') base = 0.06; else continue;
      for (const k of this.kingdoms.values()) {
        if (Math.hypot(k.x - s.x, k.z - s.z) > s.r + k.radius) continue;
        for (let h = k.houses.length - 1; h >= 0; h--) {
          const [hx, hz] = k.houses[h];
          const d = Math.hypot(hx - s.x, hz - s.z);
          if (d > s.r) continue;
          if (s.type === 'flood') { const c = this.world.cellIndex(hx, hz); if (this.world.rdist[c] > 3) continue; }
          let p = base * s.i;
          if (s.type === 'hurricane') { const rn = d / s.r; p *= Math.exp(-((rn - 0.3) ** 2) / 0.05) * 2; }
          if (r() < p) {
            k.houses.splice(h, 1); k.housesVer++;
            this.fx.push({ kind: 'house', x: Math.round(hx), z: Math.round(hz), storm: s.type });
            const key = s.id + ':' + k.id;
            lost.set(key, { n: (lost.get(key)?.n || 0) + 1, s, k });
          }
        }
      }
    }
    for (const { n, s, k } of lost.values()) {
      this.event('disaster', `The ${s.type} destroyed ${n} home${n > 1 ? 's' : ''} in ${k.name}.`, { k: k.id, x: s.x, z: s.z, minor: n < 2 });
    }
  }

  lightning(x, z) {
    const r = this.rand;
    this.spatial.query(x, z, 5, (p) => { if (r() < 0.55) this.die(p, 'was struck by lightning'); });
    const c = this.world.cellIndex(x, z);
    if (c >= 0 && this.world.forest[c] > 0.4 && r() < 0.005 && this.weather.tempAt(x, z) > 14 && this.weather.storms.length < 24) this.weather.spawn('wildfire', x, z);
  }

  // ---------------------------------------------------------------- per-person update
  strength(p) {
    const a = p.ageY;
    const af = a < 14 ? 0.25 : a < 18 ? 0.75 : a < 36 ? 1 : a < 50 ? 0.88 : a < 65 ? 0.65 : 0.4;
    const k = this.kingdoms.get(p.kingdom);
    const weapon = p.soldier && k ? 1 + 0.25 * k.weaponLevel : 1;
    return p.genes.str * (p.sex === 'F' ? 0.85 : 1) * af * (0.4 + 0.6 * p.nourish) * (0.35 + 0.65 * p.health / 100) * weapon;
  }

  homeOf(p, k) {
    if (p.id === k.rulerId || p.role === ROLE.CONSORT) { const z = [0, 12, 18, 22, 32][k.tier]; return k.local(((p.id % 5) - 2) * 1.2, z); }
    if (!k.houses.length) return [k.x + ((p.id * 7) % 20) - 10, k.z + ((p.id * 13) % 20) - 10];
    let key = p.spouseId ? Math.min(p.id, p.spouseId) : p.id;
    if (p.ageY < 16 && !p.spouseId) { const m = this.byId.get(p.motherId) || this.byId.get(p.fatherId); if (m && m.kingdom === p.kingdom) key = m.spouseId ? Math.min(m.id, m.spouseId) : m.id; }
    const h = k.houses[key % k.houses.length];
    return [h[0] + ((p.id * 5) % 7) - 3, h[1] + ((p.id * 11) % 7) - 3];
  }

  // where someone sleeps: a real bed inside their family's house (rulers sleep in the keep)
  bedOf(p, k) {
    // everyone, royals included, sleeps in a real bed inside a house (the royal family shares the first house)
    if (!k.houses.length) return [...this.homeOf(p, k), 0];
    let key = p.spouseId ? Math.min(p.id, p.spouseId) : p.id, child = false;
    if (p.ageY < 16 && !p.spouseId) { const m = this.byId.get(p.motherId) || this.byId.get(p.fatherId); if (m && m.kingdom === p.kingdom) { key = m.spouseId ? Math.min(m.id, m.spouseId) : m.id; child = true; } }
    const royal = (q) => q && (q.id === k.rulerId || q.role === ROLE.CONSORT);
    const kin = child ? this.byId.get(p.motherId) || this.byId.get(p.fatherId) : p;
    const h = royal(kin) || royal(p) ? k.houses[0] : k.houses[key % k.houses.length];
    const hash = Math.abs(Math.sin(h[0] * 12.9898 + h[1] * 78.233) * 43758.5453) % 1;
    const sx = 0.85 + hash * 0.45, sz = 0.85 + ((hash * 7) % 1) * 0.4;
    let lx, lz;
    if (child) { const slot = p.id % 3; lx = 1.75; lz = -1.3 + slot * 1.1; }
    else { lx = -1.55; lz = -0.55 + (p.sex === 'F' ? 0.38 : -0.38); }
    const th = (h[2] || 0) + Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
    lx *= sx; lz *= sz;
    return [h[0] + lx * c + lz * sn, h[1] - lx * sn + lz * c, th];
  }

  updatePerson(p, dt) {
    let k = this.kingdoms.get(p.kingdom);
    if (!k) { // stranded: join the nearest kingdom
      let best = null, bd = 1e9;
      for (const o of this.kingdoms.values()) { const d = dist(o, p); if (d < bd) { bd = d; best = o; } }
      if (!best) { this.die(p, 'perished alone'); return; }
      this.transfer(p, best.id); k = best;
    }
    const e = this.weather.effectOn(p, dt, this._wfx);
    const child = p.ageY < 14;
    // ---- needs (real-time)
    const asleep = p.task?.type === 'sleep' && p.task.phase === 1;
    p.satiety -= dt / (child ? 330 : 270) * (asleep ? 0.45 : 1);
    p.hydration -= (dt / 300) * e.thirst * (asleep ? 0.45 : 1);
    if (p.state === STATE.REST) p.energy = Math.min(1, p.energy + dt / 40);
    else p.energy -= dt / (p.state === STATE.FIGHT || p.state === STATE.MARCH ? 260 : 480);
    if (p.energy < 0) p.energy = 0;
    let dmg = 0, cause = '';
    if (p.satiety <= 0) { p.satiety = 0; dmg += dt * 0.32; cause = 'starved to death'; }
    if (p.hydration <= 0) { p.hydration = 0; dmg += dt * 0.6; cause = 'died of thirst'; }
    if (e.cold > 0) {
      const home = Math.hypot(p.x - k.x, p.z - k.z) < k.radius * 0.35;
      if (!home || p.state !== STATE.REST) { dmg += e.cold * dt * (0.3 + (p.ageY < 6 || p.ageY > 60 ? 0.3 : 0)); cause = e.cause || 'froze to death'; }
    }
    if (e.dmg > 0) { dmg += e.dmg * (p.state === STATE.REST ? 0.5 : 1); cause = e.cause; }
    if (e.dx || e.dz) {
      p.x += e.dx; p.z += e.dz; p.pushed = 1;
      if (!this.world.isLand(p.x, p.z)) { dmg += dt * 25; cause = cause || 'drowned at sea'; }
    }
    if (p.sick > 0) { p.sick -= dt; dmg += dt * 0.42 * (1.3 - p.nourish); cause = 'died of plague'; }
    if (dmg > 0) { p.health -= dmg; p.lastCause = cause; }
    else if (p.satiety > 0.25 && p.hydration > 0.25) p.health = Math.min(100, p.health + dt * 0.2 * (0.4 + p.nourish));
    p.nourish += (Math.min(1, p.satiety * 1.5) * 0.6 + Math.min(1, p.hydration * 1.5) * 0.4 - p.nourish) * dt / 220;
    if (p.health <= 0) { this.die(p, p.lastCause || 'died'); return; }

    // ---- toddlers (1-3) wander on their own little legs, staying near their mother
    if (p.ageY >= 1 && p.ageY < 3) {
      const m = this.byId.get(p.motherId), ma = m && m.alive;
      if (ma && m.task?.type === 'sleep' && m.task.phase === 1) { // tucked into the family bed
        const [bx, bz, br] = this.bedOf(p, k); p.x = bx; p.z = bz; p.heading = br; p.state = STATE.REST; p.indoors = true;
        p.task = { type: 'sleep', phase: 1, t: 0 }; p.thought = 'Asleep'; return;
      }
      if (p.task?.type === 'sleep') p.task = null;
      p.indoors = false;
      const ax = ma ? m.x : k.x, az = ma ? m.z : k.z;
      const far = Math.hypot(ax - p.x, az - p.z);
      if (!p.toddle || far > 14 || (p.toddleT = (p.toddleT || 0) - dt) < 0) {
        const a = this.rand() * 6.283, d = 1.5 + this.rand() * 5;
        p.toddle = [ax + Math.cos(a) * d, az + Math.sin(a) * d]; p.toddleT = 3 + this.rand() * 6;
      }
      const moving = !this.moveTo(p, p.toddle[0], p.toddle[1], far > 14 ? 1.6 : 0.8, dt);
      p.state = moving ? STATE.WALK : STATE.IDLE;
      if (p.satiety < 0.5 && k.food >= 0.3) { k.food -= 0.3; p.satiety = 1; }
      if (ma) p.hydration = Math.max(p.hydration, m.hydration); else if (p.hydration < 0.5 && k.hasWell) p.hydration = 1;
      p.thought = ma ? `Toddling about near ${m.name}` : 'A little orphan, looked after by the village';
      return;
    }
    // ---- babies are carried by their mothers, and sleep beside her in bed
    if (p.ageY < 1) {
      const m = this.byId.get(p.motherId);
      if (m && m.alive && m.task?.type === 'sleep' && m.task.phase === 1) {
        const th = m.task.rot || m.heading || 0;
        p.x = m.x + Math.sin(th) * 0.35; p.z = m.z + Math.cos(th) * 0.35; p.heading = th; p.state = STATE.REST; p.indoors = true;
        p.task = { type: 'sleep', phase: 1, t: 0, rot: th }; p.thought = 'Asleep beside mother'; return;
      }
      if (p.task?.type === 'sleep') { p.task = null; p.indoors = false; }
      // held against the mother's chest, facing the way she faces
      const mh = m && m.alive ? m.heading || 0 : 0;
      const hx = m && m.alive ? m.x + Math.sin(mh) * 0.28 : k.x, hz = m && m.alive ? m.z + Math.cos(mh) * 0.28 : k.z;
      p.x = hx; p.z = hz; p.heading = mh;
      p.state = m && m.alive ? (m.state === STATE.REST ? STATE.REST : STATE.WALK) : STATE.IDLE;
      if (p.satiety < 0.5 && k.food >= 0.3 && (!m || Math.hypot(hx - k.x, hz - k.z) < k.radius + 100)) { k.food -= 0.3; p.satiety = 1; }
      if (m && m.alive) p.hydration = Math.max(p.hydration, m.hydration); else if (p.hydration < 0.5 && k.hasWell) p.hydration = 1;
      p.thought = m && m.alive ? `In ${m.name}'s arms` : 'An orphan in the care of the realm';
      return;
    }

    // ---- anyone passing the well at home drinks
    if (p.hydration < 0.9 && k.hasWell && Math.abs(p.x - k.x) < 30 && Math.abs(p.z - k.z) < 30 && !this.inDroughtCached(k)) p.hydration = 1;
    // ---- travellers drink when they cross a river and forage along the way
    if (p.hydration < 0.55 || p.satiety < 0.3) {
      const c = this.world.cellIndex(p.x, p.z);
      if (c >= 0) {
        if (p.hydration < 0.55 && this.world.rdist[c] <= 1) p.hydration = 1;
        if (p.satiety < 0.3 && p.task?.type !== 'eat' && this.food[c] > 2 && Math.hypot(p.x - k.x, p.z - k.z) > k.radius) { this.food[c] -= 1; p.satiety += 0.55; }
      }
    }
    // ---- danger interrupts & combat awareness
    p.scanT -= dt;
    if (p.scanT <= 0) {
      p.scanT = 0.4 + this.rand() * 0.4;
      if (e.danger > 0.5 && p.task?.type !== 'flee' && this.rand() < 1.2 - p.genes.courage * 0.6) this.startTask(p, k, 'flee', e.from);
      else if (k.atWar) this.combatScan(p, k);
    }
    p.thinkT -= dt;
    if (p.thinkT <= 0 || !p.task) this.think(p, k, e);
    this.act(p, k, dt, e);
  }

  // bodies are solid: anyone standing closer than shoulder-width is pushed apart (sleepers and carried babies excepted)
  separate() {
    const R = 0.62;
    const loose = (p) => !p.alive || p.ageY < 1 || (p.task?.type === 'sleep' && p.task.phase === 1) || (p.task?.type === 'throne' && p.task.phase === 1);
    for (const p of this.people) {
      if (loose(p)) continue;
      this.spatial.query(p.x, p.z, R, (q) => {
        if (q === p || q.id < p.id || loose(q)) return;
        let dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
        if (d >= R) return;
        if (d < 1e-4) { const a = (p.id * 2.399) % 6.283; dx = Math.cos(a); dz = Math.sin(a); d = 1; } else { dx /= d; dz /= d; }
        const push = (R - Math.min(d, R)) * 0.5;
        const nx = p.x + dx * push, nz = p.z + dz * push, mx = q.x - dx * push, mz = q.z - dz * push;
        if (this.walkable(nx, nz)) { p.x = nx; p.z = nz; }
        if (this.walkable(mx, mz)) { q.x = mx; q.z = mz; }
      });
    }
  }

  capture(p, q) {
    const pk = this.kingdoms.get(p.kingdom), qk = this.kingdoms.get(q.kingdom);
    if (!pk) return;
    q.health = Math.max(q.health, 12);
    q.soldier = false; if (q.role === ROLE.SOLDIER || q.role === ROLE.GENERAL) q.role = ROLE.COMMONER;
    if (qk) { qk.soldiers = Math.max(0, (qk.soldiers || 0) - 1); qk.relOf(pk.id).captured = (qk.relOf(pk.id).captured || 0) + 1; }
    this.transfer(q, pk.id);
    q.captive = { from: qk ? qk.id : 0, fromName: qk ? qk.name : 'the wilds', by: p.id, until: this.realTime + 900 };
    q.loyalty = 0.08;
    q.task = { type: 'captive', by: p.id, t: 0 }; q.thinkT = 999;
    q.thought = `Taken captive by ${p.name} of ${pk.name}`;
    p.task = null; p.thinkT = 0;
    if (q.ops && p.ops) { q.ops[p.id] = -60; }
    this.stats.captives = (this.stats.captives || 0) + 1;
    this.event('captive', `${this.fullName(q)} of ${q.captive.fromName} throws down ${q.sex === 'F' ? 'her' : 'his'} sword and is taken captive by ${p.name} of ${pk.name}.`, { k: pk.id, k2: qk?.id, x: q.x, z: q.z, pid: q.id });
  }
  // captives: dragged home behind their captors; later they escape, are ransomed by fate, or swear fealty
  captiveTick() {
    for (const q of this.people) {
      if (!q.alive || !q.captive) continue;
      const c = q.captive, home = this.kingdoms.get(c.from);
      if (home && this.rand() < 0.0025 * (0.5 + q.genes.courage)) {
        this.transfer(q, home.id); q.captive = null; q.task = null; q.thinkT = 0; q.loyalty = 0.8;
        this.event('escape', `${this.fullName(q)} escapes captivity and flees home to ${home.name}!`, { k: home.id, x: q.x, z: q.z, pid: q.id });
      } else if (this.realTime > c.until) {
        q.captive = null; q.loyalty = 0.45; if (q.task?.type === 'captive') q.task = null;
        const k = this.kingdoms.get(q.kingdom);
        this.event('fealty', `After long captivity, ${this.fullName(q)} kneels and swears fealty to ${k ? k.name : 'their captors'}.`, { k: q.kingdom, pid: q.id, minor: !k });
      }
    }
  }

  isCombatant(q) {
    if (q.captive) return false;
    return q.soldier || q.task?.type === 'defend' || q.task?.type === 'fight' || (q.sex === 'M' && q.ageY >= 16 && q.ageY < 60);
  }
  atWar(a, b) {
    if (a === b) return false;
    const k = this.kingdoms.get(a); if (!k) return false;
    const r = k.rel.get(b); return !!r && r.state === 'war';
  }

  combatScan(p, k, reach) {
    if (p.ageY < 14 || p.task?.type === 'fight' || p.captive) return;
    let foe = null, fd = 1e9;
    const R = reach || (p.soldier || p.task?.type === 'defend' ? 32 : 18);
    this.spatial.query(p.x, p.z, R, (q, d2) => {
      if (q.kingdom === p.kingdom || q.ageY < 14 || q.captive || !this.atWar(p.kingdom, q.kingdom)) return;
      if (!this.isCombatant(q) && !(p.soldier && q.sex === 'M')) return;
      if (d2 < fd) { fd = d2; foe = q; }
    });
    if (!foe) return;
    const brave = p.soldier || p.task?.type === 'defend' || (p.sex === 'M' && p.ageY >= 16 && p.ageY < 60 && p.genes.courage > 0.35);
    if (brave && p.health > 25) { p.task = { type: 'fight', target: foe.id, t: 0 }; p.thought = `Fighting ${foe.name} of ${this.kingdoms.get(foe.kingdom)?.name}`; }
    else this.startTask(p, k, 'flee', foe);
  }

  think(p, k, e) {
    const r = this.rand, g = p.genes, age = p.ageY;
    p.thinkT = 2.5 + r() * 3;
    const critical = p.satiety < 0.2 || p.hydration < 0.2;
    const tt = p.task?.type;
    if (tt === 'fight' || tt === 'brawl' || tt === 'vendetta' || tt === 'captive' || (tt === 'flee' && p.task.t < 8)) return;
    // daily rhythm: home by dusk, asleep in bed at night (soldiers on campaign excepted)
    const onDuty = (p.soldier && k.army.state !== 'none') || tt === 'defend' || tt === 'migrate' || k.defense;
    if (!onDuty) {
      if (tt === 'sleep' && !(p.satiety < 0.12 || p.hydration < 0.12)) return;
      const bedtime = this.isNight() || (this.mustHeadHome(p, k) && p.carry < 0.5 && p.carryMin < 0.5 && tt !== 'farm' && tt !== 'mine');
      if (bedtime && !critical && tt !== 'eat' && tt !== 'drink') { this.startTask(p, k, 'sleep'); return; }
    }
    if (tt === 'drink' || (tt === 'eat' && p.hydration > 0.2)) return;
    if (tt === 'talk' && !critical && p.task.until > this.realTime && e.danger < 0.4) return;
    // people finish what they start, unless survival demands otherwise
    if (!critical && (tt === 'throne' || tt === 'farm' || tt === 'mine' || tt === 'build' || tt === 'migrate' || tt === 'court' || tt === 'march' || tt === 'defend')) return;
    if (!critical && tt === 'rest' && p.energy < 0.9) return;
    if (tt === 'migrate' && p.satiety > 0.12 && p.hydration > 0.25) return;
    const night = this.isNight();
    const late = this.hour() > 16.5 || this.hour() < 6.3; // no new field work late in the day
    let best = 'wander', bs = -1e9;
    const opt = (name, s) => { s += (r() - 0.5) * 0.45; if (s > bs) { bs = s; best = name; } };
    const fpc = k.food / Math.max(1, k.pop);
    opt('drink', (1 - p.hydration) ** 2 * 4.5 + (p.hydration < 0.4 ? 2.5 : 0));
    opt('eat', (1 - p.satiety) ** 2 * 4.5 + (p.satiety < 0.3 ? 2.5 : 0));
    if (e.danger > 0.25) opt('flee', e.danger * (2.2 - g.courage) * 1.5);
    opt('rest', (1 - p.energy) * 2.4 + (night ? 0.7 : 0) + (p.sick > 0 ? 1.5 : 0) + (age > 70 ? 0.4 : 0) - 0.4);
    if (age < 14) {
      opt('play', 1.0);
      if (age >= 10 && !late) opt('farm', 0.45 + g.dilig * 0.4);
    } else {
      const campaign = k.army.state !== 'none';
      if (p.soldier && campaign) opt('march', 1.7 + g.loyal * 1.2 + (k.army.state === 'defend' ? 1 : 0));
      if (k.defense && age < 62 && !p.pregnant) opt('defend', 0.9 + g.courage + p.loyalty - (p.sex === 'F' ? 0.6 : 0) - (p.role === ROLE.RULER ? 0.6 : 0));
      opt('farm', (0.95 + (fpc < 6 ? 0.7 : 0) + (fpc < 2 ? 0.8 : 0)) * (0.5 + g.dilig) * (late ? 0 : 1) - (age > 65 ? 0.7 : 0) - (p.pregnant ? 0.3 : 0) - (late ? 9 : 0));
      opt('mine', (0.3 + k.mineralNeed) * (0.5 + g.dilig) * (p.sex === 'M' ? 1 : 0.55) * (late ? 0 : 1) - (age > 55 ? 0.6 : 0) - (late ? 9 : 0));
      if (k.needsHouse && age < 60 && !late) opt('build', 0.8 * (0.4 + g.dilig));
      if ((p.id === k.rulerId || p.role === ROLE.CONSORT) && !late && !campaign) opt('throne', 1.5 + g.loyal * 0.3 - (fpc < 1 ? 0.8 : 0));
      if (!p.spouseId && age >= 16 && age < 50) opt('court', (0.35 + g.social * 0.8) * (night ? 0.6 : 1));
      if (fpc < 0.6 && p.loyalty < 0.42 && age >= 16 && p.role !== ROLE.RULER) opt('defect', (0.6 - p.loyalty) * 2.5 * (1 - fpc));
    }
    opt('wander', 0.15 + g.social * 0.1);
    if (best !== p.task?.type) this.startTask(p, k, best, e.from);
  }

  pickCell(k, p, kind) {
    const w = this.world, r = this.rand;
    let best = -1, bs = -1e9;
    const R = kind === 'mine' ? k.radius * 1.6 : k.radius * 1.15;
    for (let t = 0; t < 14; t++) {
      const a = r() * Math.PI * 2, d = (kind === 'mine' ? 0.3 : 0.15) * R + Math.sqrt(r()) * R;
      const c = w.cellIndex(k.x + Math.cos(a) * d, k.z + Math.sin(a) * d);
      if (c < 0 || w.gh[c] <= 0.6) continue;
      const v = kind === 'mine' ? this.minLeft[c] : this.food[c];
      if (v < (kind === 'mine' ? 2 : 1.5)) continue;
      const s = v / (kind === 'mine' ? 6 : 4) - d / 140 + (kind === 'farm' ? this.cult[c] * 2 : 0);
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }

  startTask(p, k, type, from) {
    const r = this.rand, w = this.world;
    const t = { type, phase: 0, t: 0 };
    switch (type) {
      case 'drink': {
        const c = w.cellIndex(p.x, p.z);
        const src = c >= 0 ? w.waterSrc[c] : -1;
        let tx = k.x, tz = k.z, useWell = k.hasWell && !this.inDrought(k.x, k.z);
        if (src >= 0) {
          const rx = w.cellX(src % GRID), rz = w.cellX((src / GRID) | 0);
          if (!useWell || Math.hypot(rx - p.x, rz - p.z) < Math.hypot(k.x - p.x, k.z - p.z)) { tx = rx; tz = rz; useWell = false; }
        }
        if (useWell) { [tx, tz] = k.local(8, -6.5); }
        t.tx = tx + (r() - 0.5) * 8; t.tz = tz + (r() - 0.5) * 8;
        p.thought = useWell ? 'Thirsty - heading to the well' : 'Thirsty - heading to the river';
        break;
      }
      case 'eat': {
        if (p.carry >= 1) { t.phase = 1; p.thought = 'Eating from my harvest'; break; }
        if (k.food >= 0.5) { const [hx, hz] = this.homeOf(p, k); t.tx = hx; t.tz = hz; p.thought = 'Hungry - going home to eat'; }
        else {
          const c = this.forageCell(p);
          if (c < 0) { p.thought = 'Starving - there is no food anywhere'; t.type = 'wander'; t.tx = p.x + (r() - 0.5) * 200; t.tz = p.z + (r() - 0.5) * 200; break; }
          t.cell = c; t.tx = w.cellX(c % GRID) + (r() - 0.5) * 20; t.tz = w.cellX((c / GRID) | 0) + (r() - 0.5) * 20; t.forage = true;
          p.thought = 'The stores are empty - foraging for wild food';
        }
        break;
      }
      case 'farm': {
        const c = this.pickCell(k, p, 'farm');
        if (c < 0) { t.type = 'wander'; t.tx = p.x + (r() - 0.5) * 80; t.tz = p.z + (r() - 0.5) * 80; p.thought = 'The fields are bare'; break; }
        t.cell = c; t.tx = w.cellX(c % GRID) + (r() - 0.5) * 24; t.tz = w.cellX((c / GRID) | 0) + (r() - 0.5) * 24;
        p.thought = this.food[c] > 8 ? 'Off to harvest the rich fields' : 'Going to work the fields';
        break;
      }
      case 'mine': {
        const c = this.pickCell(k, p, 'mine');
        if (c < 0) return this.startTask(p, k, 'farm');
        t.cell = c; t.tx = w.cellX(c % GRID) + (r() - 0.5) * 20; t.tz = w.cellX((c / GRID) | 0) + (r() - 0.5) * 20;
        p.thought = 'Heading out to dig for ore';
        break;
      }
      case 'sleep': { const [bx, bz, br] = this.bedOf(p, k); t.tx = bx; t.tz = bz; t.rot = br; p.wake = 5.6 + this.rand() * 1.2; p.thought = this.isNight() ? 'Going home to bed' : 'The day is done — heading home before dark'; break; }
      case 'throne': { // hold court: the ruler and consort sit side by side before the hall, facing the gate
        const z = [0, 12, 18, 22, 32][k.tier]; const side = p.id === k.rulerId ? -0.9 : 0.9;
        [t.tx, t.tz] = k.local(side, z); t.until = 40 + this.rand() * 80; p.thought = 'Holding court from the throne'; break; }
      case 'rest': { const [hx, hz] = this.homeOf(p, k); t.tx = hx; t.tz = hz; p.thought = p.sick > 0 ? 'Sick - resting at home' : 'Tired - going home to rest'; break; }
      case 'play': { const a = r() * 6.283, d = 10 + r() * 45; t.tx = k.x + Math.cos(a) * d; t.tz = k.z + Math.sin(a) * d; p.thought = 'Playing near home'; break; }
      case 'build': {
        if (!k.buildSite) k.buildSite = this.houseSite(k);
        if (!k.buildSite) return this.startTask(p, k, 'farm');
        t.tx = k.buildSite[0] + (r() - 0.5) * 6; t.tz = k.buildSite[1] + (r() - 0.5) * 6; p.thought = 'Helping build a new home';
        break;
      }
      case 'court': {
        const mate = this.findMate(p, k);
        if (!mate) { p.lonely = (p.lonely || 0) + 1; t.type = 'wander'; t.tx = p.x + (r() - 0.5) * 60; t.tz = p.z + (r() - 0.5) * 60; p.thought = 'Lonely - no one to court'; break; }
        p.lonely = 0;
        if (mate.kingdom !== p.kingdom) {
          // envoys arrange the match; both must agree (free will)
          if (r() < 0.35 + mate.genes.social * 0.4) {
            this.marry(p, mate);
            const wife = p.sex === 'F' ? p : mate, husband = p.sex === 'F' ? mate : p;
            const hk = this.kingdoms.get(husband.kingdom);
            if (hk) { wife.task = { type: 'migrate', dest: hk.id, t: 0, phase: 0 }; wife.thought = `Travelling to ${hk.name} to wed ${husband.name}`; }
            if (wife === p) return;
          } else p.thought = `${mate.name} of a foreign realm declined my proposal`;
          t.type = 'wander'; t.tx = p.x + (r() - 0.5) * 40; t.tz = p.z + (r() - 0.5) * 40;
          break;
        }
        t.target = mate.id; p.thought = `Courting ${mate.name}`;
        break;
      }
      case 'march': p.thought = k.army.state === 'defend' ? 'Rallying to defend the realm' : `Marching to war against ${this.kingdoms.get(k.army.target)?.name || 'the enemy'}`; break;
      case 'defend': { const a = r() * 6.283, d = 15 + r() * 40; t.tx = k.x + Math.cos(a) * d; t.tz = k.z + Math.sin(a) * d; p.thought = 'Defending home against invaders'; break; }
      case 'flee': {
        const fx = from ? from.x : p.x + 1, fz = from ? from.z : p.z;
        const homeSafe = Math.hypot(k.x - fx, k.z - fz) > (from?.r || 30) + 60;
        if (homeSafe && Math.hypot(k.x - p.x, k.z - p.z) > 30) { t.tx = k.x + (r() - 0.5) * 30; t.tz = k.z + (r() - 0.5) * 30; }
        else { let ax = p.x - fx, az = p.z - fz; const L = Math.hypot(ax, az) || 1; const D = (from?.r || 40) + 120; t.tx = p.x + (ax / L) * D; t.tz = p.z + (az / L) * D; }
        p.thought = from?.type ? `Fleeing the ${from.type}!` : from?.name ? `Fleeing from ${from.name}!` : 'Running for safety!';
        break;
      }
      case 'defect': {
        let best = null, bs = 0;
        for (const o of this.kingdoms.values()) {
          if (o.id === k.id || this.atWar(k.id, o.id)) continue;
          const d = dist(o, p); if (d > 3500) continue;
          const s = (o.food / Math.max(1, o.pop)) - d / 800;
          if (s > bs) { bs = s; best = o; }
        }
        if (!best) return this.startTask(p, k, 'eat');
        t.type = 'migrate'; t.dest = best.id; t.tx = best.x + (r() - 0.5) * 40; t.tz = best.z + (r() - 0.5) * 40; t.defect = true;
        p.thought = `Abandoning ${k.name} for the full granaries of ${best.name}`;
        break;
      }
      default: { // wander
        t.type = 'wander'; const a = r() * 6.283, d = 20 + r() * 90; t.tx = p.x + Math.cos(a) * d; t.tz = p.z + Math.sin(a) * d;
        if (Math.hypot(t.tx - k.x, t.tz - k.z) > k.radius * 1.2) { t.tx = k.x + (t.tx - k.x) * 0.5; t.tz = k.z + (t.tz - k.z) * 0.5; }
        p.thought = ['Taking a stroll', 'Visiting neighbours', 'Gathering firewood', 'Watching the sky', 'Thinking about the future'][Math.floor(r() * 5)];
      }
    }
    p.task = t;
  }

  inDroughtCached(k) { if (k._dT !== this.seconds) { k._dT = this.seconds; k._dr = this.inDrought(k.x, k.z); } return k._dr; }
  inDrought(x, z) { return this.weather.storms.some((s) => s.type === 'drought' && s.i > 0.5 && Math.hypot(s.x - x, s.z - z) < s.r); }

  forageCell(p) {
    const w = this.world, c0 = w.cellIndex(p.x, p.z); if (c0 < 0) return -1;
    let best = -1, bs = 0;
    const i0 = c0 % GRID, j0 = (c0 / GRID) | 0;
    for (let dj = -8; dj <= 8; dj += 2) for (let di = -8; di <= 8; di += 2) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const c = j * GRID + i; const s = this.food[c] - Math.hypot(di, dj) * 0.3;
      if (this.food[c] > 1 && s > bs) { bs = s; best = c; }
    }
    return best;
  }

  findMate(p, k) {
    const r = this.rand;
    const want = p.sex === 'M' ? 'F' : 'M';
    let best = null, bs = -1e9;
    const pool = [...k.members];
    const tries = Math.min(40, pool.length);
    for (let t = 0; t < tries; t++) {
      const q = this.byId.get(pool[Math.floor(r() * pool.length)]);
      if (!q || q.sex !== want || q.spouseId || q.ageY < 16 || q.ageY > 55 || q.id === p.motherId || q.id === p.fatherId) continue;
      if (q.motherId && (q.motherId === p.motherId || q.fatherId === p.fatherId)) continue; // no siblings
      const s = -Math.abs(q.ageY - p.ageY) * 0.15 - dist(p, q) / 300 + q.genes.social + r();
      if (s > bs) { bs = s; best = q; }
    }
    if (!best || (p.role === ROLE.ROYAL && r() < 0.5)) {
      // arranged marriage with a friendly realm (royals prefer foreign matches)
      const ks = [...this.kingdoms.values()].filter((o) => o.id !== k.id && !this.atWar(k.id, o.id) && dist(o, k) < 6500).sort((a, b) => dist(a, k) - dist(b, k));
      for (const o of ks) {
        for (const id of o.members) {
          const q = this.byId.get(id);
          if (q && q.sex === want && !q.spouseId && q.ageY >= 16 && q.ageY <= 50 && Math.abs(q.ageY - p.ageY) < 15 && r() < 0.5) return q;
        }
      }
    }
    return best;
  }

  houseSite(k) {
    const w = this.world;
    for (let ring = 0; ring < 30; ring++) {
      const R = Math.max(k.wallR() + 12, 30) + ring * 11, steps = Math.floor((2 * Math.PI * R) / 13);
      const off = this.rand() * 6.283;
      for (let s = 0; s < steps; s++) {
        const a = off + (s / steps) * 6.283;
        const x = k.x + Math.cos(a) * R, z = k.z + Math.sin(a) * R;
        const c = w.cellIndex(x, z);
        if (c < 0 || w.gh[c] < 1.2 || w.river[c] || w.slope[c] > 0.4) continue;
        if (k.houses.some(([hx, hz]) => Math.abs(hx - x) < 10 && Math.abs(hz - z) < 10)) continue;
        return [x, z];
      }
    }
    return null;
  }
  addHouse(k) {
    const s = this.houseSite(k); if (!s) return;
    k.houses.push([Math.round(s[0] * 10) / 10, Math.round(s[1] * 10) / 10, Math.round(Math.atan2(k.z - s[1], k.x - s[0]) * 100) / 100]);
    k.housesVer++;
  }

  walkable(x, z) { const c = this.world.cellIndex(x, z); return c >= 0 && this.world.gh[c] > -2.5; }
  // ---- solid architecture: castle curtain walls (gate on the local +z side), keeps, and houses.
  // Shapes match the client's geometry (buildings.js) so nobody walks through a wall.
  toLocal(k, x, z) { const c = Math.cos(k.rot || 0), s = Math.sin(k.rot || 0), dx = x - k.x, dz = z - k.z; return [dx * c - dz * s, dx * s + dz * c]; }
  insideWalls(k, lx, lz) { const R = WALL_R[k.tier] || 0; if (!R) return false; return k.tier === 1 ? Math.hypot(lx, lz) < R : Math.abs(lx) < R && Math.abs(lz) < R; }
  // through the gate: if the target is on the other side of the curtain wall, walk to the gate first
  route(p, tx, tz) {
    const k = this.kingdoms.get(p.kingdom) || this.nearKingdom(p.x, p.z);
    for (const kk of k ? [k] : []) {
      const R = WALL_R[kk.tier]; if (!R) continue;
      const [plx, plz] = this.toLocal(kk, p.x, p.z), [tlx, tlz] = this.toLocal(kk, tx, tz);
      const pin = this.insideWalls(kk, plx, plz), tin = this.insideWalls(kk, tlx, tlz);
      if (pin === tin) continue;
      const inGate = Math.abs(plx) < 3 && Math.abs(plz - R) < 3.5;
      if (inGate) return kk.local(0, tin ? R - 4 : R + 4);
      return kk.local(0, pin ? R - 2.5 : R + 2.5);
    }
    return [tx, tz];
  }
  nearKingdom(x, z) { let b = null, bd = 1e9; for (const k of this.kingdoms.values()) { const d = Math.hypot(k.x - x, k.z - z); if (d < bd) { bd = d; b = k; } } return bd < 90 ? b : null; }
  blocked(x0, z0, x1, z1, tx, tz) {
    for (const k of this.kingdoms.values()) {
      const R = WALL_R[k.tier] || 0, reach = Math.max(R, 30) + 60;
      if (Math.abs(x1 - k.x) > reach || Math.abs(z1 - k.z) > reach) continue;
      const [ax, az] = this.toLocal(k, x0, z0), [bx, bz] = this.toLocal(k, x1, z1);
      if (R) {
        const gate = (lx, lz) => lz > 0 && Math.abs(lx) < (k.tier === 1 ? 3.2 : 4.2);
        if (k.tier === 1) {
          const r0 = Math.hypot(ax, az) - R, r1 = Math.hypot(bx, bz) - R;
          if (Math.abs(r1) < 0.7 && Math.abs(r1) < Math.abs(r0) && !gate(bx, bz)) return true;
          if (r0 * r1 < 0 && !gate(bx, bz)) return true;
        } else {
          for (const [u0, u1, v1, side] of [[ax, bx, bz, 'x'], [az, bz, bx, 'z']]) {
            for (const sgn of [1, -1]) {
              const w0 = u0 * sgn - R, w1 = u1 * sgn - R;
              if (Math.abs(v1) > R + 1) continue;
              const crossing = (w0 * w1 < 0) || (Math.abs(w1) < 0.9 && Math.abs(w1) < Math.abs(w0));
              if (!crossing) continue;
              if (side === 'z' && sgn === 1 && Math.abs(v1) < 4.2) continue; // the gate
              return true;
            }
          }
        }
      }
      // the keep / great hall is solid
      const [hx, hz, cr] = KEEP[k.tier] || KEEP[1];
      const inKeep = (lx, lz) => (Math.abs(lx) < hx && Math.abs(lz) < hz) || (cr && Math.abs(Math.abs(lx) - hx) < cr && Math.abs(Math.abs(lz) - hz) < cr);
      if (inKeep(bx, bz) && !inKeep(ax, az)) return true;
      // houses: solid unless this is the house you are heading into (to sleep or rest)
      for (const h of k.houses) {
        const ddx = x1 - h[0], ddz = z1 - h[1];
        if (ddx * ddx + ddz * ddz > 12) continue;
        if (Math.hypot(tx - h[0], tz - h[1]) < 3.6) continue;
        if (Math.hypot(x0 - h[0], z0 - h[1]) < Math.sqrt(ddx * ddx + ddz * ddz)) continue; // already inside: let them out
        return true;
      }
    }
    return false;
  }
  moveTo(p, tx, tz, speed, dt) {
    const fd = Math.hypot(tx - p.x, tz - p.z);
    if (fd < 0.8) return true;
    const [gx, gz] = this.route(p, tx, tz);
    const dx = gx - p.x, dz = gz - p.z, d = Math.max(0.01, Math.hypot(dx, dz));
    const step = Math.min(d, speed * dt);
    let nx = p.x + (dx / d) * step, nz = p.z + (dz / d) * step;
    const ok = (x, z) => this.walkable(x, z) && !this.blocked(p.x, p.z, x, z, tx, tz);
    if (!ok(nx, nz) && this.walkable(p.x, p.z)) {
      // steer along the coast or around the wall
      let found = false;
      for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const ux = (dx * ca - dz * sa) / d, uz = (dx * sa + dz * ca) / d;
        const ax = p.x + ux * step, az = p.z + uz * step;
        if (ok(ax, az)) { nx = ax; nz = az; found = true; break; }
      }
      if (!found) return fd < 6; // can't get any closer: close enough
    }
    p.heading = Math.atan2(nx - p.x, nz - p.z);
    p.x = nx; p.z = nz;
    return false;
  }

  speedOf(p, e, base) {
    const a = p.ageY;
    let s = base * (a < 10 ? 0.75 : a > 65 ? 0.7 : 1) * e.slow;
    if (p.health < 30) s *= 0.6;
    const c = this.world.cellIndex(p.x, p.z);
    if (c >= 0) s *= 1 - Math.min(0.35, this.world.slope[c] * 0.4);
    return s;
  }

  act(p, k, dt, e) {
    const t = p.task; if (!t) { p.state = STATE.IDLE; return; }
    t.t += dt;
    const r = this.rand, walk = this.speedOf(p, e, 2.5), run = this.speedOf(p, e, 4.8);
    const go = (sp, st) => { const arrived = this.moveTo(p, t.tx, t.tz, sp, dt); p.state = arrived ? STATE.IDLE : st; return arrived; };
    switch (t.type) {
      case 'drink':
        if (t.phase === 0) { if (go(walk, STATE.WALK) || t.t > 140) { t.phase = 1; t.t = 0; } }
        else { p.state = STATE.DRINK; if (t.t > 3) { p.hydration = 1; p.task = null; } }
        break;
      case 'eat':
        if (t.phase === 0) { if (go(walk, STATE.WALK) || (t.t > 140 && Math.hypot(t.tx - p.x, t.tz - p.z) < 120)) { t.phase = 1; t.t = 0; } }
        else {
          p.state = STATE.EAT;
          if (t.t > 2.5) {
            const need = p.ageY < 14 ? 0.6 : 1;
            if (p.carry >= need) { p.carry -= need; p.satiety = Math.min(1, p.satiety + 0.75); }
            else if (t.forage && this.food[t.cell] >= need) { this.food[t.cell] -= need; p.satiety = Math.min(1, p.satiety + 0.6); }
            else if (k.food >= need) { k.food -= need; k.cons = (k.cons || 0) + need; p.satiety = Math.min(1, p.satiety + 0.75); }
            else { p.thought = 'Nothing left to eat...'; p.thinkT = 0; }
            p.task = null;
          }
        }
        break;
      case 'farm':
        if (t.phase === 0 && this.mustHeadHome(p, k)) { t.phase = 2; t.tx = k.x + (r() - 0.5) * 20; t.tz = k.z + (r() - 0.5) * 20; p.thought = 'Dusk is coming — heading home'; }
        if (t.phase === 0) { if (go(walk, STATE.WALK)) { t.phase = 1; t.t = 0; } }
        else if (t.phase === 1) {
          p.state = STATE.FARM;
          const take = Math.min(this.food[t.cell], dt * (1.5 + 0.8 * p.genes.dilig) * 1.6 * (p.ageY < 14 ? 0.5 : 1));
          this.food[t.cell] -= take; p.carry += take; this.cult[t.cell] = Math.min(1, this.cult[t.cell] + dt * 0.003);
          if (p.carry >= 14 || this.food[t.cell] < 0.3 || t.t > 18 || this.mustHeadHome(p, k)) { t.phase = 2; t.tx = k.x + (r() - 0.5) * 20; t.tz = k.z + (r() - 0.5) * 20; p.thought = 'Carrying the harvest home'; }
        } else if (go(walk * 0.9, STATE.WALK)) { k.food += p.carry; k.prod = (k.prod || 0) + p.carry; p.carry = 0; p.task = null; }
        break;
      case 'mine':
        if (t.phase < 2 && this.mustHeadHome(p, k)) { t.phase = 2; t.tx = k.x + (r() - 0.5) * 20; t.tz = k.z + (r() - 0.5) * 20; p.thought = 'Dusk is coming — hauling the ore home'; }
        if (t.phase === 0) { if (go(walk, STATE.WALK)) { t.phase = 1; t.t = 0; } }
        else if (t.phase === 1) {
          p.state = STATE.MINE;
          const take = Math.min(this.minLeft[t.cell], dt * 0.12 * this.world.minerals[t.cell] * p.genes.str);
          this.minLeft[t.cell] -= take; p.carryMin += take;
          if (t.t > 14 || this.minLeft[t.cell] < 0.5) { t.phase = 2; t.tx = k.x + (r() - 0.5) * 20; t.tz = k.z + (r() - 0.5) * 20; p.thought = 'Hauling ore back to the realm'; }
        } else if (go(walk * 0.85, STATE.WALK)) { k.minerals += p.carryMin; p.carryMin = 0; p.task = null; }
        break;
      case 'throne':
        if (t.phase === 0) { if (go(walk, STATE.WALK) || t.t > 120) { t.phase = 1; t.t = 0; p.x = t.tx; p.z = t.tz; } }
        else { p.state = STATE.IDLE; p.heading = k.rot || 0; if (t.t > t.until || this.mustHeadHome(p, k)) p.task = null; }
        break;
      case 'rest':
        if (t.phase === 0) { if (go(walk, STATE.WALK)) { t.phase = 1; t.t = 0; } }
        else { p.state = STATE.REST; if (p.energy > 0.97 && p.sick <= 0 && (!this.isNight() || t.t > 30)) p.task = null; }
        break;
      case 'play':
        if (go(walk * 1.1, STATE.PLAY)) { p.state = STATE.PLAY; if (t.t > 8) p.task = null; }
        else p.state = STATE.PLAY;
        break;
      case 'build':
        if (t.phase === 0) { if (go(walk, STATE.WALK)) { t.phase = 1; t.t = 0; } }
        else {
          p.state = STATE.BUILD; k.buildProgress += dt;
          if (k.buildProgress > 30 && k.buildSite) {
            k.buildProgress = 0;
            k.houses.push([Math.round(k.buildSite[0] * 10) / 10, Math.round(k.buildSite[1] * 10) / 10, Math.round(Math.atan2(k.z - k.buildSite[1], k.x - k.buildSite[0]) * 100) / 100]);
            k.housesVer++; k.buildSite = null; p.task = null;
          }
          if (t.t > 25 || !k.buildSite) p.task = null;
        }
        break;
      case 'court': {
        const q = this.byId.get(t.target);
        if (!q || !q.alive || q.spouseId || p.spouseId) { p.task = null; break; }
        t.tx = q.x; t.tz = q.z;
        if (go(walk, STATE.WALK) || Math.hypot(q.x - p.x, q.z - p.z) < 2.5) {
          p.state = STATE.COURT;
          if (t.t > 2) {
            // both have free will: attraction must be mutual
            const like = (a, b) => 0.3 + a.genes.social * 0.4 + (b.genes.str - 1) * 0.3 + b.nourish * 0.2 - Math.abs(a.ageY - b.ageY) * 0.02 + r() * 0.45;
            if (like(p, q) > 0.62 && like(q, p) > 0.62) { this.marry(p, q); p.thought = `Married ${q.name}!`; q.thought = `Married ${p.name}!`; }
            else { p.thought = `${q.name} turned me down`; }
            p.task = null;
          }
        }
        if (t.t > 60) p.task = null;
        break;
      }
      case 'captive': {
        const cap = this.byId.get(t.by);
        p.state = STATE.WALK;
        if (cap && cap.alive && cap.soldier && cap.kingdom === p.kingdom) {
          const d = Math.hypot(cap.x - p.x, cap.z - p.z);
          if (d > 2.2) this.moveTo(p, cap.x - Math.sin(cap.heading || 0) * 1.6, cap.z - Math.cos(cap.heading || 0) * 1.6, d > 12 ? run * 0.8 : walk * 1.1, dt);
          else p.state = STATE.IDLE;
          p.thought = `A captive, marched along behind ${cap.name}`;
        } else {
          const [hx, hz] = this.homeOf(p, k);
          if (this.moveTo(p, hx, hz, walk, dt)) { p.task = null; p.thinkT = 5; p.thought = `A prisoner in ${k.name}, far from home`; }
        }
        if (p.satiety < 0.3 && k.food >= 1) { k.food -= 1; p.satiety = 0.8; }
        if (p.hydration < 0.3) p.hydration = 0.8;
        break;
      }
      case 'march': {
        const a = k.army;
        if (a.state === 'none' || !p.soldier) { p.task = null; break; }
        if (p.satiety < 0.35 && k.food >= 1.2) { k.food -= 1.2; p.satiety = Math.min(1, p.satiety + 0.7); }  // supply train
        if (p.hydration < 0.35) p.hydration = 0.9;
        const ang = (p.id * 2.399) % 6.283, rad = 3 + ((p.id * 7) % 11) * Math.sqrt(Math.max(1, k.soldiers)) * 0.35;
        t.tx = a.fx + Math.cos(ang) * rad; t.tz = a.fz + Math.sin(ang) * rad;
        const far = Math.hypot(t.tx - p.x, t.tz - p.z) > 60;
        if (go(far ? run * 0.85 : walk * 1.15, STATE.MARCH)) p.state = a.state === 'siege' || a.state === 'battle' ? STATE.FIGHT : STATE.IDLE;
        if (a.state === 'battle') { p.heading = Math.atan2(a.bx - p.x, a.bz - p.z); if (k.atWar) this.combatScan(p, k, 60); }
        break;
      }
      case 'defend':
        if (!k.defense) { p.task = null; break; }
        if (go(run * 0.8, STATE.DEFEND)) p.state = STATE.DEFEND;
        if (t.t > 20) { p.task = null; }
        break;
      case 'fight': {
        const q = this.byId.get(t.target);
        if (!q || !q.alive || !this.atWar(p.kingdom, q.kingdom) || t.t > 40) { p.task = null; p.thinkT = 0; break; }
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > 45) { p.task = null; break; }
        p.state = STATE.FIGHT;
        if (d > 1.5) { t.tx = q.x; t.tz = q.z; this.moveTo(p, q.x, q.z, run, dt); }
        else {
          p.heading = Math.atan2(q.x - p.x, q.z - p.z);
          p.attackCd -= dt;
          if (p.attackCd <= 0) {
            p.attackCd = 0.9 + r() * 0.7;
            const sp = this.strength(p), sq = this.strength(q);
            if (r() < 0.5 + 0.3 * (sp - sq)) {
              q.health -= (8 + r() * 14) * sp / (0.6 + 0.4 * sq);
              q.lastCause = `was slain in battle by ${this.fullName(p)} of ${k.name}`; q.lastKiller = p.id;
              if (q.task?.type !== 'fight' && q.health > 20 && this.isCombatant(q)) q.task = { type: 'fight', target: p.id, t: 0 };
              // a beaten soldier may throw down his sword rather than die
              if (q.health <= 15 && !q.captive && q.health > -12 && r() < 0.5 * (1.25 - q.genes.courage)) { this.capture(p, q); break; }
              if (q.health <= 0) {
                p.kills++; k.kills++;
                const qk = this.kingdoms.get(q.kingdom);
                if (qk) { qk.relOf(k.id).ourDead++; k.relOf(qk.id).theirDead++; }
                this.die(q, q.lastCause); p.task = null; p.thinkT = 0;
              }
            }
          }
        }
        break;
      }
      case 'sleep':
        if (t.phase === 0) { if (go(walk * (this.isNight() ? 1.15 : 1), STATE.WALK) || t.t > 200) { t.phase = 1; p.x = t.tx; p.z = t.tz; p.heading = t.rot || 0; } }
        else {
          p.state = STATE.REST; p.indoors = true;
          if (p.hydration < 0.6 && k.hasWell) p.hydration = 0.9; // a jug by the bed
          const h = this.hour();
          if (!this.isNight() && h >= (p.wake || 6) && h < 20) { p.task = null; p.indoors = false; p.thought = 'Good morning — another day begins'; p.energy = 1; }
        }
        break;
      case 'brawl': case 'vendetta': {
        const q = this.byId.get(t.target);
        const lethal = t.type === 'vendetta';
        if (!q || !q.alive || (!lethal && this.realTime > t.until) || t.t > 120) { p.task = null; p.thinkT = 0; break; }
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        p.state = d > 1.6 ? STATE.WALK : STATE.FIGHT;
        if (d > 1.5) { this.moveTo(p, q.x, q.z, lethal ? run : walk * 1.2, dt); break; }
        p.heading = Math.atan2(q.x - p.x, q.z - p.z);
        p.attackCd -= dt;
        if (p.attackCd <= 0) {
          p.attackCd = 1 + r() * 0.8;
          if (r() < 0.55) {
            q.health -= lethal ? 10 + r() * 14 * this.strength(p) : 3 + r() * 5;
            if (!lethal && q.health < 30) { q.health = 30; p.task = null; q.task = null; addOp(p, q, r() < 0.5 ? 15 : -20); addOp(q, p, r() < 0.5 ? 15 : -20); break; }
            if (q.health <= 0) {
              q.lastKiller = p.id;
              const kk = this.kingdoms.get(p.kingdom);
              this.die(q, `was murdered by ${p.name}`);
              this.event('murder', `${this.fullName(p)} has murdered ${q.name} in ${kk ? kk.name : 'the wilds'}.`, { k: p.kingdom, x: p.x, z: p.z, pid: p.id, narr: `A life taken in passion. Will ${kk ? 'the crown of ' + kk.name : 'anyone'} see justice done?` });
              remember(this, p, `Killed ${q.name}`, 4);
              const ruler = kk && this.byId.get(kk.rulerId);
              if (ruler && ruler !== p && r() < 0.35 + ruler.genes.honor * 0.4) {
                this.event('justice', `${this.fullName(ruler)} sentences ${p.name} to death for the murder of ${q.name}.`, { k: kk.id, x: kk.x, z: kk.z });
                this.die(p, `was executed for murder by ${this.fullName(ruler)}`);
              }
              p.task = null;
            } else if (q.task?.type !== 'brawl' && q.task?.type !== 'vendetta' && q.ageY >= 16) q.task = { type: lethal ? 'vendetta' : 'brawl', target: p.id, t: 0, until: t.until };
          }
        }
        break;
      }
      case 'talk': {
        const q = this.byId.get(t.partner);
        p.state = STATE.IDLE;
        if (!q || !q.alive || this.realTime > t.until) { p.task = null; break; }
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > 2.2) this.moveTo(p, q.x, q.z, walk, dt), p.state = STATE.WALK;
        p.heading = Math.atan2(q.x - p.x, q.z - p.z);
        break;
      }
      case 'flee':
        if (go(run, STATE.FLEE) || t.t > 14) { p.task = null; p.thinkT = 0; }
        break;
      case 'migrate': {
        const dest = this.kingdoms.get(t.dest);
        if (!dest) { p.task = null; break; }
        t.tx = dest.x + ((p.id * 13) % 40) - 20; t.tz = dest.z + ((p.id * 17) % 40) - 20;
        if (go(walk, STATE.MIGRATE) || t.t > 900) {
          if (t.defect && p.kingdom !== dest.id) {
            const oldName = k.name;
            this.transfer(p, dest.id);
            for (const cid of p.children) { const c = this.byId.get(cid); if (c && c.alive && c.ageY < 14 && c.kingdom === k.id) this.transfer(c, dest.id); }
            this.event('defect', `${p.name} abandons starving ${oldName} for ${dest.name}.`, { k: dest.id, minor: true });
          }
          p.task = null;
        }
        break;
      }
      default:
        if (go(walk * 0.8, STATE.WALK)) { p.state = STATE.IDLE; if (t.t > 6) p.task = null; }
    }
  }

  // ---------------------------------------------------------------- kingdoms
  updateKingdomStats() {
    let total = 0;
    for (const k of this.kingdoms.values()) {
      let pop = 0, fighters = 0, soldiers = 0, power = 0, nour = 0, adults = 0, men = 0, women = 0, kids = 0;
      for (const id of k.members) {
        const p = this.byId.get(id); if (!p) continue;
        pop++; nour += p.nourish;
        if (p.ageY < 16) kids++; else { adults++; if (p.sex === 'M') men++; else women++; }
        if (p.ageY >= 15 && p.ageY < 60 && p.health > 30) {
          fighters++;
          const s = this.strength(p);
          power += p.soldier ? s * 1.3 : s * (p.sex === 'M' ? 0.6 : 0.3);
        }
        if (p.soldier) soldiers++;
      }
      Object.assign(k, { pop, fighters, soldiers, power, adults, men, women, kids, nourish: pop ? nour / pop : 0 });
      total += power;
      k.radius = Math.min(700, 130 + Math.sqrt(pop) * 30);
      const tier = pop < 12 ? 1 : pop < 40 ? 2 : pop < 110 ? 3 : 4;
      if (tier > k.tier) { // the castle grows: clear homes inside the new walls (they get rebuilt outside)
        k.tier = tier; const R = k.wallR() + 8;
        const before = k.houses.length;
        k.houses = k.houses.filter(([hx, hz]) => Math.hypot(hx - k.x, hz - k.z) > R);
        if (k.houses.length !== before) k.housesVer++;
        this.event('growth', `${k.name} grows into a ${['', 'hamlet', 'village', 'walled town', 'great citadel'][tier]}.`, { k: k.id, x: k.x, z: k.z, minor: tier < 3 });
      } else if (!k.tier) k.tier = tier;
      k.needsHouse = k.houses.length < Math.ceil(pop / 4.5) + 1 && k.houses.length < 260;
      k.mineralNeed = clamp(1 - k.minerals / (pop * 2 + 10), 0, 1) * (pop < 10 ? 0.3 : 0.9);
      if (k.minerals > 4) { const m = Math.min(k.minerals - 4, 1.5); k.minerals -= m; k.armory += m; }
      k.weaponLevel = Math.min(2.5, k.armory / Math.max(10, fighters * 6));
      k.atWar = [...k.rel.values()].some((r) => r.state === 'war');
      if (k.food < 0) k.food = 0;
      k.food *= 0.99985; // spoilage
    }
    this.totalPower = total;
  }

  kingdomThink(k) {
    const r = this.rand;
    if (!this.kingdoms.has(k.id)) return;
    let ruler = this.byId.get(k.rulerId);
    if (!ruler) { this.succession(k, { children: [], spouseId: 0 }); ruler = this.byId.get(k.rulerId); if (!ruler) return; }
    const g = ruler.genes;
    // the monarch (if single) seeks a royal match
    if (!ruler.spouseId && ruler.ageY >= 16 && ruler.ageY < 60 && ruler.task?.type !== 'court' && r() < 0.3) this.startTask(ruler, k, 'court');

    // ----- war & peace
    const others = [...this.kingdoms.values()].filter((o) => o.id !== k.id);
    for (const o of others) {
      const rel = k.relOf(o.id), back = o.relOf(k.id);
      const d = dist(k, o);
      if (rel.state === 'war') {
        const age = this.realTime - rel.since;
        const losing = rel.ourDead > rel.theirDead * 1.6 + 3 && k.power < o.power * 0.75;
        const weary = age > 900;
        if ((losing && r() < 0.25 * (1.2 - g.aggr)) || (weary && r() < 0.05)) {
          const enemyRuler = this.byId.get(o.rulerId);
          const accept = r() < 0.45 + (weary ? 0.3 : 0) - (enemyRuler ? enemyRuler.genes.aggr * 0.35 : 0) + (o.power < k.power * 1.4 ? 0.25 : 0);
          if (accept) this.makePeace(k, o, losing ? o : null);
        }
        continue;
      }
      if (rel.state === 'ally' || this.realTime < rel.truceUntil) continue;
      if (d > 4200 || k.fighters < 3 || k.army.state !== 'none') continue;
      const fpc = k.food / Math.max(1, k.pop), ofpc = o.food / Math.max(1, o.pop);
      const hunger = fpc < 2 ? 0.45 : 0;
      const envy = clamp((ofpc - fpc) / 10, -0.3, 0.5) + clamp((o.minerals - k.minerals) / 200, -0.2, 0.3);
      const capHate = o.capital ? 0.35 + (k.coalition ? 0.5 : 0) : 0;
      const grudge = rel.grudge;
      const allyPower = others.filter((x) => o.rel.get(x.id)?.state === 'ally').reduce((s, x) => s + x.power, 0);
      const myAllies = others.filter((x) => k.rel.get(x.id)?.state === 'ally' && !this.atWar(x.id, o.id)).reduce((s, x) => s + x.power * 0.6, 0);
      const ratio = (k.power + myAllies) / (o.power + allyPower * 0.6 + 0.1);
      const tension = rel.tension || 0;
      const desire = g.aggr * 0.9 + g.ambit * 0.5 + envy + hunger + capHate + grudge + tension / 70 + (rel.cb ? 0.35 : 0) - 1.35 - d / 9000 + (r() - 0.5) * 0.4;
      const need = 1.1 - g.aggr * 0.35 - hunger * 0.3 - capHate * 0.25 - Math.max(0, tension - 45) / 150;
      if (desire > 0 && ratio > need && (tension > 45 || capHate > 0) && r() < 0.2) { this.declareWar(k, o, rel.cb ? `over ${rel.cb}` : capHate > 0 ? 'to topple the capital' : hunger ? 'for its granaries' : envy > 0.2 ? 'for its rich lands' : 'for glory'); break; }
    }

    // ----- coalition against the capital
    const cap = this.kingdoms.get(this.capitalId);
    if (cap && cap.id !== k.id && !this.atWar(k.id, cap.id)) {
      const fear = cap.power / (k.power + 1);
      if (fear > 1.8 && r() < 0.15 * (0.5 + g.loyal)) {
        for (const o of others) {
          if (o.id === cap.id || k.rel.get(o.id)?.state !== 'peace' || this.atWar(k.id, o.id) || dist(k, o) > 4000) continue;
          const oru = this.byId.get(o.rulerId);
          if (oru && r() < 0.35 + oru.genes.loyal * 0.3 && cap.power / (o.power + 1) > 1.4) {
            k.relOf(o.id).state = 'ally'; o.relOf(k.id).state = 'ally'; k.coalition = o.coalition = true;
            this.event('alliance', `${k.name} and ${o.name} forge an alliance against the capital, ${cap.name}.`, { k: k.id, x: k.x, z: k.z });
            k.history.push(`Year ${calendar(this.time).year}: allied with ${o.name} against ${cap.name}.`);
            break;
          }
        }
      }
      if (k.coalition && k.fighters >= 5 && k.army.state === 'none') {
        const allies = others.filter((x) => k.rel.get(x.id)?.state === 'ally');
        const combined = k.power + allies.reduce((s, x) => s + x.power, 0);
        if (combined > cap.power * 0.95 && r() < 0.2) this.declareWar(k, cap, 'with its allies, to topple the capital');
      }
    }

    // ----- secession: ambitious nobles found new realms
    if (k.pop >= 32 && this.kingdoms.size < 40 && r() < 0.07) this.trySecession(k);
    // ----- grow the settlement
    if (k.needsHouse && k.houses.length < 3) this.addHouse(k);
    // ----- tribute
    for (const [oid, rel] of k.rel) {
      if (rel.tribute && this.realTime < rel.tributeUntil) {
        const o = this.kingdoms.get(oid); if (!o) continue;
        const pay = Math.min(k.food * 0.04, 6); k.food -= pay; o.food += pay;
      }
    }
  }

  declareWar(k, o, why) {
    const rel = k.relOf(o.id), back = o.relOf(k.id);
    rel.state = back.state = 'war'; rel.since = back.since = this.realTime;
    rel.ourDead = rel.theirDead = back.ourDead = back.theirDead = 0;
    this.stats.wars++;
    const kr = this.byId.get(k.rulerId);
    this.event('war', `${kr ? this.fullName(kr) + ' of ' : ''}${k.name} declares war on ${o.name} ${why}!`, { k: k.id, k2: o.id, x: (k.x + o.x) / 2, z: (k.z + o.z) / 2, narr: `It has come to this. Fields will burn, and mothers in ${k.name} and ${o.name} will bury their sons. Who will be left standing?` });
    rel.tension = back.tension = 95; rel.cb = back.cb = null;
    k.history.push(`Year ${calendar(this.time).year}: declared war on ${o.name}.`);
    o.history.push(`Year ${calendar(this.time).year}: ${k.name} declared war on us.`);
    this.muster(k, o);
    this.muster(o, k); // the defender raises its banners and marches out to meet the invader
    // allies are called to arms (each decides freely)
    for (const side of [k, o]) {
      const enemy = side === k ? o : k;
      for (const [aid, ar] of side.rel) {
        if (ar.state !== 'ally') continue;
        const a = this.kingdoms.get(aid); if (!a || a.id === enemy.id || this.atWar(a.id, enemy.id)) continue;
        if (a.rel.get(enemy.id)?.state === 'ally') continue;
        const ar2 = this.byId.get(a.rulerId);
        if (ar2 && this.rand() < 0.45 + ar2.genes.loyal * 0.5) {
          const r1 = a.relOf(enemy.id), r2 = enemy.relOf(a.id);
          r1.state = r2.state = 'war'; r1.since = r2.since = this.realTime;
          this.event('war', `${a.name} honours its alliance with ${side.name} and joins the war against ${enemy.name}.`, { k: a.id, k2: enemy.id, x: a.x, z: a.z });
          if (a.army.state === 'none' && side === k) this.muster(a, enemy);
        }
      }
    }
  }

  muster(k, target) {
    const r = this.rand, ruler = this.byId.get(k.rulerId);
    const frac = 0.35 + 0.45 * (ruler ? ruler.genes.aggr : 0.5);
    const cands = [...k.members].map((id) => this.byId.get(id)).filter((p) => p && p.ageY >= 16 && p.ageY < 52 && p.health > 50 && p.id !== k.rulerId && !p.pregnant &&
      (p.sex === 'M' || (p.genes.courage > 0.7 && p.genes.aggr > 0.55)));
    cands.sort((a, b) => this.strength(b) - this.strength(a));
    const n = Math.max(Math.min(cands.length, 3), Math.round(cands.length * frac));
    if (n < 3) return;
    let enlisted = 0;
    for (let i = 0; i < n; i++) {
      const p = cands[i];
      // free will: a few refuse the call
      if (r() > 0.55 + p.loyalty * 0.5) { p.thought = 'Refused the call to arms'; continue; }
      p.soldier = true; if (p.role === ROLE.COMMONER) p.role = ROLE.SOLDIER;
      p.task = null; p.thinkT = 0; enlisted++;
    }
    if (enlisted < 3) { for (const p of cands) { p.soldier = false; if (p.role === ROLE.SOLDIER) p.role = ROLE.COMMONER; } return; }
    k.soldiers = enlisted;
    const gen = cands.find((p) => p.soldier);
    if (gen) { gen.role = ROLE.GENERAL; k.generalId = gen.id; }
    const ang = Math.atan2(target.z - k.z, target.x - k.x);
    k.army = { state: 'muster', target: target.id, fx: k.x + Math.cos(ang) * 50, fz: k.z + Math.sin(ang) * 50, t: 0 };
    if (gen) this.event('muster', `${k.name} musters ${k.soldiers || n} soldiers under General ${gen.name}.`, { k: k.id, x: k.x, z: k.z, minor: true });
  }

  updateArmy(k, dt) {
    const a = k.army;
    // home defense: enemies inside the realm
    k.defenseT -= dt;
    if (k.atWar && k.defenseT <= 0) {
      k.defenseT = 1;
      let threats = 0;
      this.spatial.query(k.x, k.z, k.radius * 0.8, (q) => { if (q.soldier && this.atWar(k.id, q.kingdom)) threats++; });
      const was = k.defense;
      k.defense = threats > 0;
      if (k.defense && !was) {
        this.event('raid', `Enemy soldiers storm into ${k.name}! The people take up arms.`, { k: k.id, x: k.x, z: k.z });
        for (const id of k.members) { const p = this.byId.get(id); if (p && p.ageY >= 16 && p.ageY < 62 && !p.soldier && (p.sex === 'M' || p.genes.courage > 0.65) && p.genes.courage > 0.25) { p.task = null; p.thinkT = 0; } }
        if (a.state === 'march' && Math.hypot(a.fx - k.x, a.fz - k.z) < 1500) { a.prev = a.state; a.state = 'defend'; }
      }
      if (!k.defense && a.state === 'defend') a.state = a.target && this.kingdoms.has(a.target) && this.atWar(k.id, a.target) ? 'march' : 'return';
    } else if (!k.atWar) k.defense = false;
    if (a.state === 'none') return;
    a.t += dt;
    const target = this.kingdoms.get(a.target);
    if (a.state !== 'return' && a.state !== 'defend' && (!target || !this.atWar(k.id, target.id))) {
      // pick another enemy or go home
      const enemy = [...k.rel.entries()].find(([id, r]) => r.state === 'war' && this.kingdoms.has(id));
      if (enemy) a.target = enemy[0]; else a.state = 'return';
    }
    if (k.soldiers < 2 && a.state !== 'return') { a.state = 'return'; this.event('retreat', `The army of ${k.name} is broken and retreats.`, { k: k.id, x: a.fx, z: a.fz, minor: true }); }
    const step = (tx, tz, sp) => {
      const dx = tx - a.fx, dz = tz - a.fz, d = Math.hypot(dx, dz);
      if (d < 1) return d;
      // cohesion: the front waits for stragglers
      let near = 0, tot = 0;
      for (const id of k.members) { const p = this.byId.get(id); if (p && p.soldier) { tot++; if (Math.hypot(p.x - a.fx, p.z - a.fz) < 70) near++; } }
      const coh = tot ? near / tot : 0;
      const s = Math.min(d, sp * dt * (coh > 0.55 ? 1 : 0.15));
      const nx = a.fx + (dx / d) * s, nz = a.fz + (dz / d) * s;
      if (this.world.isLand(nx, nz)) { a.fx = nx; a.fz = nz; } else { a.fx += (-dz / d) * s; a.fz += (dx / d) * s; }
      return d;
    };
    switch (a.state) {
      case 'muster': if (a.t > 25) { a.state = 'march'; this.event('march', `The army of ${k.name} marches on ${target?.name}.`, { k: k.id, k2: target?.id, x: a.fx, z: a.fz }); } break;
      case 'march': {
        if (!target) break;
        // two armies on the move find each other: they halt and give battle in the field
        const ea = target.army;
        if (ea && (ea.state === 'march' || ea.state === 'muster' || ea.state === 'defend') && ea.target === k.id && Math.hypot(ea.fx - a.fx, ea.fz - a.fz) < 160) {
          const bx = (a.fx + ea.fx) / 2, bz = (a.fz + ea.fz) / 2;
          for (const [x, y] of [[a, ea], [ea, a]]) { x.state = 'battle'; x.bx = bx; x.bz = bz; x.bt = 0; }
          const place = this.world.isLand(bx, bz) ? 'in the open field' : 'at the water\'s edge';
          this.event('battle', `The armies of ${k.name} and ${target.name} meet ${place}. Battle is joined!`, { k: k.id, k2: target.id, x: bx, z: bz,
            narr: `Steel against steel. Every soldier here chose to come, and every one of them wants to go home. Not all of them will.` });
          break;
        }
        const d = step(target.x, target.z, 2.6);
        if (d < 90) { a.state = 'siege'; this.event('siege', `${k.name} lays siege to ${target.name}!`, { k: k.id, k2: target.id, x: target.x, z: target.z }); }
        break;
      }
      case 'siege': {
        if (!target) break;
        a.fx = target.x; a.fz = target.z;
        let attackers = 0, defenders = 0;
        this.spatial.query(target.x, target.z, 90, (q) => {
          if (q.kingdom === k.id && q.soldier) attackers++;
          else if (q.kingdom === target.id && q.ageY >= 15 && q.health > 20 && q.task?.type !== 'flee' && (q.sex === 'M' || q.soldier || q.task?.type === 'defend')) defenders++;
        });
        if (attackers >= 3 && defenders === 0) target.siege = (target.siege || 0) + dt * Math.min(attackers, 20) * 0.35;
        else target.siege = Math.max(0, (target.siege || 0) - dt * 0.5);
        if (target.siege >= 60) this.conquer(k, target);
        break;
      }
      case 'battle': {
        a.bt = (a.bt || 0) + dt;
        // both fronts close on the battlefield
        step(a.bx, a.bz, 2);
        let mine = 0, theirs = 0;
        this.spatial.query(a.bx, a.bz, 150, (q) => {
          if (!q.soldier || q.health <= 15) return;
          if (q.kingdom === k.id) mine++; else if (target && q.kingdom === target.id) theirs++;
        });
        const ea = target?.army;
        if (!target || !ea || ea.state !== 'battle') {
          // the enemy broke: march on their capital
          a.state = target && this.atWar(k.id, target.id) ? 'march' : 'return';
          break;
        }
        if (a.bt > 12 && (mine === 0 || (mine <= theirs * 0.4 && a.bt > 25))) {
          a.state = 'return';
          ea.state = 'march';
          this.event('rout', `${k.name}'s army breaks and flees the field! ${target.name} is victorious and marches on.`, { k: target.id, k2: k.id, x: a.bx, z: a.bz,
            narr: `The line breaks. Men who swore to die for ${k.name} are running for their lives. And ${target.name} smells blood.` });
          for (const id of k.members) { const q = this.byId.get(id); if (q && q.soldier && q.task?.type === 'fight') { q.task = null; q.thinkT = 0; } }
        } else if (a.bt > 300) { a.state = 'return'; ea.state = 'return'; this.event('battle', `Neither ${k.name} nor ${target.name} can win the field. Both armies withdraw, bloodied.`, { k: k.id, k2: target.id, x: a.bx, z: a.bz }); }
        break;
      }
      case 'defend': { step(k.x, k.z, 3.5); break; }
      case 'return': {
        const d = step(k.x, k.z, 3);
        if (d < 40 || a.t > 600) this.disband(k);
        break;
      }
    }
  }

  disband(k) {
    k.army = { state: 'none' };
    for (const id of k.members) { const p = this.byId.get(id); if (p && p.soldier) { p.soldier = false; if (p.role === ROLE.SOLDIER || p.role === ROLE.GENERAL) p.role = ROLE.COMMONER; p.task = null; } }
    this.event('disband', `The army of ${k.name} returns home and lays down arms.`, { k: k.id, minor: true });
  }

  makePeace(k, o, winner) {
    const r1 = k.relOf(o.id), r2 = o.relOf(k.id);
    r1.state = r2.state = 'peace'; r1.tension = r2.tension = 45;
    r1.truceUntil = r2.truceUntil = this.realTime + 360 + this.rand() * 300;
    r1.grudge = Math.min(1, r1.grudge + 0.25); r2.grudge = Math.min(1, r2.grudge + 0.15);
    const loser = winner === o ? k : winner === k ? o : null;
    if (winner && loser) {
      const lr = loser.relOf(winner.id); lr.tribute = true; lr.tributeUntil = this.realTime + 600;
      winner.wins++; loser.losses++;
      this.event('peace', `${loser.name} surrenders to ${winner.name} and must pay tribute.`, { k: winner.id, k2: loser.id, x: winner.x, z: winner.z });
      winner.history.push(`Year ${calendar(this.time).year}: forced ${loser.name} to surrender.`);
      loser.history.push(`Year ${calendar(this.time).year}: surrendered to ${winner.name}.`);
      this.setCapital(winner, `${winner.name} is victorious`);
    } else {
      this.event('peace', `Exhausted by war, ${k.name} and ${o.name} make peace.`, { k: k.id, k2: o.id, x: (k.x + o.x) / 2, z: (k.z + o.z) / 2 });
    }
    for (const x of [k, o]) if (x.army.state !== 'none' && !x.atWar) x.army.state = 'return';
  }

  conquer(k, t) {
    const r = this.rand;
    this.stats.conquests++;
    k.wins++; k.conquests++;
    const tr = this.byId.get(t.rulerId);
    this.event('conquest', `${k.name} has conquered ${t.name}!${tr ? ` ${this.fullName(tr)} falls.` : ''}`, { k: k.id, k2: t.id, x: t.x, z: t.z });
    k.history.push(`Year ${calendar(this.time).year}: conquered ${t.name}.`);
    // the defeated royals are executed or flee; the people submit
    for (const id of [...t.members]) {
      const p = this.byId.get(id); if (!p) continue;
      if (p.id === t.rulerId || p.role === ROLE.CONSORT || p.role === ROLE.GENERAL) {
        if (r() < 0.75) { this.die(p, `was executed by the conquerors of ${k.name}`); continue; }
      }
      t.members.delete(p.id); p.kingdom = k.id; k.members.add(p.id);
      p.role = p.role === ROLE.RULER ? ROLE.COMMONER : ROLE.COMMONER; p.soldier = false;
      p.loyalty = 0.2 + r() * 0.25;
      p.task = { type: 'migrate', dest: k.id, t: 0, phase: 0 };
      p.thought = `Taken captive by ${k.name}`;
    }
    k.food += t.food * 0.8; k.minerals += t.minerals; k.armory += t.armory * 0.5;
    this.ruins.push({ x: Math.round(t.x), z: Math.round(t.z), name: t.name, tier: t.tier, year: calendar(this.time).year, color: t.color });
    if (this.ruins.length > 40) this.ruins.shift();
    this.removeKingdom(t, null);
    this.setCapital(k, `${k.name} conquers ${t.name}`);
    if (!k.atWar) k.army.state = 'return';
  }

  setCapital(k, why) {
    const prev = this.kingdoms.get(this.capitalId);
    if (prev && prev.id === k.id) { this.event('capital', `${k.name} remains the capital of the world.`, { k: k.id, minor: true }); return; }
    if (prev) prev.capital = false;
    k.capital = true; this.capitalId = k.id;
    this.event('capital', `${why}. ${k.name} is now the CAPITAL and superior realm of the world!`, { k: k.id, x: k.x, z: k.z });
    k.history.push(`Year ${calendar(this.time).year}: became the capital of the world.`);
    // the old coalition dissolves once its enemy is gone
    if (!prev || !this.kingdoms.has(prev.id)) {
      for (const o of this.kingdoms.values()) {
        if (!o.coalition) continue;
        o.coalition = false;
        for (const rel of o.rel.values()) if (rel.state === 'ally') rel.state = 'peace';
      }
    }
  }

  removeKingdom(k, text) {
    if (!this.kingdoms.has(k.id)) return;
    this.kingdoms.delete(k.id);
    if (text) this.event('fall', text, { k: k.id, x: k.x, z: k.z });
    for (const o of this.kingdoms.values()) {
      o.rel.delete(k.id);
      if (o.army.target === k.id && o.army.state !== 'none') o.army.state = 'return';
    }
    if (this.capitalId === k.id) this.capitalId = 0;
    for (const id of [...k.members]) { const p = this.byId.get(id); if (p && p.kingdom === k.id) p.kingdom = 0; }
    this.computeTerritory();
  }

  trySecession(k) {
    const r = this.rand;
    const members = [...k.members].map((id) => this.byId.get(id)).filter(Boolean);
    const fpc = k.food / Math.max(1, k.pop);
    const crowd = k.pop > 70 ? 0.3 : 0;
    const cands = members.filter((p) => p.ageY >= 20 && p.ageY < 55 && p.id !== k.rulerId && p.role !== ROLE.CONSORT && p.health > 50 &&
      ((p.genes.ambit > 0.66 && p.loyalty < 0.6) || (p.role === ROLE.ROYAL && p.genes.ambit > 0.5)));
    if (!cands.length || r() > 0.25 + crowd + (fpc < 2 ? 0.25 : 0)) return;
    cands.sort((a, b) => (b.genes.ambit - b.loyalty) - (a.genes.ambit - a.loyalty));
    const leader = cands[0];
    const site = this.findSite(k.x, k.z, 750, 1900, []);
    if (!site || site.score < 0.3) return;
    const culture = k.culture.derive(mulberry32((r() * 1e9) | 0));
    const nk = this.createKingdom(site, culture, k.id);
    nk.dynasty = leader.house = culture.house();
    const followers = new Set([leader.id]);
    const addFamily = (p) => {
      followers.add(p.id);
      const s = this.byId.get(p.spouseId); if (s && s.id !== k.rulerId) followers.add(s.id);
      for (const cid of p.children) { const c = this.byId.get(cid); if (c && !c.spouseId && c.ageY < 18) followers.add(c.id); }
    };
    addFamily(leader);
    const cap = Math.floor(k.pop * 0.42);
    for (const p of members) {
      if (followers.size >= cap) break;
      if (followers.has(p.id) || p.id === k.rulerId || p.role === ROLE.CONSORT || p.ageY < 16) continue;
      if (p.loyalty < 0.55 && r() < 0.3 + leader.genes.ambit * 0.3 + (fpc < 2 ? 0.2 : 0)) addFamily(p);
    }
    if (followers.size < 4) { this.kingdoms.delete(nk.id); return; }
    const share = followers.size / Math.max(1, k.pop);
    nk.food = k.food * share; k.food -= nk.food;
    for (const id of followers) {
      const p = this.byId.get(id); if (!p) continue;
      k.members.delete(id); p.kingdom = nk.id; nk.members.add(id);
      p.soldier = false; p.role = ROLE.COMMONER; p.loyalty = 0.6 + r() * 0.35;
      p.task = { type: 'migrate', dest: nk.id, t: 0, phase: 0 }; p.thought = `Following ${leader.name} to found ${nk.name}`;
    }
    nk.rulerId = leader.id; leader.role = ROLE.RULER; nk.monarchs = 1;
    const sp = this.byId.get(leader.spouseId); if (sp && sp.kingdom === nk.id) sp.role = ROLE.CONSORT;
    for (const cid of leader.children) { const c = this.byId.get(cid); if (c && c.kingdom === nk.id) c.role = ROLE.ROYAL; }
    this.addHouse(nk); this.addHouse(nk);
    const rel = nk.relOf(k.id), back = k.relOf(nk.id);
    back.grudge = 0.35 + r() * 0.3; rel.grudge = 0.15; rel.truceUntil = back.truceUntil = this.realTime + 240;
    this.event('secession', `${leader.name} breaks away from ${k.name} with ${followers.size} followers and founds the Kingdom of ${nk.name}!`, { k: nk.id, k2: k.id, x: nk.x, z: nk.z });
    nk.history.push(`Year ${calendar(this.time).year}: founded by ${leader.name}, who broke away from ${k.name}.`);
    k.history.push(`Year ${calendar(this.time).year}: ${leader.name} broke away to found ${nk.name}.`);
    this.updateKingdomStats(); this.computeTerritory();
  }

  // ---------------------------------------------------------------- serialization
  encodeAgents() {
    const ppl = this.people;
    const buf = Buffer.alloc(16 + ppl.length * AGENT_BYTES);
    buf.writeUInt8(MSG_AGENTS, 0);
    buf.writeUInt32LE(ppl.length, 4);
    buf.writeDoubleLE(this.realTime, 8);
    let o = 16;
    const q = (v) => Math.max(0, Math.min(65535, Math.round(((v + HALF) / WORLD_SIZE) * 65535)));
    for (const p of ppl) {
      buf.writeUInt32LE(p.id, o);
      buf.writeUInt16LE(q(p.x), o + 4); buf.writeUInt16LE(q(p.z), o + 6);
      buf.writeUInt16LE(p.kingdom, o + 8);
      buf.writeUInt8(p.state, o + 10);
      const ag = p.ageY < 3 ? 0 : p.ageY < 14 ? 1 : p.ageY < 60 ? 2 : 3;
      const role = p.role === ROLE.RULER ? 2 : p.role === ROLE.CONSORT ? 3 : p.role === ROLE.ROYAL ? 4 : p.role === ROLE.GENERAL ? 5 : p.soldier ? 1 : 0;
      buf.writeUInt8((p.sex === 'F' ? 1 : 0) | (ag << 1) | (role << 3) | (p.pregnant ? 64 : 0) | (p.carry > 0.5 || p.carryMin > 0.5 ? 128 : 0), o + 11);
      buf.writeUInt8(Math.max(0, Math.min(255, Math.round(p.health * 2.55))), o + 12);
      buf.writeUInt8(Math.round(((p.heading % 6.2832 + 6.2832) % 6.2832) / 6.2832 * 255), o + 13);
      buf.writeUInt8((p.sick > 0 ? 1 : 0) | (p.carryMin > 0.5 ? 2 : 0) | (moodOf(this, p) << 2) | (p.task?.type === 'talk' ? 32 : 0) | (p.task?.type === 'sleep' && p.task.phase === 1 ? 64 : 0) | (p.task?.type === 'throne' && p.task.phase === 1 ? 128 : 0), o + 14);
      buf.writeUInt8(Math.min(255, Math.floor(p.ageY * 2)), o + 15);
      o += AGENT_BYTES;
    }
    return buf;
  }

  encodeLand() {
    const ids = this.ownerIds || [];
    const head = 8 + ids.length * 2;
    const buf = Buffer.alloc(head + OWN * OWN + N);
    buf.writeUInt8(MSG_LAND, 0); buf.writeUInt16LE(ids.length, 2); buf.writeUInt16LE(OWN, 4); buf.writeUInt16LE(GRID, 6);
    ids.forEach((id, i) => buf.writeUInt16LE(id, 8 + i * 2));
    Buffer.from(this.owner.buffer).copy(buf, head);
    const o = head + OWN * OWN;
    for (let c = 0; c < N; c++) buf[o + c] = Math.min(255, Math.round(this.cult[c] * 255));
    return buf;
  }

  snapshot(sinceEvent) {
    const cal = calendar(this.time);
    const ks = [];
    for (const k of this.kingdoms.values()) {
      const ruler = this.byId.get(k.rulerId);
      const rel = { war: [], ally: [] };
      for (const [id, r] of k.rel) if (r.state === 'war') rel.war.push(id); else if (r.state === 'ally') rel.ally.push(id);
      ks.push({
        id: k.id, name: k.name, color: k.color, x: Math.round(k.x), z: Math.round(k.z), r: Math.round(k.radius), pop: k.pop,
        men: k.men, women: k.women, kids: k.kids, soldiers: k.soldiers, fighters: k.fighters,
        food: Math.round(k.food), minerals: Math.round(k.minerals), power: +k.power.toFixed(1), nourish: +k.nourish.toFixed(2),
        tier: k.tier, rot: k.rot, capital: k.capital, ruler: ruler ? { id: ruler.id, name: this.fullName(ruler) } : null, dynasty: k.dynasty,
        war: rel.war, ally: rel.ally, hv: k.housesVer, houses: k.houses, well: k.hasWell, coalition: k.coalition,
        army: k.army.state === 'none' ? null : { s: k.army.state, x: Math.round(k.army.fx), z: Math.round(k.army.fz), t: k.army.target },
        tension: [...k.rel.entries()].filter(([id, r]) => this.kingdoms.has(id) && (r.tension || 0) > 25).map(([id, r]) => [id, Math.round(r.tension)]),
        siege: Math.round(k.siege || 0), wins: k.wins, losses: k.losses, parent: k.parentId, defense: k.defense,
      });
    }
    const ev = this.events.filter((e) => e.id > sinceEvent);
    return {
      t: 'state', time: this.time, rt: this.realTime, hps: this.hps, cal, capital: this.capitalId, day: this.dayClock, dayS: this.daySeconds,
      pop: this.people.length, stats: this.stats, kingdoms: ks, storms: this.weather.serialize(),
      strikes: this.weather.strikes.slice(), wind: { x: +this.weather.wind.x.toFixed(2), z: +this.weather.wind.z.toFixed(2), s: +this.weather.wind.base.toFixed(1) },
      events: ev, fx: this.fx.splice(0), ruins: this.ruins, talks: this.talks.filter((c) => this.realTime - c.t < 25),
    };
  }

  inspectPerson(id) {
    const p = this.byId.get(id); if (!p) return { t: 'inspect', kind: 'person', id, gone: true };
    const nm = (pid) => { const q = this.byId.get(pid); return q ? { id: q.id, name: this.fullName(q) } : null; };
    const k = this.kingdoms.get(p.kingdom);
    return {
      t: 'inspect', kind: 'person', id: p.id, name: p.name, title: this.title(p), house: p.house, sex: p.sex, age: +p.ageY.toFixed(1),
      kingdom: k ? { id: k.id, name: k.name, color: k.color } : null, gen: p.gen,
      health: Math.round(p.health), satiety: +p.satiety.toFixed(2), hydration: +p.hydration.toFixed(2), energy: +p.energy.toFixed(2),
      nourish: +p.nourish.toFixed(2), strength: +this.strength(p).toFixed(2), loyalty: +p.loyalty.toFixed(2),
      genes: Object.fromEntries(Object.entries(p.genes).map(([a, b]) => [a, +b.toFixed(2)])),
      state: STATE_NAMES[p.state], thought: p.thought, soldier: p.soldier, kills: p.kills, sick: p.sick > 0,
      pregnant: !!p.pregnant, spouse: nm(p.spouseId), father: nm(p.fatherId), mother: nm(p.motherId),
      children: p.children.map(nm).filter(Boolean), childrenTotal: p.children.length, carrying: +p.carry.toFixed(1),
      x: Math.round(p.x), z: Math.round(p.z),
      memories: (p.mem || []).slice(-6).reverse().map((m) => `Year ${m.y}: ${m.text}`),
      relations: Object.entries(p.ops || {}).map(([id, v]) => [this.byId.get(+id), v]).filter(([q, v]) => q && Math.abs(v) >= 15)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6).map(([q, v]) => ({ id: q.id, name: this.fullName(q), v: Math.round(v), label: q.id === p.spouseId ? (v < -20 ? 'Spouse (bitter)' : 'Spouse') : q.id === p.affair ? 'Secret lover' : q.id === p.lover ? 'Lover' : v >= 40 ? 'Close friend' : v >= 15 ? 'Friend' : v <= -40 ? 'Hated rival' : 'Rival' })),
      secret: p.affair ? `Having a secret affair with ${this.byId.get(p.affair)?.name || 'someone'}` : this.plots.some((x) => x.owner === p.id) ? 'Plotting against the crown' : this.plots.some((x) => x.agents.includes(p.id)) ? 'Part of a conspiracy against the crown' : null,
      wakeHour: p.wake,
    };
  }

  inspectKingdom(id) {
    const k = this.kingdoms.get(id); if (!k) return { t: 'inspect', kind: 'kingdom', id, gone: true };
    const nm = (pid) => { const q = this.byId.get(pid); return q ? { id: q.id, name: this.fullName(q), age: Math.floor(q.ageY) } : null; };
    const royals = [...k.members].map((pid) => this.byId.get(pid)).filter((p) => p && (p.role === ROLE.ROYAL || p.role === ROLE.CONSORT)).slice(0, 14).map((p) => nm(p.id));
    const rels = [...k.rel.entries()].filter(([oid]) => this.kingdoms.has(oid)).map(([oid, r]) => ({
      id: oid, name: this.kingdoms.get(oid).name, color: this.kingdoms.get(oid).color, state: r.state, ourDead: r.ourDead, theirDead: r.theirDead,
      truce: r.truceUntil > this.realTime, tribute: !!(r.tribute && r.tributeUntil > this.realTime),
    }));
    const parent = this.kingdoms.get(k.parentId);
    const cal = calendar(k.founded);
    const champion = [...k.members].map((pid) => this.byId.get(pid)).filter(Boolean).sort((a, b) => b.kills - a.kills)[0];
    return {
      t: 'inspect', kind: 'kingdom', id: k.id, name: k.name, color: k.color, dynasty: k.dynasty, capital: k.capital, ruler: nm(k.rulerId),
      general: k.army.state !== 'none' ? nm(k.generalId) : null, royals, pop: k.pop, men: k.men, women: k.women, kids: k.kids,
      soldiers: k.soldiers, fighters: k.fighters, food: Math.round(k.food), minerals: Math.round(k.minerals), armory: Math.round(k.armory),
      weapon: +k.weaponLevel.toFixed(2), power: +k.power.toFixed(1), nourish: +k.nourish.toFixed(2), houses: k.houses.length, tier: k.tier,
      founded: `Year ${cal.year}, ${cal.seasonName}`, parent: parent ? { id: parent.id, name: parent.name } : null,
      relations: rels, army: k.army.state, armyTarget: this.kingdoms.get(k.army.target)?.name || null, wins: k.wins, losses: k.losses,
      conquests: k.conquests, monarchs: k.monarchs, kills: k.kills, deaths: k.deaths, history: k.history.slice(-14),
      champion: champion && champion.kills > 0 ? { id: champion.id, name: this.fullName(champion), kills: champion.kills } : null,
      well: k.hasWell, x: Math.round(k.x), z: Math.round(k.z),
      tensions: [...k.rel.entries()].filter(([oid]) => this.kingdoms.has(oid)).map(([oid, r]) => ({ id: oid, name: this.kingdoms.get(oid).name, t: Math.round(r.tension || 0), cb: r.cb || null })).sort((a, b) => b.t - a.t),
    };
  }
}
