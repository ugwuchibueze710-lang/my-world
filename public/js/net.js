// Thin co-op client over a WebSocket. Squads of up to 4 by room code; callsign only.
export class Net {
  constructor() { this.ws = null; this.id = 0; this.code = ''; this.host = 0; this.players = []; this.handlers = {}; this.connected = false; this.queue = []; }
  get isHost() { return !this.ws || this.host === this.id; }
  get online() { return !!this.ws && this.connected; }
  on(t, fn) { this.handlers[t] = fn; return this; }
  connect() {
    if (this.ws) return this.ready;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => { this.connected = true; res(); for (const m of this.queue) this.ws.send(m); this.queue = []; };
      this.ws.onerror = (e) => rej(e);
    });
    this.ws.onclose = () => { this.connected = false; this.handlers.closed?.(); };
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') this.id = m.id;
      if (m.t === 'joined') { this.code = m.code; this.id = m.id; this.host = m.host; }
      if (m.t === 'roster') { this.players = m.players; this.host = m.host; }
      this.handlers[m.t]?.(m);
    };
    return this.ready;
  }
  send(t, m = {}) { const s = JSON.stringify({ t, ...m }); if (!this.ws) return; if (this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s); }
  zfx(m) { if (this.online && this.isHost) this.send('zfx', m); }
  leave() { try { this.ws?.close(); } catch {} this.ws = null; this.connected = false; this.code = ''; this.players = []; this.host = 0; }
}
