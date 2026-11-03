// Save and restore the entire living world so restarts, deploys and spin-downs continue the same timeline.
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { Person, Kingdom, ids } from './simulation.js';
import { Culture } from './names.js';
import { ensurePersona } from './social.js';
import { mulberry32 } from '../../shared/noise.js';

const VERSION = 1;
const f32 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const unf32 = (s, target) => { const b = Buffer.from(s, 'base64'); target.set(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)); };

export function serialize(sim) {
  const people = sim.people.filter((p) => p.alive).map((p) => {
    const o = { ...p }; delete o._vis; return o;
  });
  const kingdoms = [...sim.kingdoms.values()].map((k) => {
    const o = { ...k };
    o.members = [...k.members];
    o.rel = [...k.rel.entries()];
    o.culture = { on: k.culture.on, mid: k.culture.mid, me: k.culture.me, fe: k.culture.fe };
    delete o._dT; delete o._dr;
    return o;
  });
  const data = {
    v: VERSION, savedAt: Date.now(), seed: sim.seed, time: sim.time, realTime: sim.realTime, ids: ids.get(),
    people, kingdoms, events: sim.events.slice(-250), eventSeq: sim.eventSeq, ruins: sim.ruins, stats: sim.stats,
    capitalId: sim.capitalId, seconds: sim.seconds, talkSeq: sim.talkSeq, dayClock: sim.dayClock,
    secrets: sim.secrets, secretSeq: sim.secretSeq, plots: sim.plots, ravens: sim.ravens,
    weather: { storms: sim.weather.storms, nextId: sim.weather.nextId, windAngle: sim.weather.windAngle },
    food: f32(sim.food), cult: f32(sim.cult), minLeft: f32(sim.minLeft), dynBias: f32(sim.dynBias),
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 6 });
}

export function restorer(buf) {
  const d = JSON.parse(zlib.gunzipSync(buf).toString());
  if (d.v !== VERSION) throw new Error('snapshot version mismatch');
  return (sim) => {
    sim.time = d.time; sim.realTime = d.realTime;
    ids.set(d.ids);
    for (const k0 of d.kingdoms) {
      const k = Object.create(Kingdom.prototype);
      Object.assign(k, k0);
      k.members = new Set(k0.members);
      k.rel = new Map(k0.rel);
      const c = new Culture(mulberry32((Math.random() * 1e9) | 0));
      Object.assign(c, k0.culture); c.r = sim.rand;
      k.culture = c;
      sim.kingdoms.set(k.id, k);
    }
    for (const p0 of d.people) {
      const p = Object.create(Person.prototype);
      Object.assign(p, p0);
      sim.people.push(p); sim.byId.set(p.id, p);
    }
    sim.events = d.events; sim.eventSeq = d.eventSeq; sim.ruins = d.ruins; sim.stats = d.stats;
    sim.capitalId = d.capitalId; sim.seconds = d.seconds || 0; sim.talkSeq = d.talkSeq || 0;
    if (d.dayClock !== undefined) sim.dayClock = d.dayClock;
    sim.secrets = d.secrets || []; sim.secretSeq = d.secretSeq || 0; sim.plots = d.plots || []; sim.ravens = d.ravens || [];
    for (const p of sim.people) ensurePersona(p, sim.rand);
    sim.weather.storms = d.weather.storms; sim.weather.nextId = d.weather.nextId; sim.weather.windAngle = d.weather.windAngle;
    unf32(d.food, sim.food); unf32(d.cult, sim.cult); unf32(d.minLeft, sim.minLeft); unf32(d.dynBias, sim.dynBias);
    const away = Math.round((Date.now() - d.savedAt) / 1000);
    sim.event('resume', `The world stirs again after a pause of ${away < 120 ? away + ' seconds' : Math.round(away / 60) + ' minutes'}. History continues.`, { minor: true });
    sim.updateKingdomStats(); sim.computeTerritory();
    console.log(`[save] restored world: year ${Math.floor(d.time / 8760) + 1}, ${d.people.length} people, ${d.kingdoms.length} kingdoms`);
  };
}

// ---- storage backends: Redis (Render Key Value) if REDIS_URL is set, plus a local file
export async function createStore() {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'world.sav');
  let redis = null;
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import('redis');
      redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
      redis.on('error', (e) => console.warn('[save] redis error:', e.message));
      await redis.connect();
      console.log('[save] connected to Redis');
    } catch (e) { console.warn('[save] Redis unavailable, using file only:', e.message); redis = null; }
  }
  const KEY = 'my-world:snapshot';
  return {
    async load() {
      if (redis) {
        try { const b = await redis.get(redis.commandOptions({ returnBuffers: true }), KEY); if (b) return b; } catch (e) { console.warn('[save] redis load failed', e.message); }
      }
      try { return fs.readFileSync(file); } catch { return null; }
    },
    async save(buf) {
      if (redis) { try { await redis.set(KEY, buf); } catch (e) { console.warn('[save] redis save failed', e.message); } }
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file); } catch (e) { console.warn('[save] file save failed', e.message); }
    },
    kind: redis ? 'redis+file' : 'file',
  };
}
