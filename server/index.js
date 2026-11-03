// HTTP + WebSocket server. The simulation runs here continuously, independent of viewers.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Simulation } from './sim/simulation.js';
import { serialize, restorer, createStore } from './sim/persist.js';
import { DEFAULT_HOURS_PER_SECOND } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const HPS = Number(process.env.HOURS_PER_SECOND) || DEFAULT_HOURS_PER_SECOND;
const SEED = Number(process.env.WORLD_SEED) || 20261103;
const MAX_POP = Number(process.env.MAX_POPULATION) || 4000;
const TICK_MS = 100;

// ---- load the saved timeline if there is one
const store = await createStore();
let restore = null;
if (process.env.FRESH_WORLD !== '1') {
  try { const buf = await store.load(); if (buf) restore = restorer(buf); } catch (e) { console.warn('[save] could not read save, starting fresh:', e.message); }
}
const sim = new Simulation({ seed: SEED, hoursPerSecond: HPS, maxPopulation: MAX_POP, restore });
console.log(`[sim] ${restore ? 'resumed' : 'started new world'}: seed=${SEED}, 1 real second = ${HPS} world hour(s), saves: ${store.kind}`);
let saving = false;
async function saveNow(reason) {
  if (saving) return; saving = true;
  try { const t0 = Date.now(); const buf = serialize(sim); await store.save(buf); console.log(`[save] ${reason}: ${(buf.length / 1024).toFixed(0)} KB in ${Date.now() - t0} ms`); }
  catch (e) { console.error('[save] failed', e); }
  saving = false;
}
setInterval(() => saveNow('autosave'), (Number(process.env.SAVE_SECONDS) || 45) * 1000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { console.log(`[save] ${sig}: saving before exit`); await saveNow('shutdown'); process.exit(0); });

const app = express();
app.disable('x-powered-by');
// always revalidate our own files so every deploy shows up immediately
const fresh = { maxAge: 0, etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
app.use(express.static(path.join(ROOT, 'public'), fresh));
app.use('/shared', express.static(path.join(ROOT, 'shared'), fresh));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.get('/healthz', (req, res) => res.json({ ok: true, pop: sim.people.length, kingdoms: sim.kingdoms.size, time: sim.time }));
app.get('/api/stats', (req, res) => res.json({ pop: sim.people.length, kingdoms: sim.kingdoms.size, stats: sim.stats, tickMs: +tickCost.toFixed(2) }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 2048 } });

wss.on('connection', (ws) => {
  ws.lastEvent = Math.max(0, sim.eventSeq - 60);
  ws.send(JSON.stringify({ t: 'init', seed: SEED, hps: HPS, time: sim.time, rt: sim.realTime }));
  ws.send(sim.encodeLand());
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'inspect') {
      const out = m.kind === 'kingdom' ? sim.inspectKingdom(m.id) : sim.inspectPerson(m.id);
      out.req = m.req;
      ws.send(JSON.stringify(out));
    }
  });
});

// ---- simulation loop (runs whether or not anyone is watching)
let last = performance.now(), tickCost = 0, sendT = 0, stateT = 0, landT = 0, lastLand = -1;
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const t0 = performance.now();
  try { sim.tick(dt); } catch (err) { console.error('[sim] tick error', err); }
  tickCost = tickCost * 0.95 + (performance.now() - t0) * 0.05;
  if (!wss.clients.size) { sim.fx.length = 0; return; }
  sendT += dt; stateT += dt; landT += dt;
  if (sendT >= 0.25) {
    sendT = 0;
    const buf = sim.encodeAgents();
    for (const ws of wss.clients) if (ws.readyState === 1 && ws.bufferedAmount < 3e6) ws.send(buf);
  }
  if (stateT >= 1) {
    stateT = 0;
    const minEvent = Math.min(...[...wss.clients].map((w) => w.lastEvent));
    const snap = sim.snapshot(minEvent);
    const all = snap.events;
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      snap.events = all.filter((e) => e.id > ws.lastEvent);
      ws.lastEvent = sim.eventSeq;
      ws.send(JSON.stringify(snap));
    }
  }
  if (landT >= 5 && sim.landVersion !== lastLand) {
    landT = 0; lastLand = sim.landVersion;
    const buf = sim.encodeLand();
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send(buf);
  }
}, TICK_MS);

setInterval(() => {
  console.log(`[sim] year ${Math.floor(sim.time / 8760) + 1} | pop ${sim.people.length} | kingdoms ${sim.kingdoms.size} | births ${sim.stats.births} deaths ${sim.stats.deaths} | tick ${tickCost.toFixed(1)}ms`);
}, 60000);

server.listen(PORT, () => console.log(`[http] listening on :${PORT}`));
