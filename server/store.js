// Saves the hive so it continues after restarts and deploys: Redis (Render Key Value) when REDIS_URL is set, plus a local file.
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
export async function createStore() {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'siege.sav');
  let redis = null;
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import('redis');
      redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
      redis.on('error', (e) => console.warn('[save] redis error:', e.message));
      await redis.connect(); console.log('[save] connected to Redis');
    } catch (e) { console.warn('[save] Redis unavailable, using file only:', e.message); redis = null; }
  }
  const KEY = 'neon-siege:save';
  return {
    kind: redis ? 'redis+file' : 'file',
    async load() {
      let b = null;
      if (redis) { try { b = await redis.get(redis.commandOptions({ returnBuffers: true }), KEY); } catch {} }
      if (!b) { try { b = fs.readFileSync(file); } catch {} }
      if (!b) return null;
      try { return JSON.parse(zlib.gunzipSync(b).toString()); } catch { return null; }
    },
    async save(obj) {
      const b = zlib.gzipSync(JSON.stringify(obj));
      if (redis) { try { await redis.set(KEY, b); } catch (e) { console.warn('[save] redis save failed', e.message); } }
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', b); fs.renameSync(file + '.tmp', file); } catch {}
    },
  };
}
