// Co-op rooms: up to 4 survivors per room code. The server owns room membership, the level,
// player life state (alive / downed / dead), dog tags and the revival-station schedule.
// The room "host" (first player, migrates on leave) simulates zombies and streams snapshots.
import { WebSocketServer } from 'ws';

const MAX = 4, TICK_MS = 50, STATION_EVERY = 300, STATION_OPEN = 45, BLEED_OUT = 30;
const rooms = new Map();
const code = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 31 | 0]).join(''); } while (rooms.has(c)); return c; };
const clean = (s, n = 16) => String(s || '').replace(/[^\w .-]/g, '').slice(0, n);
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

function bcast(room, m, except) { const s = JSON.stringify(m); for (const p of room.players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s); }
const roster = (room) => [...room.players.values()].map((p) => ({ id: p.id, name: p.name, skin: p.skin, life: p.life, host: p.id === room.host }));

function makeRoom() {
  const r = { code: code(), players: new Map(), host: null, level: 0, started: false, t: 0, tags: new Map(), tagSeq: 1,
    station: null, nextStation: 60, points: [], zsnap: null };
  rooms.set(r.code, r); return r;
}

function setHost(room) {
  const ids = [...room.players.keys()];
  room.host = ids.includes(room.host) ? room.host : ids[0] || null;
  bcast(room, { t: 'roster', players: roster(room), host: room.host });
}

function stationTick(room, dt) {
  if (!room.started || !room.points.length) return;
  room.nextStation -= dt;
  if (room.station) { room.station.left -= dt; if (room.station.left <= 0) { room.station = null; bcast(room, { t: 'station', station: null, next: room.nextStation }); } }
  if (room.nextStation <= 0) {
    const prev = room.station?.p; let p, tries = 0;
    do { p = room.points[Math.random() * room.points.length | 0]; } while (prev && p === prev && tries++ < 8);
    room.station = { p, left: STATION_OPEN }; room.nextStation = STATION_EVERY;
    bcast(room, { t: 'station', station: room.station, next: room.nextStation });
  }
}

function lifeTick(room, dt) {
  for (const p of room.players.values()) if (p.life === 'downed') {
    p.bleed -= dt * (p.reviver ? 0 : 1);
    if (p.reviver) { p.revive += dt; if (p.revive >= 4) { p.life = 'alive'; p.reviver = null; bcast(room, { t: 'life', id: p.id, life: 'alive', hp: 40 }); } }
    else if (p.bleed <= 0) kill(room, p);
  }
}

function kill(room, p) {
  p.life = 'dead'; p.reviver = null;
  const tag = { id: room.tagSeq++, owner: p.id, name: p.name, pos: p.pos.slice(0, 3), carrier: null };
  room.tags.set(tag.id, tag);
  bcast(room, { t: 'life', id: p.id, life: 'dead' }); bcast(room, { t: 'tag', tag });
  const alive = [...room.players.values()].filter((q) => q.life !== 'dead');
  if (!alive.length) { bcast(room, { t: 'wipe' }); room.started = false; }
}

function onMsg(ws, me, m) {
  const room = me.room;
  switch (m.t) {
    case 'create': case 'join': {
      if (room) return;
      let r = m.t === 'create' ? makeRoom() : rooms.get(clean(m.code, 4).toUpperCase());
      if (!r) return send(ws, { t: 'error', msg: 'No squad with that code' });
      if (r.players.size >= MAX) return send(ws, { t: 'error', msg: 'Squad is full (4/4)' });
      me.name = clean(m.name) || 'Survivor'; me.skin = clean(m.skin, 24) || 'player_swat'; me.room = r;
      r.players.set(me.id, me); setHost(r);
      send(ws, { t: 'joined', code: r.code, id: me.id, level: r.level, started: r.started, host: r.host, station: r.station, next: r.nextStation, tags: [...r.tags.values()] });
      bcast(r, { t: 'roster', players: roster(r), host: r.host });
      break;
    }
    case 'start': if (room && me.id === room.host) {
      room.level = m.level | 0; room.started = true; room.tags.clear(); room.station = null; room.nextStation = 60;
      room.points = Array.isArray(m.points) ? m.points.slice(0, 64).map((p) => p.slice(0, 3).map(Number)) : [];
      for (const p of room.players.values()) { p.life = 'alive'; p.reviver = null; }
      bcast(room, { t: 'start', level: room.level, seed: m.seed | 0, next: room.nextStation });
    } break;
    case 'level': if (room && me.id === room.host) {   // squad reached the exit
      room.level = m.level | 0; room.points = Array.isArray(m.points) ? m.points.slice(0, 64) : []; room.tags.clear(); room.station = null; room.nextStation = 60;
      for (const p of room.players.values()) { p.life = 'alive'; p.reviver = null; }     // everyone respawns at the next chapter
      bcast(room, { t: 'level', level: room.level, next: room.nextStation });
    } break;
    case 's': if (Array.isArray(m.p)) me.pos = m.p.slice(0, 3).map(Number); if (room) bcast(room, { ...m, t: 's', id: me.id }, ws); break; // player state 20 Hz
    case 'z': if (room && me.id === room.host) bcast(room, { t: 'z', z: m.z }, ws); break;   // zombie snapshot from host
    case 'hit': if (room) { const h = room.players.get(room.host); if (h && h !== me) send(h.ws, { t: 'hit', from: me.id, z: m.z, part: m.part, dmg: m.dmg, dir: m.dir, pt: m.pt }); } break;
    case 'zfx': if (room && me.id === room.host) bcast(room, { ...m, t: 'zfx' }, ws); break;
    case 'fx': if (room) bcast(room, { ...m, t: 'fx', from: me.id }, ws); break;   // props: barrels, alarms, lights   // limb loss / death fx from host
    case 'hurt': if (room) { const v = room.players.get(m.id); if (v) send(v.ws, { t: 'hurt', dmg: m.dmg, from: m.from }); } break;
    case 'shot': if (room) bcast(room, { t: 'shot', id: me.id, o: m.o, d: m.d }, ws); break;
    case 'down': if (room && me.life === 'alive') { me.life = 'downed'; me.bleed = BLEED_OUT; me.revive = 0; bcast(room, { t: 'life', id: me.id, life: 'downed', bleed: BLEED_OUT }); } break;
    case 'die': if (room && me.life !== 'dead') kill(room, me); break;
    case 'reviveStart': if (room) { const v = room.players.get(m.id); if (v && v.life === 'downed' && me.life === 'alive') { v.reviver = me.id; v.revive = 0; bcast(room, { t: 'reviving', id: v.id, by: me.id }); } } break;
    case 'reviveStop': if (room) { const v = room.players.get(m.id); if (v && v.reviver === me.id) { v.reviver = null; bcast(room, { t: 'reviving', id: v.id, by: null }); } } break;
    case 'grabTag': if (room) { const tag = room.tags.get(m.id); if (tag && !tag.carrier && me.life === 'alive') { tag.carrier = me.id; bcast(room, { t: 'tag', tag }); } } break;
    case 'redeem': if (room && room.station) {   // carrier at an open station brings the fallen back
      for (const tag of room.tags.values()) if (tag.carrier === me.id) {
        const p = room.players.get(tag.owner); room.tags.delete(tag.id);
        bcast(room, { t: 'tagGone', id: tag.id });
        if (p && p.life === 'dead') { p.life = 'alive'; bcast(room, { t: 'life', id: p.id, life: 'alive', hp: 100, at: room.station.p }); }
      }
    } break;
    case 'chat': if (room) bcast(room, { t: 'chat', id: me.id, name: me.name, msg: clean(m.msg, 120) }); break;
  }
}

function leave(me) {
  const room = me.room; if (!room) return;
  room.players.delete(me.id);
  for (const tag of room.tags.values()) if (tag.carrier === me.id) { tag.carrier = null; tag.pos = me.pos?.slice(0, 3) || tag.pos; bcast(room, { t: 'tag', tag }); }
  if (!room.players.size) { rooms.delete(room.code); return; }
  bcast(room, { t: 'left', id: me.id }); setHost(room);
}

export function attachRooms(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  let seq = 1;
  wss.on('connection', (ws) => {
    const me = { id: seq++, ws, name: 'Survivor', skin: 'player_swat', room: null, life: 'alive', pos: [0, 0, 0], bleed: 0, revive: 0, reviver: null };
    ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; } if (m && typeof m.t === 'string') onMsg(ws, me, m); });
    ws.on('close', () => leave(me));
    send(ws, { t: 'hello', id: me.id });
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping(); } } }, 15000);
  let last = Date.now();
  setInterval(() => { const now = Date.now(), dt = (now - last) / 1000; last = now;
    for (const r of rooms.values()) { r.t += dt; stationTick(r, dt); lifeTick(r, dt);
      if ((r.t * 2 | 0) !== ((r.t - dt) * 2 | 0)) bcast(r, { t: 'clock', next: r.nextStation, station: r.station, bleed: [...r.players.values()].filter((p) => p.life === 'downed').map((p) => [p.id, p.bleed, p.reviver ? p.revive : 0]) });
    } }, TICK_MS);
  return { rooms };
}
