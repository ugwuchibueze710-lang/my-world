// Independent, unplanned weather. Storms spawn at random, drift, grow, fade, and hurt or kill people.
import { calendar, seasonalOffset } from '../../shared/constants.js';
import { HALF } from '../../shared/world.js';

const DEF = {
  rain:         { r: [450, 950],  life: [70, 170],  spd: [3, 9] },
  thunderstorm: { r: [300, 650],  life: [50, 120],  spd: [5, 12] },
  snow:         { r: [500, 1000], life: [80, 180],  spd: [2, 7] },
  blizzard:     { r: [450, 900],  life: [60, 140],  spd: [6, 13] },
  hurricane:    { r: [750, 1250], life: [170, 280], spd: [7, 13] },
  tornado:      { r: [35, 70],    life: [25, 60],   spd: [12, 22] },
  drought:      { r: [800, 1600], life: [200, 420], spd: [0.5, 2] },
  heatwave:     { r: [1000, 2000],life: [90, 200],  spd: [1, 3] },
  windstorm:    { r: [800, 1400], life: [60, 140],  spd: [9, 16] },
  wildfire:     { r: [25, 25],    life: [70, 200],  spd: [0.4, 1.6] },
  flood:        { r: [260, 460],  life: [45, 90],   spd: [0, 0] },
  plague:       { r: [200, 200],  life: [140, 320], spd: [0, 0] },
};
export const WEATHER_TYPES = Object.keys(DEF);
const rr = (r, [a, b]) => a + (b - a) * r();

export class Weather {
  constructor(sim) {
    this.sim = sim; this.world = sim.world; this.r = sim.rand;
    this.storms = []; this.nextId = 1;
    this.wind = { x: 1, z: 0.3, base: 4 };
    this.windAngle = this.r() * Math.PI * 2;
    this.strikes = [];      // lightning strikes this second (for the client)
    this.acc = 0;
  }

  tempAt(x, z) {
    const c = this.world.cellIndex(x, z);
    let t = (c >= 0 ? this.world.temp[c] : 10) + seasonalOffset(calendar(this.sim.time).yearFrac);
    for (const s of this.storms) {
      if (s.type !== 'heatwave' && s.type !== 'blizzard' && s.type !== 'snow') continue;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r) t += (s.type === 'heatwave' ? 9 : -7) * s.i * (1 - d / s.r);
    }
    return t;
  }

  randomLand(tries = 60) {
    for (let k = 0; k < tries; k++) {
      const x = (this.r() * 2 - 1) * HALF * 0.85, z = (this.r() * 2 - 1) * HALF * 0.85;
      if (this.world.isLand(x, z)) return [x, z];
    }
    return [0, 0];
  }

  spawn(type, x, z, extra = {}) {
    const d = DEF[type];
    const ang = this.windAngle + (this.r() - 0.5) * 1.2;
    const spd = rr(this.r, d.spd);
    const s = {
      id: this.nextId++, type, x, z, r: rr(this.r, d.r), life: rr(this.r, d.life), age: 0, i: 0,
      peak: 0.6 + this.r() * 0.4, vx: Math.cos(ang) * spd, vz: Math.sin(ang) * spd, ...extra,
    };
    this.storms.push(s);
    const name = { hurricane: 'A hurricane', tornado: 'A tornado', blizzard: 'A blizzard', drought: 'A drought',
      plague: 'A plague', wildfire: 'A wildfire', flood: 'A flood', heatwave: 'A heatwave', windstorm: 'A violent windstorm' }[type];
    if (name) this.sim.event('weather', `${name} has formed${this.sim.placeName(x, z)}.`, { x, z, storm: type });
    return s;
  }

  update(dt) {
    const sim = this.sim, r = this.r;
    const cal = calendar(sim.time);
    this.windAngle += (r() - 0.5) * 0.02 * dt;
    let gust = 0;
    for (const s of this.storms) if (s.type === 'windstorm' || s.type === 'hurricane') gust = Math.max(gust, s.i);
    this.wind.base = 3 + 2 * Math.sin(sim.realTime * 0.01) + gust * 14;
    this.wind.x = Math.cos(this.windAngle); this.wind.z = Math.sin(this.windAngle);

    // --- random spawns (per second probabilities) ---
    this.acc += dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.strikes.length = 0;
      const n = this.storms.length;
      const summer = cal.season === 1, winter = cal.season === 3, spring = cal.season === 0, autumn = cal.season === 2;
      if (n < 22) {
        if (r() < 1 / 38) { const [x, z] = this.randomLand(); this.spawn(this.tempAt(x, z) < 0.5 ? 'snow' : 'rain', x, z); }
        if (r() < (summer || spring ? 1 / 110 : 1 / 260)) { const [x, z] = this.randomLand(); if (this.tempAt(x, z) > 6) this.spawn('thunderstorm', x, z); }
        if (r() < (winter ? 1 / 40 : autumn ? 1 / 150 : 1 / 600)) { const [x, z] = this.randomLand(); if (this.tempAt(x, z) < 1.5) this.spawn('snow', x, z); }
        if (r() < (winter ? 1 / 170 : 1 / 2000)) { const [x, z] = this.randomLand(); if (this.tempAt(x, z) < -1) this.spawn('blizzard', x, z); }
        if (r() < (summer || autumn ? 1 / 700 : 1 / 5000)) this.spawnHurricane();
        if (r() < (spring || summer ? 1 / 420 : 1 / 3000)) { const [x, z] = this.randomLand(); if (this.tempAt(x, z) > 8) this.spawn('tornado', x, z); }
        if (r() < (summer ? 1 / 500 : 1 / 4000)) { const [x, z] = this.randomLand(); this.spawn('drought', x, z); }
        if (r() < (summer ? 1 / 450 : 1 / 6000)) { const [x, z] = this.randomLand(); this.spawn('heatwave', x, z); }
        if (r() < 1 / 320) { const [x, z] = this.randomLand(); this.spawn('windstorm', x, z); }
        if (r() < 1 / 1100 && sim.people.length > 40) this.spawnPlague();
      }
      // storm side-effects each second
      for (const s of this.storms) {
        if (s.type === 'thunderstorm' || s.type === 'hurricane') {
          const strikes = s.type === 'hurricane' ? 3 : 1 + (r() < 0.6 ? 1 : 0);
          for (let k = 0; k < strikes; k++) {
            if (r() > s.i) continue;
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s.r * 0.75;
            const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
            this.strikes.push([Math.round(x), Math.round(z)]);
            sim.lightning(x, z);
          }
        }
        if (s.type === 'rain' && s.i > 0.85 && r() < 0.004) {
          // torrential rain floods a river
          const c = this.world.cellIndex(s.x, s.z);
          if (c >= 0 && this.world.waterSrc[c] >= 0) {
            const wc = this.world.waterSrc[c], g = this.world.grid;
            const fx = this.world.cellX(wc % g), fz = this.world.cellX((wc / g) | 0);
            if (Math.hypot(fx - s.x, fz - s.z) < s.r && !this.storms.some((o) => o.type === 'flood' && Math.hypot(o.x - fx, o.z - fz) < 600)) this.spawn('flood', fx, fz);
          }
        }
        if (s.type === 'wildfire') {
          // fire spreads with dry forest and wind, dies in rain
          const c = this.world.cellIndex(s.x, s.z);
          const fuel = c >= 0 ? 0.3 + this.world.forest[c] : 0;
          s.r = Math.min(260, s.r + fuel * 3.2 * s.i);
          if (c < 0 || this.world.gh[c] <= 0.5) s.age = s.life;
        }
        if (s.type === 'plague') {
          const k = sim.kingdoms.get(s.kingdom);
          if (k) { s.x = k.x; s.z = k.z; s.r = k.radius; } else s.age = s.life;
        }
      }
      // rain puts out fires
      for (const f of this.storms) if (f.type === 'wildfire') {
        for (const s of this.storms) if ((s.type === 'rain' || s.type === 'thunderstorm' || s.type === 'hurricane') && Math.hypot(s.x - f.x, s.z - f.z) < s.r) f.age += 6;
      }
    }

    // --- move / age ---
    for (const s of this.storms) {
      s.age += dt;
      const t = s.age / s.life;
      s.i = s.peak * Math.min(1, Math.sin(Math.PI * Math.min(t, 1)) * 1.6);
      if (s.type === 'tornado') { // erratic path
        const a = Math.atan2(s.vz, s.vx) + (this.r() - 0.5) * 1.5 * dt;
        const sp = Math.hypot(s.vx, s.vz);
        s.vx = Math.cos(a) * sp; s.vz = Math.sin(a) * sp;
      }
      if (s.type === 'hurricane') {
        // weakens over land
        if (this.world.isLand(s.x, s.z)) s.age += dt * 0.35;
        s.rot = (s.rot || 0) + dt * 0.25;
      }
      if (s.type === 'wildfire') { s.vx = this.wind.x * (0.5 + this.wind.base * 0.08); s.vz = this.wind.z * (0.5 + this.wind.base * 0.08); }
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (Math.abs(s.x) > HALF * 1.3 || Math.abs(s.z) > HALF * 1.3) s.age = s.life;
    }
    this.storms = this.storms.filter((s) => s.age < s.life);
  }

  spawnHurricane() {
    // forms over warm southern/eastern ocean and drives inland
    for (let k = 0; k < 40; k++) {
      const a = (0.1 + this.r() * 0.8) * Math.PI; // south half arc
      const x = Math.cos(a) * HALF * 1.05, z = Math.sin(a) * HALF * 0.95;
      if (this.world.isLand(x, z)) continue;
      const s = this.spawn('hurricane', x, z);
      const toC = Math.atan2(-z + (this.r() - 0.5) * 2000, -x + (this.r() - 0.5) * 2000);
      const spd = Math.hypot(s.vx, s.vz);
      s.vx = Math.cos(toC) * spd; s.vz = Math.sin(toC) * spd; s.rot = 0;
      return;
    }
  }

  spawnPlague() {
    const ks = [...this.sim.kingdoms.values()].filter((k) => k.pop > 12);
    if (!ks.length) return;
    // dense, poorly nourished realms are more likely to be struck
    ks.sort((a, b) => (b.pop * (1.3 - b.nourish)) - (a.pop * (1.3 - a.nourish)));
    const k = ks[Math.floor(Math.pow(this.r(), 2) * ks.length)];
    if (this.storms.some((s) => s.type === 'plague' && s.kingdom === k.id)) return;
    this.spawn('plague', k.x, k.z, { kingdom: k.id, r: k.radius });
    let seeded = 0;
    for (const id of k.members) {
      const p = this.sim.byId.get(id);
      if (p && this.r() < 0.12) { p.sick = 45 + this.r() * 40; seeded++; }
    }
  }

  // Effects of all storms on a single person. Returns a shared scratch object.
  effectOn(p, dt, out) {
    out.slow = 1; out.danger = 0; out.dx = 0; out.dz = 0; out.from = null; out.dmg = 0; out.thirst = 1; out.cold = 0; out.cause = '';
    for (const s of this.storms) {
      const ddx = p.x - s.x, ddz = p.z - s.z;
      if (Math.abs(ddx) > s.r || Math.abs(ddz) > s.r) continue;
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      if (d > s.r) continue;
      const k = 1 - d / s.r, I = s.i;
      switch (s.type) {
        case 'rain': out.slow *= 1 - 0.12 * I; out.thirst *= 0.7; break;
        case 'thunderstorm': out.slow *= 1 - 0.18 * I; out.thirst *= 0.7; out.danger = Math.max(out.danger, 0.3 * I); out.from = s; break;
        case 'snow': out.slow *= 1 - 0.25 * I; out.cold += 0.25 * I; break;
        case 'blizzard': out.slow *= 1 - 0.55 * I; out.cold += 1.0 * I * (0.5 + k); out.danger = Math.max(out.danger, 0.8 * I); out.from = s; out.cause = 'froze to death in a blizzard'; break;
        case 'heatwave': out.thirst *= 1 + 1.4 * I; break;
        case 'drought': out.thirst *= 1 + 0.6 * I; break;
        case 'windstorm': {
          const f = I * k * 2.2 * dt;
          out.dx += this.wind.x * f; out.dz += this.wind.z * f; out.slow *= 1 - 0.3 * I;
          if (I > 0.6) { out.dmg += 0.25 * I * k * dt; out.cause = 'was crushed by debris in a windstorm'; }
          out.danger = Math.max(out.danger, 0.35 * I); out.from = s;
          break;
        }
        case 'hurricane': {
          // eye is calm; the eyewall is lethal
          const rn = d / s.r;
          const wall = rn < 0.12 ? 0.1 : Math.exp(-((rn - 0.3) * (rn - 0.3)) / 0.05);
          const tx = -ddz / (d || 1), tz = ddx / (d || 1);
          const f = I * wall * 9 * dt;
          out.dx += (tx * 0.85 + (ddx / (d || 1)) * 0.3) * f; out.dz += (tz * 0.85 + (ddz / (d || 1)) * 0.3) * f;
          out.dmg += I * wall * 1.6 * dt; out.slow *= 1 - 0.6 * I * wall;
          out.danger = Math.max(out.danger, I); out.from = s; out.cause = 'was swept away by a hurricane';
          break;
        }
        case 'tornado': {
          const tx = -ddz / (d || 1), tz = ddx / (d || 1);
          const f = I * k * 30 * dt;
          out.dx += tx * f + (ddx / (d || 1)) * f * 0.6; out.dz += tz * f + (ddz / (d || 1)) * f * 0.6;
          out.dmg += I * k * 30 * dt; out.danger = 1; out.from = s; out.cause = 'was thrown by a tornado';
          break;
        }
        case 'wildfire': out.dmg += I * (0.4 + k) * 9 * dt; out.danger = 1; out.from = s; out.cause = 'burned in a wildfire'; break;
        case 'flood': {
          const c = this.world.cellIndex(p.x, p.z);
          if (c >= 0 && this.world.rdist[c] <= 1) { out.dmg += I * (2 - this.world.rdist[c]) * 0.9 * dt; out.danger = 1; out.from = s; out.cause = 'drowned in a flood'; out.slow *= 0.5; }
          break;
        }
        case 'plague': break;
      }
    }
    // dangers from neighbouring storms (so people see them coming)
    if (!out.from) {
      for (const s of this.storms) {
        if (s.type !== 'tornado' && s.type !== 'wildfire' && s.type !== 'hurricane') continue;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < s.r + 120) { out.danger = Math.max(out.danger, 0.6); out.from = s; }
      }
    }
    return out;
  }

  // growth multiplier for crops/wild food in a world cell
  serialize() {
    return this.storms.map((s) => ({
      id: s.id, type: s.type, x: Math.round(s.x), z: Math.round(s.z), r: Math.round(s.r), i: +s.i.toFixed(2),
      vx: +s.vx.toFixed(1), vz: +s.vz.toFixed(1),
    }));
  }
}
