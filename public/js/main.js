// Entry point: connects to the living world on the server and renders it.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { createWorld, HALF } from '/shared/world.js';
import { MSG_AGENTS, MSG_LAND, seasonalOffset } from '/shared/constants.js';
import { Terrain } from './terrain.js';
import { Waters } from './water.js';
import { SkySystem } from './sky.js';
import { Vegetation } from './vegetation.js';
import { Buildings } from './buildings.js';
import { People } from './people.js';
import { WeatherFX } from './weather.js';
import { UI } from './ui.js';
import { AudioSys } from './audio.js';
import { Cinema } from './cinema.js';

const $ = (id) => document.getElementById(id);
const setLoad = (msg, pct) => { $('load-msg').textContent = msg; $('load-bar').style.width = pct + '%'; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

class App {
  constructor() {
    this.state = null; this.stateAt = 0; this.hps = 1; this.baseHours = 6; this.baseAt = performance.now();
    this.showTerritory = true; this.showLabels = true; this.follow = 0; this.selected = null;
    this.colorCache = new Map();
    this.req = 0;
    this.talks = new Map(); this.names = new Map(); this.thoughtCb = new Map();
    this.audio = new AudioSys();
    this.bootAt = performance.now();
    this.connect();
  }

  colorOf(id) {
    const k = this.state?.kingdoms.find((x) => x.id === id);
    const hex = k ? k.color : '#888888';
    let c = this.colorCache.get(hex); if (!c) { c = new THREE.Color(hex); this.colorCache.set(hex, c); }
    return c;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => $('conn').classList.add('hidden');
    ws.onclose = () => { $('conn').classList.remove('hidden'); setTimeout(() => this.connect(), 2000); };
    ws.onmessage = (e) => this.onMessage(e.data);
  }

  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }

  async onMessage(data) {
    if (data instanceof ArrayBuffer) {
      const view = new DataView(data);
      const type = view.getUint8(0);
      if (type === MSG_AGENTS) { if (this.people) this.people.ingest(view, performance.now()); }
      else if (type === MSG_LAND) { this.pendingLand = view; this.applyLand(); }
      return;
    }
    const m = JSON.parse(data);
    if (m.t === 'init') {
      this.hps = m.hps; this.baseHours = m.time; this.baseAt = performance.now();
      if (!this.world) await this.boot(m.seed);
    } else if (m.t === 'state') {
      this.state = m; this.baseHours = m.time; this.baseAt = performance.now(); this.hps = m.hps;
      this.onState(m);
    } else if (m.t === 'inspect') {
      if (m.name) this.names.set(m.id, (m.title ? m.title + ' ' : '') + m.name);
      const cb = this.thoughtCb.get(m.req);
      if (cb) { this.thoughtCb.delete(m.req); cb(m); return; }
      if (!this.ui.inspect || (this.ui.inspect.id === m.id && this.ui.inspect.kind === m.kind) || m.req === this.req) {
        if (m.kind === 'person') this.ui.showPerson(m); else this.ui.showKingdom(m);
      }
    }
  }

  applyLand() {
    const view = this.pendingLand;
    if (!view || !this.terrain || !this.state) return;
    this.pendingLand = null;
    const n = view.getUint16(2, true), own = view.getUint16(4, true), grid = view.getUint16(6, true);
    const ids = []; for (let i = 0; i < n; i++) ids.push(view.getUint16(8 + i * 2, true));
    const head = 8 + n * 2;
    const owner = new Uint8Array(view.buffer, head, own * own);
    const cult = new Uint8Array(view.buffer, head + own * own, grid * grid);
    this.terrain.setLand(owner, ids, cult, (id) => this.colorOf(id));
    this.ui.setOwner(owner, ids, (id) => this.colorOf(id));
    this.cult = cult;
    if (this.state) this.veg.setClearings(this.state.kingdoms, cult);
  }

  async boot(seed) {
    setLoad('Forging the continent…', 15); await nextFrame();
    this.world = createWorld(seed);
    setLoad('Raising mountains and carving rivers…', 40); await nextFrame();

    const canvas = $('scene');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.55;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 60000);
    this.camera.position.set(0, 5200, 5200);
    const c = this.controls = new MapControls(this.camera, canvas);
    c.enableDamping = true; c.dampingFactor = 0.08; c.screenSpacePanning = false;
    c.minDistance = 4; c.maxDistance = 9500; c.maxPolarAngle = Math.PI * 0.47; c.zoomToCursor = true; c.zoomSpeed = 1.2;
    c.target.set(0, 0, 0);

    this.sky = new SkySystem(this.scene, r);
    setLoad('Painting the land…', 55); await nextFrame();
    this.terrain = new Terrain(this.scene, this.world);
    setLoad('Filling the seas…', 65); await nextFrame();
    this.water = new Waters(this.scene, this.world, this.sky.sunDir);
    setLoad('Planting forests…', 75); await nextFrame();
    this.veg = new Vegetation(this.scene, this.world);
    this.buildings = new Buildings(this.scene, this.world);
    this.people = new People(this.scene, this.world);
    this.weather = new WeatherFX(this.scene, this.world);
    this.weather.coldAt = (x, z) => {
      const ci = this.world.cellIndex(x, z); if (ci < 0) return false;
      const yf = ((this.hours() % 8760) / 8760);
      return this.world.temp[ci] + seasonalOffset(yf) < 0.5;
    };
    this.ui = new UI(this);
    this.cinema = new Cinema(this);
    $('t-sound').onclick = async (e) => {
      if (this.audio.on) { this.audio.disable(); e.target.textContent = '🔇 Sound off'; e.target.classList.remove('on'); }
      else { await this.audio.enable(); e.target.textContent = '🔊 Sound on'; e.target.classList.add('on'); this.audio.say('Welcome to the Endless Kingdoms.', { kind: 'narrator' }); }
    };
    $('t-narrator').onclick = (e) => { this.audio.narratorOn = !this.audio.narratorOn; e.target.classList.toggle('on', this.audio.narratorOn); if (!this.audio.narratorOn) speechSynthesis?.cancel(); };
    this.ui.buildMinimapBase(this.world);
    setLoad('Waking the people…', 90); await nextFrame();

    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); r.setSize(innerWidth, innerHeight); });
    this.setupPicking(canvas);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.labelT = 0; this.mmT = 0; this.inspT = 0;
    r.setAnimationLoop(() => this.frame());
    setTimeout(() => { $('loading').classList.add('done'); setLoad('', 100); }, 400);
    if (!localStorageGet('mw-help-seen') && !location.search.includes('view=')) { $('help').classList.remove('hidden'); localStorageSet('mw-help-seen', '1'); }
  }

  hours() { return this.baseHours + ((performance.now() - this.baseAt) / 1000) * this.hps; }
  skyHours() { const h = this.hours(); return this.forceHour !== undefined ? Math.floor(h / 24) * 24 + this.forceHour : h; }
  camDist() { return this.camera.position.distanceTo(this.controls.target); }

  onState(m) {
    if (!this.ui) { (this.earlyEvents ||= []).push(...(m.events || [])); return; }
    if (this.earlyEvents) { m.events = [...this.earlyEvents, ...(m.events || [])]; this.earlyEvents = null; }
    if (!this.introDone && m.kingdoms.length) {
      this.introDone = true;
      const qp = new URLSearchParams(location.search);
      if (qp.get('hour')) this.forceHour = +qp.get('hour'); // preview a time of day (visual only)
      if (qp.get('view')) { // ?view=x,z,distance,pitchDeg  (or k=<index> to look at a kingdom)
        const [vx, vz, vd, vp] = qp.get('view').split(',').map(Number);
        const kk = qp.get('k') !== null ? m.kingdoms[+qp.get('k')] : null;
        const x = kk ? kk.x + vx : vx, z = kk ? kk.z + vz : vz;
        const y = Math.max(0, this.world.heightAt(x, z)), pr = THREE.MathUtils.degToRad(vp || 35);
        this.controls.target.set(x, y, z);
        this.camera.position.set(x, y + Math.sin(pr) * vd, z + Math.cos(pr) * vd);
        return this.onStateRest(m);
      }
      // open on the first realm, from high above, then glide down
      const k = m.kingdoms[0];
      this.controls.target.set(k.x, this.world.heightAt(k.x, k.z), k.z);
      this.camera.position.set(k.x + 1400, 2600, k.z + 2400);
      this.flyTo(k.x, k.z, 340);
    }
    this.onStateRest(m);
  }

  onStateRest(m) {
    this.people.setKingdomColors(m.kingdoms);
    this.buildings.syncKingdoms(m.kingdoms);
    this.buildings.syncRuins(m.ruins || []);
    this.weather.setStorms(m.storms);
    this.terrain.setEffects(m.storms, m.cal, m.time);
    for (const s of m.strikes || []) this.weather.strike(s[0], s[1], this.controls.target);
    this.ui.updateTop(m, this.hours());
    this.ui.renderRealms(m);
    this.ui.addEvents(m.events || []);
    // cinematic narrator reads the chronicle in God mode
    if (performance.now() - this.bootAt > 6000 && !this.cinema.active) {
      for (const e of m.events || []) if (!e.minor) this.audio.say(e.text, { kind: 'narrator' });
    }
    for (const s of m.strikes || []) this.audio.thunder(Math.hypot(s[0] - this.controls.target.x, s[1] - this.controls.target.z));
    // conversations: schedule each line in local time
    const now = performance.now();
    for (const c of m.talks || []) {
      if (this.talks.has(c.id)) continue;
      const start = now + (c.t - m.rt) * 1000;
      const lineMs = 3400;
      this.talks.set(c.id, { ...c, start, lineMs, end: start + c.lines.length * lineMs, voiced: new Set() });
      for (const l of c.lines) this.names.set(l.s, l.n);
    }
    for (const [id, t] of this.talks) if (now > t.end + 4000) this.talks.delete(id);
    if (!this.autoInspect && new URLSearchParams(location.search).get('inspect') === 'ruler' && this.people.agents.size) {
      this.autoInspect = true; const k = m.kingdoms[0]; if (k?.ruler) { this.selectPerson(k.ruler.id, true); this.follow = k.ruler.id; }
    }
    if (this.pendingLand) this.applyLand();
    this.clearT = (this.clearT || 0) + 1;
    if (this.clearT % 5 === 1) this.veg.setClearings(m.kingdoms, this.cult);
  }

  flyTo(x, z, dist = 300, top = false) {
    const y = this.world.heightAt(x, z);
    const from = this.controls.target.clone(), to = new THREE.Vector3(x, Math.max(0, y), z);
    const off = this.camera.position.clone().sub(from);
    let dir = off.clone().normalize();
    if (top) dir = new THREE.Vector3(0, 0.9, 0.44).normalize();
    else if (dir.y < 0.35) { dir.y = 0.5; dir.normalize(); }
    const fromOff = off.clone(), toOff = dir.multiplyScalar(dist);
    this.anim = { t: 0, dur: 1.6, from, to, fromOff, toOff };
  }

  selectPerson(id, fly) {
    this.req++;
    this.people.selected = id;
    this.ui.inspect = { kind: 'person', id };
    this.send({ t: 'inspect', kind: 'person', id, req: this.req });
    if (fly) { const a = this.people.agents.get(id); if (a) this.flyTo(a.x, a.z, 28); }
  }
  selectKingdom(id, fly, infoOnly) {
    if (!infoOnly && this.cinema && !this.cinema.active) { this.cinema.start(id); }
    this.req++;
    this.ui.inspect = { kind: 'kingdom', id };
    this.send({ t: 'inspect', kind: 'kingdom', id, req: this.req });
    this.people.selected = 0; this.follow = 0;
    if (fly && !this.cinema?.active) { const k = this.state?.kingdoms.find((x) => x.id === id); if (k) this.flyTo(k.x, k.z, 260); }
  }
  nameOf(id) { return this.names.get(id) || 'A villager'; }
  requestThought(id, cb) { const req = ++this.req + 100000; this.thoughtCb.set(req, cb); this.send({ t: 'inspect', kind: 'person', id, req }); }
  onInspectClosed() { this.people.selected = 0; this.follow = 0; }

  setupPicking(canvas) {
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, performance.now()]; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.click(e.clientX, e.clientY, false);
    });
    canvas.addEventListener('dblclick', (e) => this.click(e.clientX, e.clientY, true));
  }

  groundPoint(mx, my) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1), this.camera);
    const hits = ray.intersectObjects(this.terrain.group.children, false);
    if (hits.length) return hits[0].point;
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    return t > 0 ? ray.ray.at(t, new THREE.Vector3()) : null;
  }

  click(mx, my, dbl) {
    if (dbl) { const p = this.groundPoint(mx, my); if (p) this.flyTo(p.x, p.z, Math.max(25, this.camDist() * 0.4)); return; }
    const a = this.people.pick(mx, my, this.camera, innerWidth, innerHeight, 16);
    if (a) { this.selectPerson(a.id, false); return; }
    // castles on screen
    const v = new THREE.Vector3();
    let best = null, bd = 40 * 40;
    for (const k of this.state?.kingdoms || []) {
      v.set(k.x, this.world.gridHeight(k.x, k.z) + 15, k.z).project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (v.z < 1 && d < bd) { bd = d; best = k; }
    }
    if (best) { this.selectKingdom(best.id, false); return; }
    if (this.cinema.active) return;
    const p = this.groundPoint(mx, my);
    if (p && this.state) {
      let bk = null, bdist = 1e9;
      for (const k of this.state.kingdoms) { const d = Math.hypot(k.x - p.x, k.z - p.z); if (d < k.r * 1.2 && d < bdist) { bdist = d; bk = k; } }
      if (bk) this.selectKingdom(bk.id, false);
    }
  }

  frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const now = performance.now();
    const c = this.controls, cam = this.camera, w = this.world;

    // camera animation & follow
    if (this.anim) {
      const a = this.anim; a.t += dt / a.dur;
      const e = a.t >= 1 ? 1 : 1 - Math.pow(1 - a.t, 3);
      c.target.lerpVectors(a.from, a.to, e);
      cam.position.copy(c.target).add(a.fromOff.clone().lerp(a.toOff, e));
      if (a.t >= 1) this.anim = null;
    } else if (this.follow) {
      const p = this.people.agents.get(this.follow);
      if (p) { const d = new THREE.Vector3(p.x, p.y, p.z).sub(c.target); c.target.add(d.multiplyScalar(0.12)); cam.position.add(d); }
    }
    if (this.cinema.active) { this.cinema.update(dt); } else {
    c.update();
    // keep the focus on the ground and the camera above it
    const gy = w.gridHeight(c.target.x, c.target.z);
    const tgtY = Math.max(0, gy);
    const dy = (tgtY - c.target.y) * 0.15; c.target.y += dy; cam.position.y += dy;
    const minY = Math.max(0, w.heightAt(cam.position.x, cam.position.z)) + 2.5;
    if (cam.position.y < minY) cam.position.y = minY;
    c.target.x = THREE.MathUtils.clamp(c.target.x, -HALF * 1.2, HALF * 1.2); c.target.z = THREE.MathUtils.clamp(c.target.z, -HALF * 1.2, HALF * 1.2);
    }
    const dist = this.camDist();
    cam.near = THREE.MathUtils.clamp(dist * 0.003, 0.3, 30); cam.updateProjectionMatrix();
    c.panSpeed = 1; c.rotateSpeed = 0.6;
    this.updateTalks();

    const hours = this.hours();
    const yf = (hours % 8760) / 8760;
    const focus = c.target;
    const here = this.weather.sample(focus.x, focus.z);
    const camH = cam.position.y - focus.y;
    this.sky.update(dt, this.skyHours(), yf, focus, dist, here.cloud * (camH < 1500 ? 1 : 0.3), here.fog * (camH < 1200 ? 1 : 0.2));
    this.terrain.uniforms.uSeasonal.value = seasonalOffset(yf);
    this.terrain.uniforms.uTime.value = this.time;
    this.terrain.uniforms.uOverlay.value = this.showTerritory ? THREE.MathUtils.smoothstep(camH, 400, 3500) : 0;
    this.terrain.uniforms.uBorders.value = this.showTerritory ? THREE.MathUtils.smoothstep(camH, 60, 400) : 0;
    this.terrain.update(cam);
    const wind = this.state?.wind || { x: 1, z: 0, s: 3 };
    this.veg.update(cam, this.time, wind, wind.s, yf);
    this.water.update(dt, this.sky.sunDir, this.sky.sunColor, here.flood);
    this.people.update(now, this.time, cam, focus);
    this.buildings.update(this.time, 1 - this.sky.daylight);
    this.weather.update(dt, this.time, cam, focus, wind, this.sky.daylight, this.sky.sunColor, this.scene.fog, this.state?.kingdoms);
    $('flash').style.opacity = this.weather.flash.toFixed(3);
    this.audioT = (this.audioT || 0) - dt;
    if (this.audio.on && this.audioT <= 0) { this.audioT = 0.25; this.audio.update(0.25, this.soundEnv(focus, camH, here, wind)); }

    this.labelT -= dt;
    if (this.labelT <= 0) { this.labelT = 0.05; this.updateLabels(camH); }
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 0.25; this.ui.drawMinimap(this.state, cam, focus, this.time); this.ui.updateTop(this.state, hours); }
    this.inspT -= dt;
    if (this.inspT <= 0 && this.ui.inspect) { this.inspT = 1; this.send({ t: 'inspect', kind: this.ui.inspect.kind, id: this.ui.inspect.id }); }

    this.renderer.render(this.scene, cam);
  }

  soundEnv(focus, camH, here, wind) {
    const w = this.world, ci = w.cellIndex(focus.x, focus.z);
    let sea = 0;
    for (const [dx, dz] of [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150], [300, 300], [-300, -300], [300, -300], [-300, 300]]) {
      const c = w.cellIndex(focus.x + dx, focus.z + dz); if (c >= 0 && w.gh[c] < 0.5) sea += 1 / 9;
    }
    let village = 0, building = 0;
    for (const k of this.state?.kingdoms || []) { const d = Math.hypot(k.x - focus.x, k.z - focus.z); if (d < k.r) village = Math.max(village, Math.min(1, Math.sqrt(k.pop) / 6) * (1 - d / k.r)); }
    let battle = 0;
    for (const a of this.people.list) {
      if (Math.abs(a.x - focus.x) > 80 || Math.abs(a.z - focus.z) > 80) continue;
      if (a.st === 8) battle++; else if (a.st === 12) building++;
    }
    let fire = 0;
    for (const s of this.state?.storms || []) if (s.type === 'wildfire') { const d = Math.hypot(s.x - focus.x, s.z - focus.z); if (d < s.r + 300) fire = Math.max(fire, s.i * (1 - d / (s.r + 300))); }
    const hr = this.skyHours() % 24;
    return {
      camH, wind: (wind.s || 3) + here.wind * 10, rain: Math.max(here.rain, here.snow * 0.3), nearSea: sea, nearRiver: ci >= 0 && w.rdist[ci] <= 1 ? 1 : ci >= 0 && w.rdist[ci] <= 3 ? 0.4 : 0,
      village, night: hr < 5.5 || hr > 20.5, forest: ci >= 0 ? w.forest[ci] : 0, battle, fire, building,
    };
  }

  // drive speech bubbles, voices and lip sync for conversations
  updateTalks() {
    const now = performance.now();
    const focus = this.controls.target, camH = this.camera.position.y - focus.y;
    const movieTalk = this.cinema.active && this.cinema.shot?.type === 'talk' ? this.cinema.shot.talk : null;
    this.speechItems = [];
    let sub = '';
    for (const t of this.talks.values()) {
      if (now < t.start || now > t.end) continue;
      const li = Math.min(t.lines.length - 1, Math.floor((now - t.start) / t.lineMs));
      const line = t.lines[li];
      const a = this.people.agents.get(line.s);
      if (!a) continue;
      const near = Math.hypot(a.x - focus.x, a.z - focus.z) < 70 && camH < 120;
      const inMovie = movieTalk && movieTalk.id === t.id;
      if (!t.voiced.has(li)) {
        t.voiced.add(li);
        a.mouthUntil = t.start + (li + 1) * t.lineMs - 300; a.voiced = false;
        if ((inMovie || (!this.cinema.active && near)) && this.audio.on) {
          this.audio.say(line.text, {
            kind: 'talk', seed: line.s, female: line.f, child: line.c === 1, elder: line.c === 2, volume: inMovie ? 1 : 0.8,
            onstart: () => { a.voiced = true; a.mouthUntil = performance.now() + 30000; },
            onboundary: () => { a.mouthPulse = 1; },
            onend: () => { a.voiced = false; a.mouthUntil = 0; a.mouthPulse = 0; },
          });
        }
      }
      if (inMovie) sub = `<b>${line.n}:</b> ${line.text}`;
      else if (!this.cinema.active && near && this.showLabels) this.speechItems.push({ key: 'sp' + t.id, cls: 'speech', x: a.x, y: a.y + 2.35, z: a.z, html: `<b>${line.n}</b>${line.text}` });
    }
    if (this.cinema.active) document.getElementById('mv-sub').innerHTML = sub;
  }

  updateLabels(camH) {
    const items = [...(this.speechItems || [])];
    const st = this.state;
    if (st && this.showLabels) {
      for (const k of st.kingdoms) {
        const y = this.world.gridHeight(k.x, k.z) + (k.tier >= 3 ? 75 : 40);
        const far = camH > 5500;
        items.push({
          key: 'k' + k.id, cls: 'realm' + (k.capital ? ' capital' : ''), x: k.x, y, z: k.z, k: k.id,
          html: `${k.capital ? '♛ ' : ''}${k.name}${far ? '' : `<span class="sub">${k.pop} people${k.soldiers ? ` · ⚔ ${k.soldiers}` : ''}${k.war.length ? ' · at war' : ''}</span>`}<span class="bar" style="background:${k.color}"></span>`,
          o: camH < 60 ? 0.35 : 1,
        });
        if (k.army && camH > 150) items.push({ key: 'a' + k.id, cls: 'army', x: k.army.x, y: this.world.gridHeight(k.army.x, k.army.z) + 30, z: k.army.z, html: `⚔ Army of ${k.name}${k.army.s === 'siege' ? ' (siege)' : ''}` });
        if (camH < 450 && k.ruler) {
          const p = this.people.agents.get(k.ruler.id);
          if (p) items.push({ key: 'r' + p.id, cls: 'person royal', x: p.x, y: p.y + 2.6, z: p.z, p: p.id, html: `♛ ${k.ruler.name}` });
        }
      }
      for (const s of st.storms) {
        if (s.type === 'rain' || s.type === 'snow') continue;
        items.push({ key: 's' + s.id, cls: 'storm', x: s.x, y: 400, z: s.z, html: this.ui.stormLabel(s.type) });
      }
      if (camH < 2500) for (const r of st.ruins || []) items.push({ key: 'u' + r.x + ',' + r.z, cls: 'ruin', x: r.x, y: this.world.gridHeight(r.x, r.z) + 20, z: r.z, html: `Ruins of ${r.name} (fell Y${r.year})` });
    }
    if (this.people.selected) {
      const p = this.people.agents.get(this.people.selected);
      if (p && this.ui.inspect?.kind === 'person') items.push({ key: 'sel', cls: 'person', x: p.x, y: p.y + 2.4, z: p.z, p: p.id, html: document.getElementById('insp-title').textContent });
    }
    this.ui.updateLabels(items, this.camera, innerWidth, innerHeight);
  }
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

window.app = new App();
