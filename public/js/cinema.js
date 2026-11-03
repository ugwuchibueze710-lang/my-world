// Movie mode: an automatic film director that watches a kingdom and cuts between cinematic shots —
// establishing wides, the king walking into frame, over-the-shoulder conversations, close-ups, battles, storms.
import * as THREE from 'three';
import { STATE } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Cinema {
  constructor(app) {
    this.app = app; this.active = false;
    this.cam = V(); this.look = V(); this.camS = V(); this.lookS = V();
    this.history = [];
    $('mv-god').onclick = () => this.stop();
    $('mv-next').onclick = () => this.nextShot(true);
    $('mv-info').onclick = () => { if (this.k) this.app.selectKingdom(this.k.id, false, true); document.body.classList.toggle('movie-info'); };
  }

  kingdom() { return this.app.state?.kingdoms.find((k) => k.id === this.kid); }

  start(kid) {
    this.kid = kid; this.k = this.kingdom();
    if (!this.k) return;
    this.active = true;
    this.app.follow = 0;
    this.app.controls.enabled = false;
    document.body.classList.add('movie');
    document.body.classList.remove('movie-info');
    const cal = this.app.state.cal;
    const ruler = this.k.ruler ? this.k.ruler.name : 'no ruler';
    $('mv-title').innerHTML = `<div class="t1">The Kingdom of ${this.k.name}</div><div class="t2">Year ${cal.year} · ${cal.seasonName} · ruled by ${ruler}</div>`;
    $('mv-title').classList.add('show');
    setTimeout(() => $('mv-title').classList.remove('show'), 4500);
    this.shot = null; this.history = [];
    this.nextShot(true, 'establish');
    this.app.audio.clearTalk();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('movie', 'movie-info');
    $('mv-sub').textContent = ''; $('mv-cap').textContent = '';
    this.app.controls.enabled = true;
    const k = this.kingdom();
    const c = this.app.controls;
    if (k) { c.target.set(k.x, this.app.world.heightAt(k.x, k.z), k.z); this.app.camera.position.set(k.x + 180, c.target.y + 220, k.z + 240); }
    this.app.people.selected = 0;
  }

  members() { return this.app.people.list.filter((a) => a.k === this.kid); }

  activeTalk() {
    const now = performance.now();
    let best = null;
    for (const t of this.app.talks.values()) {
      if (t.k !== this.kid || t.used || now > t.end - 1500) continue;
      const a = this.app.people.agents.get(t.a), b = this.app.people.agents.get(t.b);
      if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 6) continue;
      if (!best || t.start < best.start) best = t;
    }
    return best;
  }

  nextShot(cut = true, force) {
    const k = this.k = this.kingdom() || this.k;
    if (!k) { this.stop(); return; }
    const mem = this.members();
    const ruler = k.ruler ? this.app.people.agents.get(k.ruler.id) : null;
    const adults = mem.filter((a) => ((a.fl >> 1) & 3) >= 2);
    const movers = adults.filter((a) => a.mv && a.st !== STATE.REST);
    const fighters = mem.filter((a) => a.st === STATE.FIGHT);
    const talk = this.activeTalk();
    const storm = (this.app.state?.storms || []).find((s) => s.type !== 'rain' && s.type !== 'snow' && Math.hypot(s.x - k.x, s.z - k.z) < s.r + 1500);
    const last = this.history[this.history.length - 1];
    const options = [];
    if (talk) options.push(['talk', 6]);
    if (fighters.length) options.push(['battle', 5]);
    if (ruler) options.push(['walk', ruler.mv ? 3 : 1.5], ['closeup', 1.5]);
    if (movers.length) options.push(['walk', 2], ['track', 2]);
    if (adults.length) options.push(['closeup', 1]);
    options.push(['establish', 1.2], ['aerial', 0.8]);
    if (storm) options.push(['storm', 2]);
    if (k.army) options.push(['army', 2.5]);
    let type = force;
    if (!type) {
      const pool = options.filter(([t]) => t !== last || t === 'talk');
      let sum = pool.reduce((s, o) => s + o[1], 0), r = Math.random() * sum;
      for (const [t, w] of pool) { r -= w; if (r <= 0) { type = t; break; } }
      type = type || 'establish';
    }
    const pickSubject = (list) => (ruler && list.includes(ruler) && Math.random() < 0.5 ? ruler : list[Math.floor(Math.random() * list.length)]);
    const shot = { type, t: 0, dur: 7 + Math.random() * 3, seed: Math.random() };
    switch (type) {
      case 'talk': shot.talk = talk; talk.used = true; shot.dur = (talk.end - performance.now()) / 1000 + 0.8; break;
      case 'battle': shot.subject = fighters[Math.floor(Math.random() * fighters.length)]; shot.dur = 6; break;
      case 'walk': shot.subject = ruler && (ruler.mv || !movers.length) && Math.random() < 0.6 ? ruler : pickSubject(movers.length ? movers : adults); break;
      case 'track': shot.subject = pickSubject(movers.length ? movers : adults); break;
      case 'closeup': shot.subject = ruler && Math.random() < 0.55 ? ruler : pickSubject(adults); shot.dur = 5; break;
      case 'storm': shot.storm = storm; break;
      case 'army': shot.dur = 7; break;
    }
    if (['walk', 'track', 'closeup', 'battle'].includes(type) && !shot.subject) { shot.type = 'establish'; }
    this.shot = shot; this.history.push(shot.type); if (this.history.length > 6) this.history.shift();
    this.cutPending = cut;
    // caption
    let cap = '';
    const nm = (a) => this.app.nameOf(a.id);
    if (shot.subject) {
      cap = nm(shot.subject);
      this.app.people.selected = 0;
      this.app.requestThought(shot.subject.id, (d) => { if (this.shot === shot && d && !d.gone) $('mv-cap').innerHTML = `<b>${d.title ? d.title + ' ' : ''}${d.name}</b> — <i>“${d.thought}”</i>`; });
    } else if (shot.type === 'establish') cap = `${k.name} · ${k.pop} souls${k.capital ? ' · Capital of the World' : ''}`;
    else if (shot.type === 'aerial') cap = `The lands of ${k.name}`;
    else if (shot.type === 'storm') cap = `A ${shot.storm.type} looms over ${k.name}`;
    else if (shot.type === 'army') cap = `The army of ${k.name}${k.army?.s === 'siege' ? ' lays siege' : ' on the march'}`;
    else if (shot.type === 'talk') cap = '';
    $('mv-cap').innerHTML = cap ? `<b>${cap}</b>` : '';
  }

  head(a) { const s = ((a.fl >> 1) & 3) === 1 ? 0.75 : 1; return V(a.x, a.y + 1.68 * s, a.z); }

  update(dt) {
    if (!this.active) return;
    const sh = this.shot; if (!sh) return;
    sh.t += dt;
    const k = this.kingdom() || this.k;
    if (!k) { this.stop(); return; }
    const w = this.app.world, P = this.app.people.agents;
    const ground = (x, z) => Math.max(0, w.heightAt(x, z));
    const C = V(k.x, ground(k.x, k.z), k.z);
    let cam, look, smooth = 0.06;
    const subj = sh.subject ? P.get(sh.subject.id) : null;
    if (sh.subject && !subj) { this.nextShot(); return; }
    switch (sh.type) {
      case 'establish': {
        const a = sh.seed * 6.28 + sh.t * 0.045, R = 175 - sh.t * 3;
        cam = V(C.x + Math.cos(a) * R, C.y + 60 - sh.t * 1.5, C.z + Math.sin(a) * R); look = V(C.x, C.y + 14, C.z); break;
      }
      case 'aerial': {
        const a = sh.seed * 6.28, R = k.r * 1.2;
        cam = V(C.x + Math.cos(a) * R - Math.cos(a) * sh.t * 18, C.y + 260, C.z + Math.sin(a) * R - Math.sin(a) * sh.t * 18); look = C.clone(); break;
      }
      case 'walk': { // subject walks toward the lens
        const h = subj.hd, dist = Math.max(3.2, 9 - sh.t * 0.5);
        const f = V(Math.sin(h), 0, Math.cos(h));
        cam = this.head(subj).add(f.multiplyScalar(dist)).add(V(0, -0.15, 0)); look = this.head(subj).add(V(0, -0.2, 0)); smooth = 0.12; break;
      }
      case 'track': {
        const h = subj.hd, side = V(Math.cos(h), 0, -Math.sin(h)).multiplyScalar(sh.seed > 0.5 ? 5 : -5);
        cam = this.head(subj).add(side).add(V(0, 0.1, 0)); look = this.head(subj).add(V(0, -0.4, 0)); smooth = 0.1; break;
      }
      case 'closeup': {
        const h = subj.hd, f = V(Math.sin(h), 0, Math.cos(h)), side = V(Math.cos(h), 0, -Math.sin(h));
        cam = this.head(subj).add(f.multiplyScalar(1.15)).add(side.multiplyScalar(0.35)).add(V(0, 0.02, 0)); look = this.head(subj); smooth = 0.15; break;
      }
      case 'battle': {
        const a = sh.seed * 6.28 + sh.t * 0.15;
        cam = V(subj.x + Math.cos(a) * 10, subj.y + 1.4, subj.z + Math.sin(a) * 10); look = this.head(subj); smooth = 0.08; break;
      }
      case 'storm': {
        const s = sh.storm, dx = s.x - C.x, dz = s.z - C.z, L = Math.hypot(dx, dz) || 1;
        cam = V(C.x - (dx / L) * 60, C.y + 25, C.z - (dz / L) * 60); look = V(C.x + (dx / L) * 600, C.y + 250, C.z + (dz / L) * 600); break;
      }
      case 'army': {
        const ar = k.army; if (!ar) { this.nextShot(); return; }
        const gy = ground(ar.x, ar.z), a = sh.seed * 6.28 + sh.t * 0.06;
        cam = V(ar.x + Math.cos(a) * 45, gy + 8, ar.z + Math.sin(a) * 45); look = V(ar.x, gy + 2, ar.z); break;
      }
      case 'talk': {
        const t = sh.talk, now = performance.now();
        const A = P.get(t.a), B = P.get(t.b);
        if (!A || !B || now > t.end + 500) { this.nextShot(); return; }
        const li = Math.max(0, Math.min(t.lines.length - 1, Math.floor((now - t.start) / t.lineMs)));
        const speaker = P.get(t.lines[li].s) || A, listener = speaker === A ? B : A;
        if (li !== sh.li) { sh.li = li; this.cutPending = true; sh.wide = li === 0 && Math.random() < 0.4; }
        const hs = this.head(speaker), hl = this.head(listener);
        const dir = hs.clone().sub(hl).setY(0).normalize();
        const right = V(dir.z, 0, -dir.x);
        if (sh.wide) { const mid = hs.clone().add(hl).multiplyScalar(0.5); cam = mid.clone().add(right.clone().multiplyScalar(4.5)).add(V(0, 0.3, 0)); look = mid; }
        else { cam = hl.clone().sub(dir.clone().multiplyScalar(0.9)).add(right.multiplyScalar(0.42)).add(V(0, 0.16, 0)); look = hs.clone().add(V(0, -0.03, 0)); }
        smooth = 0.2;
        break;
      }
    }
    // never put the lens under the ground
    const gy = ground(cam.x, cam.z) + 0.6; if (cam.y < gy) cam.y = gy;
    if (this.cutPending) { this.camS.copy(cam); this.lookS.copy(look); this.cutPending = false; }
    else { this.camS.lerp(cam, smooth); this.lookS.lerp(look, smooth); }
    const c = this.app.camera;
    c.position.copy(this.camS); c.lookAt(this.lookS);
    this.app.controls.target.copy(this.lookS);
    if (sh.t > sh.dur) this.nextShot();
  }
}
