// Neon Siege server: serves the game and keeps the global survival leaderboard.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStore } from './store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const store = await createStore();
let board = (await store.load())?.board || [];

const app = express();
app.use(express.json({ limit: '4kb' }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/healthz', (req, res) => res.json({ ok: true, scores: board.length, saves: store.kind }));
app.get('/api/scores', (req, res) => res.json(board.slice(0, 10)));
const last = new Map();
app.post('/api/score', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (Date.now() - (last.get(ip) || 0) < 5000) return res.status(429).json({ error: 'slow down' });
  last.set(ip, Date.now());
  const { name, time, kills, wave, headshots } = req.body || {};
  const t = Number(time), k = Number(kills), w = Number(wave);
  if (!(t > 0 && t < 36000 && k >= 0 && k < 100000 && w >= 1 && w < 1000)) return res.status(400).json({ error: 'bad score' });
  const entry = { name: String(name || 'Player').replace(/[^\w .-]/g, '').slice(0, 16) || 'Player', time: Math.round(t * 10) / 10, kills: k | 0, wave: w | 0, headshots: Number(headshots) | 0, at: Date.now() };
  board.push(entry); board.sort((a, b) => b.time - a.time || b.kills - a.kills); board = board.slice(0, 50);
  store.save({ board });
  res.json({ rank: board.indexOf(entry) + 1, top: board.slice(0, 10) });
});
app.listen(PORT, () => console.log(`[http] Neon Siege on :${PORT} (saves: ${store.kind})`));
