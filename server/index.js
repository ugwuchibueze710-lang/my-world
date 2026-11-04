// Neon Hive server: runs the hive, streams its state to every viewer, and takes the player's answers.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Hive } from './hive.js';
import { createStore } from './store.js';
import { aiStatus } from './llm.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const store = await createStore();
const saved = process.env.FRESH_HIVE === '1' ? null : await store.load();
const hive = new Hive(saved);
console.log(`[hive] ${saved ? `resumed at level ${hive.level} with ${hive.agents.length} minds` : 'a single mind awakens'} (saves: ${store.kind})`);

const app = express();
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/healthz', (req, res) => res.json({ ok: true, level: hive.level, minds: hive.agents.length, stats: hive.stats, viewers: hive.viewers, saves: store.kind, ai: aiStatus() }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let lastEvent = 0;
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ ...hive.view(0), full: true }));
  let lastAns = 0;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'answer' && typeof m.text === 'string' && m.text.trim()) {
      if (Date.now() - lastAns < 1500) return; lastAns = Date.now(); // no spamming
      const r = hive.playerAnswer(m.text.trim().slice(0, 80), String(m.name || 'Player').replace(/[^\w -]/g, '').slice(0, 16) || 'Player');
      ws.send(JSON.stringify({ t: 'answerResult', ...r }));
    }
  });
});
setInterval(() => {
  hive.viewers = wss.clients.size;
  hive.tick(1);
  const v = hive.view(lastEvent);
  lastEvent = hive.eventSeq;
  const msg = JSON.stringify(v);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, 1000);

const saveNow = () => store.save(hive.save());
setInterval(saveNow, 30000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await saveNow(); process.exit(0); });
server.listen(PORT, () => console.log(`[http] listening on :${PORT}`));
