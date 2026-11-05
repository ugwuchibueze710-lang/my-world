// DEAD CITY: ESCAPE — co-op zombie survival through six photogrammetry-scanned chapters.
// Mouse & keyboard or a PS5 controller (Fortnite default layout). Up to 4 survivors per squad by room code.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World } from '/js/world.js';
import { Atmosphere } from '/js/atmosphere.js';
import { Horde, pickZombie } from '/js/zombies.js';
import { Props } from '/js/props.js';
import { Avatar } from '/js/avatar.js';
import { Net } from '/js/net.js';
import { LEVELS, CREDITS } from '/js/levels.js';
import { loadCharTemplate } from '/js/rig.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
LEVELS.forEach((l, i) => (l.idx = i));
THREE.Cache.enabled = true;

// ============================================================== renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
const LITE = new URLSearchParams(location.search).has('lite'); if (LITE) renderer.setPixelRatio(0.5);
renderer.shadowMap.enabled = !LITE; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.03, 3000);
camera.rotation.order = 'YXZ'; scene.add(camera);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.4, 0.9);
composer.addPass(bloom); composer.addPass(new OutputPass());
const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 }); scene.add(sun, sun.target);
// the survivor's weapon light (a rail torch on the rifle) — essential in the dark chapters
const torch = new THREE.SpotLight(0xfff2dd, 0, 38, 0.42, 0.55, 1.6); torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024); torch.shadow.bias = -0.0005; camera.add(torch); torch.position.set(0.12, -0.12, 0); camera.add(torch.target); torch.target.position.set(0, 0, -10);

const world = new World(scene), atmos = new Atmosphere(renderer, scene), net = new Net();

// ============================================================== effects
const softDot = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
class Particles {
  constructor(n, color, size, additive = true, opacity = 1) {
    this.n = n; this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.i = 0; this.floor = new Float32Array(n).fill(-1e9); this.p.fill(-9999);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(color), size, map: softDot, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(pos, dir, count, speed, spread, life = 0.8, floorY) {
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
      const s = speed * rand(0.3, 1.1);
      this.v[i * 3] = (dir.x + rand(-spread, spread)) * s; this.v[i * 3 + 1] = (dir.y + rand(-spread, spread) + 0.3) * s; this.v[i * 3 + 2] = (dir.z + rand(-spread, spread)) * s;
      this.life[i] = life * rand(0.6, 1.2); this.floor[i] = floorY ?? pos.y - 3;
    }
  }
  update(dt, grav = 9.8, drag = 0) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; if (this.life[i] <= 0) { this.p[i * 3 + 1] = -9999; continue; }
      this.v[i * 3 + 1] -= grav * dt; if (drag) { this.v[i * 3] *= 1 - drag * dt; this.v[i * 3 + 2] *= 1 - drag * dt; }
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < this.floor[i]) { this.p[i * 3 + 1] = this.floor[i]; this.v[i * 3] *= 0.3; this.v[i * 3 + 2] *= 0.3; this.v[i * 3 + 1] = 0; }
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
  }
}
const bloodP = new Particles(3000, 0x5a0606, 0.06, false, 0.95), mistP = new Particles(800, 0x7a1010, 0.22, false, 0.35);
const sparks = new Particles(1200, 0xffc070, 0.04), fireP = new Particles(1500, 0xff7a20, 0.5, true, 0.9), embers = new Particles(600, 0xffa040, 0.05);
const smoke = new Particles(900, 0x6e6a66, 0.6, false, 0.32), dust = new Particles(700, 0x8a8478, 0.14, false, 0.55), splinterP = new Particles(500, 0x7a5a38, 0.05, false);
// decals (blood pools, splats, scorch marks, bullet holes) — laid on the floor / wall surface
function blotTex(color, n) { return Array.from({ length: n }, () => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.fillStyle = color; for (let i = 0; i < 14; i++) { x.globalAlpha = rand(0.4, 0.95); x.beginPath(); x.ellipse(64 + rand(-30, 30), 64 + rand(-30, 30), rand(6, 30), rand(6, 26), rand(0, 3), 0, 7); x.fill(); } for (let i = 0; i < 30; i++) { x.globalAlpha = rand(0.3, 0.9); x.beginPath(); x.arc(64 + rand(-60, 60), 64 + rand(-60, 60), rand(1, 4), 0, 7); x.fill(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }); }
const BLOOD = blotTex('#3d0303', 6), SCORCH = blotTex('#0b0908', 3);
const decals = [];
function decal(tex, pos, normal, size, opacity = 0.92, rough = 0.35) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: rough, metalness: 0 }));
  m.position.copy(pos).addScaledVector(normal, 0.01); m.lookAt(pos.clone().add(normal)); m.rotateZ(Math.random() * 6); m.scale.setScalar(size); m.receiveShadow = true; scene.add(m);
  decals.push(m); if (decals.length > 220) { const o = decals.shift(); scene.remove(o); o.geometry.dispose(); o.material.dispose(); } return m;
}
const holeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 1, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.25, 'rgba(10,8,6,0.95)'); g.addColorStop(0.5, 'rgba(60,55,50,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const FX = {
  blood(p, dir, n = 12, speed = 3) { bloodP.emit(p, dir, n, speed, 0.6, 1.1, (world.floorAt(p.x, p.z, p.y + 0.2, 4) || p.y - 2) + 0.02); mistP.emit(p, dir.clone().multiplyScalar(0.3), Math.ceil(n / 5), 0.8, 0.4, 0.6); if (Math.random() < 0.35) this.splat(p, rand(0.25, 0.5)); },
  splat(p, s) { const fy = world.floorAt(p.x, p.z, p.y + 0.3, 4); if (isFinite(fy)) decal(BLOOD[(Math.random() * BLOOD.length) | 0], new THREE.Vector3(p.x + rand(-0.4, 0.4), fy, p.z + rand(-0.4, 0.4)), new THREE.Vector3(0, 1, 0), s); },
  pool(p, s) { const fy = world.floorAt(p.x, p.z, p.y + 0.5, 4); if (!isFinite(fy)) return; const m = decal(BLOOD[(Math.random() * BLOOD.length) | 0], new THREE.Vector3(p.x, fy, p.z), new THREE.Vector3(0, 1, 0), 0.1, 0.95, 0.15); m.userData.grow = s; },
  wallSpray(p, dir) { const h = world.raycast(p, dir, 2.2); if (h) decal(BLOOD[(Math.random() * BLOOD.length) | 0], h.point, h.normal, rand(0.3, 0.7), 0.85); },
  scorch(p, s) { const fy = world.floorAt(p.x, p.z, p.y + 1, 4); decal(SCORCH[(Math.random() * SCORCH.length) | 0], new THREE.Vector3(p.x, isFinite(fy) ? fy : p.y, p.z), new THREE.Vector3(0, 1, 0), s * 2, 0.9, 0.95); },
  sparks(p, dir, n, sp) { sparks.emit(p, dir, n, sp, 0.7, 0.35); },
  splinters(p, dir, n) { splinterP.emit(p, dir, n, 4, 0.9, 1.2); dust.emit(p, dir, n, 1.5, 0.6, 0.8); },
  fire(p, n) { fireP.emit(p, new THREE.Vector3(0, 0.6, 0), n, 1.4, 0.35, 0.55); if (Math.random() < 0.4) smoke.emit(p.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, 1, 0), 1, 0.8, 0.3, 2.6); if (Math.random() < 0.2) embers.emit(p, new THREE.Vector3(0, 1, 0), 2, 3, 0.5, 1.6); },
};

// ============================================================== audio (synthesised, positional)
let ac = null, master, verb, noiseBuf;
function initAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = 0.85;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 5; master.connect(comp).connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  verb = ac.createConvolver(); const L = ac.sampleRate * 2.2, ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < L; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 2.6); }
  verb.buffer = ir; const vg = ac.createGain(); vg.gain.value = 0.38; verb.connect(vg).connect(master);
  // wind / room tone bed
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; const g = ac.createGain(); g.gain.value = 0.05; s.connect(f).connect(g).connect(master); s.start(); SFX.bed = { f, g };
}
function out(pos, ref = 3) {
  if (!pos) return master;
  const p = ac.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.3; p.maxDistance = 150;
  p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; p.connect(master); p.connect(verb); return p;
}
function noise(dur, freq, q, vol, type = 'bandpass', dest = master, at = 0, rate = 1) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rate; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); const t = ac.currentTime + at; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function osc(type, f0, f1, dur, vol, dest = master, at = 0) {
  const o = ac.createOscillator(), g = ac.createGain(); const t = ac.currentTime + at; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
  // a 5.45 AK report: supersonic crack, chamber boom, mechanical clack, and the room answering back
  shot(pos) {
    if (!ac) return; const d = pos ? out(pos, 6) : master;
    noise(0.012, 6500, 0.4, 1.0, 'highpass', d); noise(0.09, 1300, 0.6, 0.9, 'bandpass', d); noise(0.22, 260, 0.7, 0.9, 'lowpass', d);
    osc('sine', 140, 34, 0.22, 0.9, d); noise(0.03, 3200, 4, 0.25, 'bandpass', d, 0.03);
    noise(0.5, 700, 0.5, 0.35, 'bandpass', verb); noise(0.9, 240, 0.5, 0.25, 'lowpass', verb, 0.05);
  },
  click() { if (ac) { noise(0.02, 3000, 3, 0.25); noise(0.025, 2200, 4, 0.2, 'bandpass', master, 0.08); } },
  reload() { if (!ac) return; noise(0.05, 1800, 3, 0.3, 'bandpass', master, 0.25); noise(0.06, 900, 2, 0.4, 'bandpass', master, 0.6); noise(0.04, 2600, 5, 0.35, 'bandpass', master, 1.35); noise(0.05, 1500, 4, 0.4, 'bandpass', master, 1.9); },
  flesh(pos, head) { if (!ac) return; const d = out(pos); noise(0.08, 420, 1, 0.9, 'lowpass', d); noise(0.05, 1800, 2, 0.25, 'bandpass', d); if (head) osc('sine', 1700, 1500, 0.06, 0.15); },
  sever(pos) { if (!ac) return; const d = out(pos); noise(0.2, 300, 1, 1, 'lowpass', d); noise(0.12, 900, 3, 0.5, 'bandpass', d, 0.02); osc('sine', 90, 50, 0.2, 0.6, d); },
  thud(pos) { if (ac) { const d = out(pos); noise(0.1, 160, 1, 0.6, 'lowpass', d); } },
  ping() { if (ac) osc('triangle', 1400, 1400, 0.05, 0.1); },
  swing() { if (ac) noise(0.18, 900, 0.8, 0.35, 'bandpass'); },
  butt() { if (ac) { osc('sine', 110, 45, 0.18, 0.9); noise(0.12, 400, 1, 0.8, 'lowpass'); noise(0.05, 2400, 2, 0.3, 'bandpass'); } },
  // zombie voices: throaty, wet, pitched per body so they don't all sound the same
  groan(pos, z, loud) {
    if (!ac) return; const d = out(pos, loud ? 5 : 3); const base = (z?.type === 'brute' ? 70 : 110) * (0.8 + ((z?.id || 1) % 7) * 0.06);
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(), t = ac.currentTime, dur = loud ? 1.4 : rand(0.5, 0.9);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base * (loud ? 1.6 : 1), t); o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
    lfo.frequency.value = rand(18, 34); lg.gain.value = base * 0.25; lfo.connect(lg).connect(o.frequency);
    f.type = 'bandpass'; f.frequency.value = loud ? 900 : 600; f.Q.value = 1.4; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(loud ? 0.55 : 0.3, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(d); o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    noise(dur, loud ? 1600 : 900, 2, loud ? 0.3 : 0.12, 'bandpass', d);
  },
  explosion(pos, big) { if (!ac) return; const d = out(pos, 10); noise(big ? 2.4 : 1.6, 120, 0.5, 1.4, 'lowpass', d); noise(0.4, 900, 0.5, 1, 'bandpass', d); osc('sine', 70, 22, 1.2, 1.2, d); noise(2.5, 300, 0.4, 0.6, 'lowpass', verb, 0.1); },
  glass(pos) { if (ac) { const d = out(pos); for (let i = 0; i < 6; i++) osc('sine', rand(2500, 5000), rand(2000, 4000), 0.15, 0.08, d, i * 0.03); noise(0.25, 5000, 1, 0.3, 'highpass', d); } },
  wood(pos) { if (ac) { const d = out(pos); noise(0.25, 600, 1.5, 0.8, 'bandpass', d); noise(0.15, 1500, 2, 0.4, 'bandpass', d, 0.05); } },
  alarm(pos, secs) { if (!ac) return; const d = out(pos, 8); for (let i = 0; i < secs * 2; i++) osc('square', i % 2 ? 900 : 1300, i % 2 ? 900 : 1300, 0.45, 0.06, d, i * 0.5); },
  hurt() { if (ac) { osc('sine', 90, 40, 0.3, 0.8); noise(0.15, 300, 1, 0.6, 'lowpass'); } },
  step(run, surf) { if (ac) { noise(0.06, run ? 300 : 220, 1, run ? 0.32 : 0.2, 'lowpass'); noise(0.03, 2400, 2, 0.04, 'bandpass'); } },
  land() { if (ac) noise(0.12, 180, 1, 0.6, 'lowpass'); },
  beacon() { if (ac) [880, 1320].forEach((f, i) => osc('sine', f, f, 0.18, 0.12, master, i * 0.2)); },
  sting() { if (ac) [110, 104, 98].forEach((f, i) => osc('sawtooth', f, f * 0.98, 1.4, 0.06, master, i * 0.5)); },
  heartbeat() { if (ac) { osc('sine', 60, 40, 0.15, 0.5); osc('sine', 55, 38, 0.15, 0.4, master, 0.22); } },
  tags() { if (ac) { osc('triangle', 2400, 2300, 0.08, 0.15); osc('triangle', 3100, 3000, 0.08, 0.12, master, 0.06); } },
};
function updateListener() {
  if (!ac) return; const L = ac.listener, p = camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
}

// ============================================================== game state
const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, height: 1.68, hp: 100, lastHurt: -99, ground: true, crouch: false, slide: 0,
  ads: 0, mag: 30, reserve: 210, reloading: 0, fireCd: 0, recoil: 0, recoilYaw: 0, kick: 0, bob: 0, stepT: 0, shake: 0, triggerHeld: false, life: 'alive', tags: [] };
const game = { state: 'menu', t: 0, level: 0, kills: 0, headshots: 0, severs: 0, spawned: 0, spawnT: 0, flowT: 0, sendT: 0, exitT: 0, name: '', skin: 'player_swat', loading: false, horde: 0, station: null, nextStation: 300, solo: true };
const W = { id: 'ak', name: 'AK-74M', rpm: 600, dmg: 34, mag: 30, spread: 0.022, ads: 0.0025, recoil: 0.016, kick: 0.05 };
const avatars = new Map();
const players = () => { // everyone the zombies can chase
  const list = [{ id: net.id || 0, pos: P.pos, alive: P.life === 'alive' && game.state === 'play', local: true }];
  for (const [id, a] of avatars) list.push({ id, pos: a.pos, alive: a.life === 'alive' });
  return list;
};
const horde = new Horde({ scene, world, fx: FX, sfx: SFX, net, hpScale: () => 0.85 + game.level * 0.12, dmgScale: () => 0.8 + game.level * 0.1,
  hurtPlayer: (p, dmg, from) => { if (p.local) hurt(dmg, from); else net.send('hurt', { id: p.id, dmg, from: from.toArray() }); },
  onKill: (z, zone) => { if (z.killer === undefined || z.killer === (net.id || 0)) { game.kills++; if (zone === 'head') game.headshots++; feed(`${zone === 'head' ? '💥 HEADSHOT · ' : ''}${z.body.replace('scan_', '').replace(/_/g, ' ').toUpperCase()} down`, zone === 'head'); } },
});
const props = new Props({ scene, world, fx: FX, sfx: SFX, net, explode: (p, r, dmg) => explode(p, r, dmg), onAlarm: (p) => { game.horde = Math.max(game.horde, 8); banner('CAR ALARM', 'They heard that. Here they come.'); } });

// ============================================================== level flow
let levelQueue = Promise.resolve();
function loadLevel(idx, opts = {}) { return (levelQueue = levelQueue.then(() => loadLevelNow(idx, opts), () => loadLevelNow(idx, opts))); }
async function loadLevelNow(idx, opts = {}) {
  game.loading = true; game.level = idx; const def = LEVELS[idx];
  $('loading').classList.remove('hidden'); $('ld-title').textContent = def.name; $('ld-story').innerHTML = def.story.map((s) => `<p>${s}</p>`).join(''); $('ld-bar').style.width = '5%';
  horde.clear(); props.clear(); clearDecals(); stationMesh.visible = false; for (const t of tagMeshes.values()) scene.remove(t); tagMeshes.clear();
  await world.load(def, (e) => { if (e.total) $('ld-bar').style.width = `${5 + (e.loaded / e.total) * 70}%`; });
  $('ld-bar').style.width = '80%';
  const a = atmos.apply(def, world.bounds, world.minFloor());
  hemi.color.set(def.hemi[0]); hemi.groundColor.set(def.hemi[1]); hemi.intensity = def.hemi[2];
  sun.color.set(def.sun[0]); sun.intensity = def.sun[1]; renderer.toneMappingExposure = def.exposure;
  const c = world.bounds.getCenter(new THREE.Vector3()); sun.target.position.copy(c); sun.position.copy(c).add(a.outdoor ? a.sunDir.clone().multiplyScalar(80) : new THREE.Vector3(...def.sun[2]));
  torch.intensity = def.torch ?? (def.dark ? 22 : 6);
  SFX.bed && (SFX.bed.g.gain.value = def.dark ? 0.03 : 0.06, SFX.bed.f.frequency.value = def.dark ? 200 : 420);
  await props.build(def);
  await horde.prewarm(def.zombies.types);
  $('ld-bar').style.width = '100%';
  // place the survivor
  const s = new THREE.Vector3(...def.start); s.x += rand(-0.6, 0.6); s.z += rand(-0.6, 0.6);
  const fy = world.floorAt(s.x, s.z, s.y + 2, 6); s.y = isFinite(fy) ? fy : s.y;
  P.lastGood = null; Object.assign(P, { pos: opts.at ? new THREE.Vector3(...opts.at) : s, vel: new THREE.Vector3(), yaw: Math.atan2(-(def.exit[0] - def.start[0]), -(def.exit[2] - def.start[2])), pitch: 0, hp: 100, life: 'alive', crouch: false, ads: 0, reloading: 0, tags: [] });
  Object.assign(game, { spawned: 0, spawnT: 4, exitT: 0, horde: 0, levelT: 0, exitPos: new THREE.Vector3(...def.exit) });
  exitMarker.position.copy(game.exitPos); exitMarker.position.y = world.floorAt(game.exitPos.x, game.exitPos.z, game.exitPos.y + 2, 6) || game.exitPos.y;
  world.updateFlow([P.pos]);
  $('h-chapter').textContent = def.name; $('h-obj').textContent = def.objective;
  try { renderer.compile(scene, camera); } catch {}
  game.loading = false;
  setTimeout(() => $('loading').classList.add('hidden'), 600);
  banner(def.name.split('·')[1]?.trim() || def.name, def.objective); SFX.sting?.();
}
function clearDecals() { for (const d of decals) { scene.remove(d); d.geometry.dispose(); d.material.dispose(); } decals.length = 0; }

// exit marker: a green flare burning on the ground with a column of smoke
const exitMarker = new THREE.Group(); scene.add(exitMarker);
{ const flare = new THREE.PointLight(0x55ff77, 18, 16, 1.6); flare.position.y = 0.4; exitMarker.add(flare); exitMarker.userData.light = flare;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x6cff8a, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })); col.position.y = 7; exitMarker.add(col); }
// revival station: an army med-crate with a beacon light you can see through the fog
const stationMesh = new THREE.Group(); scene.add(stationMesh); stationMesh.visible = false;
{ const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x3b4a2c, roughness: 0.8, metalness: 0.2 })); crate.position.y = 0.35; crate.castShadow = true; stationMesh.add(crate);
  const crossC = document.createElement('canvas'); crossC.width = crossC.height = 64; const x = crossC.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#c11'; x.fillRect(24, 8, 16, 48); x.fillRect(8, 24, 48, 16);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(crossC) })); cross.position.set(0, 0.4, 0.36); stationMesh.add(cross);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.6, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); beam.position.y = 30; stationMesh.add(beam);
  const L = new THREE.PointLight(0x66ffcc, 20, 18, 1.6); L.position.y = 1.2; stationMesh.add(L); stationMesh.userData.light = L; }
// dog tags lying where a survivor fell
const tagMeshes = new Map();
function tagMesh(tag) {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.25 });
  for (let i = 0; i < 2; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.028), m); t.position.set(i * 0.02, 0.02 + i * 0.004, i * 0.01); t.rotation.y = i * 0.4; g.add(t); }
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.002, 4, 24), m); chain.rotation.x = Math.PI / 2; chain.position.y = 0.01; g.add(chain);
  const L = new THREE.PointLight(0xfff2a0, 3, 4, 2); L.position.y = 0.3; g.add(L);
  const fy = world.floorAt(tag.pos[0], tag.pos[2], tag.pos[1] + 1.5, 4); g.position.set(tag.pos[0], (isFinite(fy) ? fy : tag.pos[1]) + 0.01, tag.pos[2]); scene.add(g); return g;
}

// ============================================================== the director (host): who spawns, where, when
function director(dt) {
  const def = LEVELS[game.level], Z = def.zombies, live = horde.alive();
  const squad = 1 + [...avatars.values()].filter((a) => a.life !== 'dead').length;
  const max = Math.round(Z.max * (0.7 + squad * 0.25)), total = Math.round(Z.total * (0.7 + squad * 0.3));
  game.spawnT -= dt; game.horde = Math.max(0, game.horde - dt);
  const surv = players().filter((p) => p.alive);
  if (!surv.length) return;
  const nearExit = surv.some((p) => p.pos.distanceTo(game.exitPos) < 14);
  if (nearExit && !game.finaleT) { game.finaleT = 1; game.horde = 12; banner('THEY\'RE SWARMING', 'Get to the exit!'); SFX.sting(); }
  const want = game.spawned < total || game.horde > 0;
  if (want && live < max && game.spawnT <= 0) {
    game.spawnT = game.horde > 0 ? rand(0.25, 0.6) : rand(1.0, 2.6) / (0.8 + game.level * 0.1);
    // a hidden spot 14–45 m from the squad, never in someone's line of sight
    let at = null;
    for (let i = 0; i < 24 && !at; i++) {
      const c = world.randomCell(surv[(Math.random() * surv.length) | 0].pos, 14, 45); if (!c) continue;
      if (surv.some((p) => p.pos.distanceTo(c) < 12)) continue;
      const seen = surv.some((p) => world.visible(p.pos.clone().setY(p.pos.y + 1.6), c.clone().setY(c.y + 1.4)));
      if (!seen || i > 18) at = c;
    }
    if (at) { const { body, type } = pickZombie(def); horde.spawn(body, type, at); game.spawned++; }
  }
}

// ============================================================== explosions
const boomLight = new THREE.PointLight(0xffa040, 0, 30, 1.6); scene.add(boomLight);
function explode(p, r, dmg) {
  SFX.explosion(p, r > 6); boomLight.position.copy(p).y += 1; boomLight.intensity = 260;
  fireP.emit(p, new THREE.Vector3(0, 1, 0), 220, 6, 1, 0.9); smoke.emit(p, new THREE.Vector3(0, 1, 0), 70, 3, 0.8, 4); embers.emit(p, new THREE.Vector3(0, 1, 0), 120, 9, 1, 2.2); sparks.emit(p, new THREE.Vector3(0, 1, 0), 80, 10, 1, 0.8);
  const d = p.distanceTo(P.pos); if (d < r * 2.2) { P.shake += clamp(1.2 - d / (r * 2), 0, 1.2); rumble(1, 1, 450); }
  if (d < r) hurt(dmg * 0.35 * (1 - d / r), p);
  for (const z of horde.list) {
    const dz = z.root.position.distanceTo(p); if (dz > r) continue;
    const dir = z.root.position.clone().sub(p).setY(0.6).normalize(), k = 1 - dz / r;
    if (net.isHost) {
      for (const zone of ['legL', 'legR', 'armL', 'armR', 'head']) if (Math.random() < k * 0.8) horde.sever(z, zone, dir);
      horde.damage(z, 'torso', dmg * k, z.root.position.clone().setY(z.root.position.y + 1), dir, { push: 7 * k });
      z.vel.y = 4 * k;
    }
  }
  for (const pr of props.list) if (pr.alive && pr !== null && pr.pos.distanceTo(p) < r && pr.kind !== 'light') { if (pr.kind === 'barrel') setTimeout(() => props.destroy(pr, new THREE.Vector3(0, 1, 0)), rand(150, 450)); else pr.hp -= dmg * 0.5; }
}

// ============================================================== first-person rifle (AK-74M arms rig)
const viewmodel = new THREE.Group(); camera.add(viewmodel);
const VM = { ready: false };
const VM_HIP = new THREE.Vector3(0.035, -0.055, -0.13);
const MUZZLE_AHEAD = 0.33, SIGHT_H = 0.15, SIGHT_FRONT = 0.035, SIGHT_REAR = 0.42, EYE_RELIEF = 0.42;
const vmFill = new THREE.PointLight(0xdfe8ff, 0.9, 2.5, 1.5); vmFill.position.set(0.3, 0.25, 0.2); camera.add(vmFill);
new GLTFLoader().load('/assets/ak74m_arms.glb', (g) => {
  const model = g.scene, holder = new THREE.Group();
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  holder.add(model); viewmodel.add(holder); holder.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(model), A = {};
  for (const c of g.animations) A[c.name.replace('Rig|', '')] = mixer.clipAction(c);
  for (const k of ['AK_Shot', 'AK_Reload', 'AK_Reload_full', 'AK_Reload_var2', 'AK_Draw']) { A[k].setLoop(THREE.LoopOnce, 1); A[k].clampWhenFinished = k !== 'AK_Shot'; }
  for (const k of ['AK_Idle', 'AK_Walk', 'AK_Run']) { A[k].play(); A[k].setEffectiveWeight(k === 'AK_Idle' ? 1 : 0); }
  mixer.update(0.01); model.updateMatrixWorld(true);
  const bone = (n) => model.getObjectByName(n);
  const head = bone('Head_Cam_014');
  model.position.copy(head.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert())).negate();
  Object.assign(VM, { ready: true, model, holder, mixer, A, rif: bone('Rif_059'), muzzle: bone('Rif_end_079'), pmag: bone('Pmag_062'), cur: 'AK_Idle', baseQ: holder.quaternion.clone() });
  VM.durations = Object.fromEntries(g.animations.map((c) => [c.name.replace('Rig|', ''), c.duration]));
  if (game.state === 'play') vmDraw();
}, undefined, (e) => console.warn('weapon model failed', e));
function vmWeights(dt) {
  const busy = P.reloading > 0 || (VM.drawT || 0) > 0;
  VM.drawT = Math.max(0, (VM.drawT || 0) - dt);
  for (const k of ['AK_Idle', 'AK_Walk', 'AK_Run']) { const a = VM.A[k], want = busy ? 0 : k === VM.cur ? 1 : 0; a.setEffectiveWeight(THREE.MathUtils.lerp(a.getEffectiveWeight(), want, Math.min(1, dt * (busy ? 14 : 7)))); }
  for (const k of ['AK_Reload', 'AK_Reload_full', 'AK_Draw']) { const a = VM.A[k]; if (a.isRunning() || a.getEffectiveWeight() > 0) a.setEffectiveWeight(busy ? 1 : Math.max(0, a.getEffectiveWeight() - dt * 6)); }
}
function vmOneShot(name, scale = 1, weight = 1) { if (!VM.ready) return 0; const a = VM.A[name]; a.stop(); a.reset(); a.setEffectiveTimeScale(scale); a.setEffectiveWeight(weight); a.play(); return VM.durations[name] / scale; }
function vmDraw() { VM.drawT = vmOneShot('AK_Draw', 1, 1); SFX.click(); }
const muzzleWorld = () => { if (!VM.ready) return camera.localToWorld(new THREE.Vector3(0.1, -0.1, -0.8)); const e = VM.muzzle.getWorldPosition(new THREE.Vector3()), r = VM.rif.getWorldPosition(new THREE.Vector3()); return e.clone().addScaledVector(e.clone().sub(r).normalize(), MUZZLE_AHEAD); };
const barrelDir = () => VM.ready ? VM.muzzle.getWorldPosition(new THREE.Vector3()).sub(VM.rif.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
// spent brass and dropped magazines
const casings = [];
const casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.039, 8), casingMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 1, roughness: 0.28 });
const magMat = new THREE.MeshStandardMaterial({ color: 0x2a221c, metalness: 0.4, roughness: 0.6 });
const magGeo = (() => { const g = []; for (let i = 0; i < 5; i++) g.push(new THREE.BoxGeometry(0.03, 0.05, 0.07).translate(0, -i * 0.045, -i * i * 0.004)); return g; })();
function dropMag() {
  const grp = new THREE.Group(); for (const geo of magGeo) grp.add(new THREE.Mesh(geo, magMat));
  grp.position.copy(VM.ready && VM.pmag ? VM.pmag.getWorldPosition(new THREE.Vector3()) : camera.localToWorld(new THREE.Vector3(0.1, -0.3, -0.4))); grp.quaternion.copy(camera.quaternion); scene.add(grp);
  casings.push({ m: grp, v: new THREE.Vector3(P.vel.x * 0.5, -0.5, P.vel.z * 0.5), spin: new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-3, 3)), t: 20, mag: true, floor: P.pos.y });
}
// muzzle: a 3-petal AK flash + side ports, a hot point light, and the gas that hangs after
const flameTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.18, 'rgba(255,214,120,0.95)'); g.addColorStop(0.55, 'rgba(255,140,40,0.6)'); g.addColorStop(1, 'rgba(255,80,10,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(32, 0); x.bezierCurveTo(60, 90, 50, 220, 32, 256); x.bezierCurveTo(14, 220, 4, 90, 32, 0); x.fill(); return new THREE.CanvasTexture(c); })();
const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 2, 64, 64, 60); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = g; for (let i = 0; i < 7; i++) { x.save(); x.translate(64, 64); x.rotate((i / 7) * Math.PI * 2); x.fillRect(-6, 0, 12, 60); x.restore(); } x.beginPath(); x.arc(64, 64, 30, 0, 7); x.fill(); return new THREE.CanvasTexture(c); })();
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true })); flash.visible = false; scene.add(flash);
const flameMat = new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const flame = new THREE.Group(); scene.add(flame); flame.visible = false;
{ const pg = new THREE.PlaneGeometry(0.11, 0.42).translate(0, 0.21, 0).rotateX(-Math.PI / 2); for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(pg, flameMat); m.rotation.z = (i / 3) * Math.PI; flame.add(m); }
  for (let i = 0; i < 4; i++) { const side = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16).translate(0, 0.08, 0), flameMat); side.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4; flame.add(side); } }
const flashLight = new THREE.PointLight(0xffb060, 0, 16, 2); camera.add(flashLight); flashLight.position.set(0.1, -0.05, -1.6);
const tracerGeo = new THREE.CylinderGeometry(0.006, 0.006, 1.6, 6).rotateX(Math.PI / 2), tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.85 });
const rounds = [];
function tracerRound(from, to) { const m = new THREE.Mesh(tracerGeo, tracerMat); m.position.copy(from); m.lookAt(to); scene.add(m); rounds.push({ m, dir: to.clone().sub(from).normalize(), left: from.distanceTo(to) }); }
function bulletHole(p, n) { decal(holeTex, p, n, rand(0.05, 0.08), 1, 0.9); dust.emit(p, n, 10, 1.6, 0.5, 0.9); sparks.emit(p, n, 6, 4, 0.7, 0.25); }

// ============================================================== input
const keys = {}; let mouseDown = false, rightDown = false, locked = false;
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys[e.code] = true; if (['Space', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault(); onKey(e.code); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (!locked) return; if (e.button === 0) mouseDown = true; if (e.button === 2) rightDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) rightDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (!locked || game.state !== 'play') return; const s = 0.0022 * (P.ads > 0.5 ? 0.55 : 1); P.yaw -= e.movementX * s; P.lookDX = (P.lookDX || 0) + e.movementX; P.pitch = clamp(P.pitch - e.movementY * s, -1.45, 1.45); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; if (!locked && game.state === 'play' && !usingPad) pause(); });
renderer.domElement.addEventListener('click', () => { if (game.state === 'play' && !locked) renderer.domElement.requestPointerLock(); });
function onKey(code) {
  if (code === 'KeyF') { if (document.fullscreenElement) document.exitFullscreen(); else goFullscreen(); return; }
  if (game.state === 'over' && (code === 'Enter' || code === 'Space')) return retry();
  if (game.state !== 'play') return;
  if (code === 'KeyR') reload();
  if (code === 'Space') jump();
  if (code === 'KeyV' || code === 'KeyQ') melee();
  if (code === 'KeyC' || code === 'ControlLeft') crouchPress();
}
let usingPad = false, padPrev = [], padIdx = -1;
addEventListener('gamepadconnected', (e) => { padIdx = e.gamepad.index; $('pad-status').textContent = `🎮 ${e.gamepad.id.replace(/\(.*\)/, '').trim() || 'Controller'} connected`; });
addEventListener('gamepaddisconnected', () => { padIdx = -1; $('pad-status').textContent = 'Controller disconnected — mouse & keyboard ready'; });
const B = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11 };
const pad = { lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0, sprint: false, interact: false };
function rumble(strong, weak, ms) { const g = padIdx >= 0 && navigator.getGamepads()[padIdx]; g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {}); }
function pollPad(dt) {
  const gp = padIdx >= 0 ? navigator.getGamepads()[padIdx] : [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (!gp) { pad.lx = pad.ly = pad.rx = pad.ry = pad.l2 = pad.r2 = 0; pad.interact = false; return; }
  padIdx = gp.index;
  const dz = (x, y) => { const m = Math.hypot(x, y); if (m < 0.13) return [0, 0]; const k = (m - 0.13) / (0.87 * m); return [x * k, y * k]; };
  const std = gp.mapping === 'standard' || !/054c|sony|dualsense|wireless controller/i.test(gp.id);
  const MAP = std ? null : [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const btn = (i) => gp.buttons[MAP ? MAP[i] ?? i : i];
  const bt = (i) => btn(i)?.pressed, edge = (i) => bt(i) && !padPrev[i];
  [pad.lx, pad.ly] = dz(gp.axes[0] || 0, gp.axes[1] || 0);
  [pad.rx, pad.ry] = std ? dz(gp.axes[2] || 0, gp.axes[3] || 0) : dz(gp.axes[2] || 0, gp.axes[5] || 0);
  pad.l2 = btn(B.L2)?.value || (!std && gp.axes[3] !== undefined ? (gp.axes[3] + 1) / 2 : 0);
  pad.r2 = btn(B.R2)?.value || (!std && gp.axes[4] !== undefined ? (gp.axes[4] + 1) / 2 : 0);
  if (gp.buttons.some((b) => b.pressed) || Math.abs(pad.lx) + Math.abs(pad.rx) + Math.abs(pad.ly) + Math.abs(pad.ry) > 0) usingPad = true;
  pad.interact = !!bt(B.TRIANGLE);
  if (game.state !== 'play') {
    if (edge(B.CROSS) && game.state === 'over') retry();
    if (edge(B.OPTIONS) && game.state === 'paused') resume();
  } else {
    if (edge(B.CROSS)) jump();
    if (edge(B.CIRCLE)) crouchPress();
    if (edge(B.R3)) melee();
    if (edge(B.SQUARE)) reload();
    if (edge(B.L3)) pad.sprint = !pad.sprint;
    if (edge(B.OPTIONS)) pause();
    if (edge(B.L2)) aimAssistSnap();
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
    const sens = 3.4 * (P.ads > 0.5 ? 0.5 : 1) * (aimFriction() ? 0.55 : 1);
    P.yaw -= curve(pad.rx) * sens * dt; P.pitch = clamp(P.pitch - curve(pad.ry) * sens * 0.75 * dt, -1.45, 1.45);
    if (Math.hypot(pad.lx, pad.ly) < 0.2) pad.sprint = false;
  }
  padPrev = Array.from({ length: 16 }, (_, i) => !!bt(i));
  $('pad-tag').textContent = usingPad ? '🎮 CONTROLLER' : '';
}

// ============================================================== player actions
function jump() { if (P.ground && P.life === 'alive') { P.vel.y = 7.0; P.ground = false; P.crouch = false; } }
function crouchPress() {
  if (P.life !== 'alive') return;
  const speed = Math.hypot(P.vel.x, P.vel.z);
  if (!P.crouch && speed > 9 && P.ground) { P.slide = 0.8; P.crouch = true; const f = new THREE.Vector3(P.vel.x, 0, P.vel.z).normalize(); P.vel.x = f.x * 13; P.vel.z = f.z * 13; SFX.land(); }
  else P.crouch = !P.crouch;
}
function melee() {
  if (game.state !== 'play' || P.life !== 'alive' || (P.meleeT || 0) > 0 || P.reloading > 0) return;
  P.meleeT = 0.55; P.ads = 0; SFX.swing();
  setTimeout(() => {
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); let hit = false;
    for (const z of horde.list) {
      if (!z.alive) continue; const d = new THREE.Vector3(z.root.position.x - P.pos.x, 0, z.root.position.z - P.pos.z), dist = d.length();
      if (dist > 2.1 || d.normalize().dot(fwd) < 0.55) continue;
      hit = true; const pt = z.root.position.clone().setY(z.root.position.y + 1.4);
      applyHit(z, 'head', 45, pt, fwd, { melee: true, push: 5 });
    }
    if (hit) { SFX.butt(); rumble(1, 0.7, 160); P.shake += 0.25; hitMarker('kill'); }
  }, 140);
}
function reload() {
  if (P.reloading > 0 || P.mag >= W.mag || P.reserve <= 0 || P.life !== 'alive') return;
  const empty = P.mag === 0;
  P.reloading = VM.ready ? vmOneShot(empty ? 'AK_Reload_full' : 'AK_Reload', 1.1) : 2.6; P.reloadMax = P.reloading; P.magDropped = false; P.sentReload = true;
  SFX.reload(); $('h-reload').textContent = 'RELOADING…';
}
function targetNearCrosshair(maxAngle) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); let best = null, bestA = maxAngle;
  for (const z of horde.list) { if (!z.alive) continue; const head = z.bones.Head || z.bones.Spine2; if (!head) continue; const p = head.getWorldPosition(new THREE.Vector3()); p.y -= 0.25; const d = p.clone().sub(camera.position); if (d.length() > 60) continue; const ang = f.angleTo(d); if (ang < bestA && world.visible(camera.position, p)) { bestA = ang; best = p; } }
  return best;
}
const aimFriction = () => usingPad && !!targetNearCrosshair(0.06);
function aimAssistSnap() { if (!usingPad) return; const t = targetNearCrosshair(0.14); if (!t) return; const d = t.clone().sub(camera.position); const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); P.yaw += angDiff(yaw, P.yaw) * 0.55; P.pitch += (pitch - P.pitch) * 0.55; }

function hurt(dmg, from) {
  if (game.state !== 'play' || P.life !== 'alive') return;
  P.hp -= dmg; P.lastHurt = game.t; P.shake = Math.min(1, P.shake + dmg / 25);
  SFX.hurt(); rumble(0.9, 0.6, 220);
  $('hurt').style.opacity = Math.min(1, 0.35 + dmg / 30); setTimeout(() => ($('hurt').style.opacity = P.hp < 35 ? 0.4 : 0), 220);
  if (from) { const f = from.isVector3 ? from : new THREE.Vector3().fromArray(from); const d = f.clone().sub(P.pos); const ang = angDiff(Math.atan2(-d.x, -d.z), P.yaw); const i = document.createElement('i'); i.style.transform = `rotate(${-ang}rad)`; $('dirs').appendChild(i); setTimeout(() => i.remove(), 1200); }
  if (P.hp <= 0) goDown();
}
function goDown() {
  P.hp = 0; P.ads = 0; P.reloading = 0;
  if (!net.online || net.players.length <= 1) return gameOver('YOU DIED');
  P.life = 'downed'; net.send('down'); banner('YOU\'RE DOWN', 'Crawl to cover. A squadmate can revive you (hold △ / E).');
}

// ============================================================== shooting
function fire() {
  if (P.reloading > 0 || P.fireCd > 0 || P.life !== 'alive') return;
  if (P.mag <= 0) { SFX.click(); P.fireCd = 0.25; reload(); return; }
  P.mag--; P.fireCd = 60 / W.rpm; P.fired = true;
  SFX.shot(); rumble(0.55, 0.45, 60);
  vmOneShot('AK_Shot', 1.9, 0.6 * (1 - P.ads * 0.85));
  const muzzle = muzzleWorld();
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1, spread = THREE.MathUtils.lerp(W.spread, W.ads, P.ads) * (moving ? 1.5 : 1) * (P.crouch ? 0.75 : 1) * (P.ground ? 1 : 2.2) * (1 + P.recoil * 5);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  // bullets go through what you aim at: zombies, props, then the scanned world
  const wh = world.raycast(camera.position, dir, 220), maxD = wh ? wh.distance : 220;
  const zh = horde.raycast(camera.position, dir, maxD), ph = props.raycast(camera.position, dir, zh ? zh.dist : maxD);
  let end = camera.position.clone().addScaledVector(dir, maxD);
  if (ph && (!zh || ph.dist < zh.dist)) { end = ph.point; props.hit(ph.p, W.dmg, ph.point, dir); }
  else if (zh) { end = zh.point; const res = applyHit(zh.z, zh.zone, W.dmg * (P.ads > 0.6 ? 1.05 : 1), zh.point, dir, { push: 1 }); hitMarker(res === 'kill' ? 'kill' : zh.zone === 'head' ? 'head' : res === 'sever' ? 'sever' : ''); }
  else if (wh) { end = wh.point; bulletHole(wh.point, wh.normal); }
  tracerRound(muzzle, end);
  net.online && net.send('shot', { o: muzzle.toArray().map((v) => +v.toFixed(2)), d: end.toArray().map((v) => +v.toFixed(2)) });
  P.recoil += W.recoil * (1 - P.ads * 0.45); P.recoilYaw += rand(-1, 1) * W.recoil * 0.45; P.kick = Math.min(1, P.kick + W.kick * 4);
  flash.position.copy(muzzle).addScaledVector(fwd, 0.03); flash.material.rotation = Math.random() * 6; flash.scale.setScalar(rand(0.06, 0.1)); flash.visible = true; flash.userData.t = 0.04;
  flame.position.copy(muzzle); flame.lookAt(muzzle.clone().add(barrelDir())); flame.rotation.z += Math.random() * 6; flame.scale.set(rand(0.4, 0.6), rand(0.4, 0.6), rand(0.4, 0.7)); flame.visible = true; flame.userData.t = 0.035;
  smoke.emit(muzzle.clone().addScaledVector(fwd, 0.1), fwd.clone().multiplyScalar(0.4).add(new THREE.Vector3(0, 0.2, 0)), 2, 0.7, 0.3, 1.8);
  flashLight.intensity = 9; flashLight.color.setHSL(0.09, 1, rand(0.55, 0.7));
  const ej = (VM.ready ? VM.rif.getWorldPosition(new THREE.Vector3()) : muzzle.clone()).addScaledVector(right, 0.03).addScaledVector(up, 0.05); const m = new THREE.Mesh(casingGeo, casingMat); m.position.copy(ej); m.castShadow = true; scene.add(m);
  casings.push({ m, v: right.clone().multiplyScalar(rand(1.8, 2.8)).addScaledVector(up, rand(1.2, 2)).addScaledVector(P.vel, 1), spin: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), t: 6, floor: P.pos.y });
  if (casings.length > 80) scene.remove(casings.shift().m);
  updateAmmo();
}
// a hit on a zombie: the host applies it; a client shows blood right away and tells the host
function applyHit(z, zone, dmg, point, dir, opts) {
  SFX.flesh(point, zone === 'head');
  if (net.isHost) { z.killer = net.id || 0; const res = horde.damage(z, zone, dmg, point, dir, opts); if (res === 'sever') game.severs++; return res; }
  FX.blood(point, dir.clone().multiplyScalar(0.8), zone === 'head' ? 24 : 12, 3); FX.wallSpray(point, dir);
  net.send('hit', { z: z.id, part: zone, dmg, dir: dir.toArray(), pt: point.toArray(), melee: !!opts?.melee });
  return 'hit';
}
function hitMarker(kind) { const h = $('hitmark'); h.className = ''; void h.offsetWidth; h.className = 'on ' + kind; if (kind) SFX.ping(); }

// ============================================================== co-op wiring
net.on('roster', (m) => {
  renderLobby();
  for (const p of m.players) if (p.id !== net.id && !avatars.has(p.id)) { const a = new Avatar(scene, p); avatars.set(p.id, a); a.life = p.life; }
  for (const id of [...avatars.keys()]) if (!m.players.some((p) => p.id === id)) { avatars.get(id).dispose(); avatars.delete(id); }
});
net.on('left', (m) => { const a = avatars.get(m.id); if (a) { a.dispose(); avatars.delete(m.id); } });
net.on('s', (m) => { const a = avatars.get(m.id); if (a) { a.set(m); if (m.life && a.life !== m.life && m.life !== 'dead') a.setLife(m.life); } });
net.on('z', (m) => { if (!net.isHost) horde.applySnapshot(m.z); });
net.on('zfx', (m) => { if (!net.isHost) horde.applyFx(m); });
net.on('hit', (m) => { if (!net.isHost) return; const z = horde.get(m.z); if (!z) return; z.killer = m.from; const res = horde.damage(z, m.part, m.dmg, new THREE.Vector3().fromArray(m.pt), new THREE.Vector3().fromArray(m.dir), { melee: m.melee, push: m.melee ? 5 : 1 }); if (res === 'kill' && m.from !== net.id) { /* their kill */ } });
net.on('hurt', (m) => hurt(m.dmg, m.from));
net.on('shot', (m) => { const o = new THREE.Vector3().fromArray(m.o), d = new THREE.Vector3().fromArray(m.d); tracerRound(o, d); SFX.shot(o); const a = avatars.get(m.id); if (a) a.fireT = 0.15; });
net.on('fx', (m) => { if (m.k === 'prop') { const p = props.byId(m.id); if (p) props.hit(p, m.dmg, p.pos.clone().setY(p.pos.y + 0.5), new THREE.Vector3(0, -1, 0), true); } });
net.on('start', async (m) => { await beginLevel(m.level); });
net.on('level', async (m) => { await beginLevel(m.level); });
net.on('life', (m) => {
  if (m.id === net.id) {
    if (m.life === 'alive' && P.life !== 'alive') { P.life = 'alive'; P.hp = m.hp || 40; if (m.at) { P.pos.set(m.at[0], m.at[1] + 0.2, m.at[2]); banner('BACK IN THE FIGHT', 'Your squad brought your tags home'); } else banner('REVIVED', 'Get up. Keep moving.'); vmDraw(); }
    if (m.life === 'dead') { P.life = 'dead'; banner('YOU BLED OUT', 'Your tags are on the ground. Your squad can bring you back at a revival station.'); }
  } else { const a = avatars.get(m.id); if (a) a.setLife(m.life); if (m.life === 'downed') feed(`${nameOf(m.id)} is DOWN — revive them!`, true); if (m.life === 'dead') feed(`${nameOf(m.id)} bled out — grab their tags`, true); }
  renderSquad();
});
net.on('tag', (m) => { const t = m.tag; let mesh = tagMeshes.get(t.id); if (!mesh) { mesh = tagMesh(t); tagMeshes.set(t.id, mesh); mesh.userData.tag = t; } mesh.userData.tag = t; mesh.visible = !t.carrier; if (t.carrier === net.id) { SFX.tags(); banner('DOG TAGS', `You have ${t.name}'s tags. Take them to the revival station.`); } renderSquad(); });
net.on('tagGone', (m) => { const mesh = tagMeshes.get(m.id); if (mesh) scene.remove(mesh); tagMeshes.delete(m.id); });
net.on('station', (m) => { game.station = m.station; game.nextStation = m.next; if (m.station) { const p = m.station.p; stationMesh.position.set(p[0], p[1], p[2]); stationMesh.visible = true; SFX.beacon(); banner('REVIVAL STATION OPEN', 'Bring dog tags to the green beacon — 45 seconds'); } else stationMesh.visible = false; });
net.on('clock', (m) => { game.nextStation = m.next; game.station = m.station; game.bleed = m.bleed; if (!m.station) stationMesh.visible = false; });
net.on('wipe', () => gameOver('SQUAD WIPED'));
net.on('error', (m) => { $('lobby-msg').textContent = m.msg; });
net.on('joined', (m) => { game.solo = false; $('lobby').classList.remove('hidden'); $('code-show').textContent = m.code; renderLobby(); if (m.started) beginLevel(m.level); });
net.on('closed', () => { if (game.state === 'play' && !game.solo) feed('Connection lost', true); });
const nameOf = (id) => net.players.find((p) => p.id === id)?.name || 'Survivor';
function stationPoints() { const pts = []; for (let i = 0; i < 40; i++) { const c = world.randomCell(null, 0, 1e9); if (c) pts.push(c.toArray().map((v) => +v.toFixed(2))); } return pts; }

// ============================================================== game flow
function goFullscreen() { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); }
async function beginLevel(idx, at) {
  initAudio(); ac?.resume?.(); goFullscreen();
  $('menu').classList.add('hidden'); $('lobby').classList.add('hidden'); $('over').classList.add('hidden'); $('win').classList.add('hidden');
  game.state = 'loading';
  await loadLevel(idx, { at });
  game.state = 'play'; game.t = game.t || 0; P.mag = W.mag; if (idx === 0) { P.reserve = 240; game.kills = game.headshots = game.severs = 0; game.t = 0; } else P.reserve = Math.max(P.reserve, 150);
  $('hud').classList.remove('hidden'); $('hurt').style.opacity = 0;
  if (!usingPad) renderer.domElement.requestPointerLock()?.catch?.(() => {});
  vmDraw(); updateAmmo(); renderSquad();
}
async function startSolo() { net.leave(); avatars.forEach((a) => a.dispose()); avatars.clear(); game.solo = true; readMenu(); await beginLevel(+($('chapter').value || 0)); }
async function createSquad() { readMenu(); try { await net.connect(); } catch { $('lobby-msg').textContent = 'Could not reach the server'; return; } net.send('create', { name: game.name, skin: game.skin }); }
async function joinSquad() { readMenu(); const code = $('code').value.trim().toUpperCase(); if (code.length !== 4) { $('menu-msg').textContent = 'Enter the 4-letter squad code'; return; } try { await net.connect(); } catch { $('menu-msg').textContent = 'Could not reach the server'; return; } net.send('join', { code, name: game.name, skin: game.skin }); }
async function hostStart() { if (!net.isHost) return; const idx = +($('chapter').value || 0); await beginLevel(idx); net.send('start', { level: idx, points: stationPoints() }); }
function readMenu() { game.name = ($('name').value || 'Survivor').trim().slice(0, 16); game.skin = $('skin').value; try { localStorage.setItem('siege-name', game.name); localStorage.setItem('siege-skin', game.skin); } catch {} }
function renderLobby() {
  $('roster').innerHTML = net.players.map((p) => `<li>${p.host ? '★ ' : ''}${p.name.replace(/[<>&]/g, '')}${p.id === net.id ? ' (you)' : ''}</li>`).join('');
  $('host-start').style.display = net.isHost ? '' : 'none'; $('lobby-wait').style.display = net.isHost ? 'none' : '';
  renderSquad();
}
function renderSquad() {
  const el = $('squad'); if (game.solo || !net.online) { el.innerHTML = ''; return; }
  el.innerHTML = net.players.map((p) => { const me = p.id === net.id, a = avatars.get(p.id), life = me ? P.life : a?.life || p.life;
    const bl = (game.bleed || []).find((b) => b[0] === p.id); const extra = life === 'downed' && bl ? ` ${Math.ceil(bl[1])}s` : '';
    return `<li class="${life}">${p.name.replace(/[<>&]/g, '')}${me ? ' (you)' : ''} <b>${life === 'alive' ? '' : life.toUpperCase() + extra}</b></li>`; }).join('');
}
function pause() { if (game.state !== 'play') return; if (!game.solo && net.online) { if (document.pointerLockElement) document.exitPointerLock(); $('pausehint').classList.remove('hidden'); return; } game.state = 'paused'; $('menu').classList.remove('hidden'); $('play').textContent = 'RESUME'; if (document.pointerLockElement) document.exitPointerLock(); }
function resume() { if (game.state !== 'paused') return; game.state = 'play'; $('menu').classList.add('hidden'); if (!usingPad) renderer.domElement.requestPointerLock()?.catch?.(() => {}); }
function gameOver(title) {
  if (game.state === 'over') return; game.state = 'dying'; game.deadT = 0; P.hp = 0; rumble(1, 1, 600);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(async () => {
    game.state = 'over'; $('hud').classList.add('hidden'); $('over').classList.remove('hidden'); $('over-title').textContent = title;
    $('o-time').textContent = fmt(game.t); $('o-wave').textContent = game.level + 1; $('o-kills').textContent = game.kills; $('o-hs').textContent = game.headshots;
    try { const r = await (await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: game.name, time: game.t, kills: game.kills, wave: game.level + 1, headshots: game.headshots }) })).json(); $('o-rank').textContent = r.rank && r.rank <= 50 ? `#${r.rank} on the global board` : ''; } catch {}
  }, 2400);
}
async function retry() { if (game.solo) await beginLevel(game.level); else if (net.isHost) { await beginLevel(game.level); net.send('start', { level: game.level, points: stationPoints() }); } }
async function nextLevel() {
  const def = LEVELS[game.level];
  if (def.final) return victory();
  const idx = game.level + 1;
  if (game.solo) return beginLevel(idx);
  if (net.isHost) { await beginLevel(idx); net.send('level', { level: idx, points: stationPoints() }); }
}
function victory() {
  game.state = 'won'; if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.add('hidden'); $('win').classList.remove('hidden');
  $('w-time').textContent = fmt(game.t); $('w-kills').textContent = game.kills; $('w-hs').textContent = game.headshots; $('w-sev').textContent = game.severs;
  fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: game.name, time: game.t, kills: game.kills, wave: 7, headshots: game.headshots }) }).catch(() => {});
}
function banner(text, sub) { const b = $('banner'); b.innerHTML = `${text}<small>${sub || ''}</small>`; b.style.opacity = 1; clearTimeout(banner.t); banner.t = setTimeout(() => (b.style.opacity = 0), 3200); }
function feed(text, hs) { const li = document.createElement('li'); li.className = hs ? 'hs' : ''; li.textContent = text; $('killfeed').prepend(li); setTimeout(() => li.remove(), 3500); while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove(); }
function updateAmmo() { $('h-mag').textContent = P.mag; $('h-res').textContent = `/ ${P.reserve}`; $('h-mag').classList.toggle('low', P.mag <= 7); }
$('play').onclick = () => (game.state === 'paused' ? resume() : startSolo());
$('create').onclick = createSquad; $('join').onclick = joinSquad; $('host-start').onclick = hostStart; $('again').onclick = retry; $('win-again').onclick = () => location.reload();
$('lobby-leave').onclick = () => { net.leave(); $('lobby').classList.add('hidden'); };
$('pausehint').onclick = () => { $('pausehint').classList.add('hidden'); renderer.domElement.requestPointerLock()?.catch?.(() => {}); };
try { $('name').value = localStorage.getItem('siege-name') || ''; $('skin').value = localStorage.getItem('siege-skin') || 'player_swat'; } catch {}
$('chapter').innerHTML = LEVELS.map((l, i) => `<option value="${i}">${l.name}</option>`).join('');
$('credits').innerHTML = CREDITS.map(([t, a, l]) => `“${t}” by ${a} (${l})`).join(' · ');
fetch('/api/scores').then((r) => r.json()).then((rows) => { $('board').innerHTML = rows.length ? `<table class="lb"><tr><th>#</th><th>CALLSIGN</th><th>TIME</th><th>CH</th><th>KILLS</th></tr>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name.replace(/[<>&]/g, '')}</td><td>${fmt(r.time)}</td><td>${r.wave}</td><td>${r.kills}</td></tr>`).join('')}</table>` : ''; }).catch(() => {});

// ============================================================== main loop
const clock = new THREE.Clock();
function update(dt) {
  pollPad(dt);
  const t = clock.elapsedTime;
  atmos.update(dt, t);
  const playing = game.state === 'play';
  if (playing) {
    game.t += dt; game.levelT = (game.levelT || 0) + dt;
    const alive = P.life === 'alive', downed = P.life === 'downed';
    // movement
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.lx, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - pad.ly;
    const mlen = Math.hypot(mx, mz); if (mlen > 1) { mx /= mlen; mz /= mlen; }
    if (P.life === 'dead') { mx = mz = 0; }
    const sprint = alive && (keys.ShiftLeft || pad.sprint) && mz > 0.3 && !P.crouch && P.ads < 0.5;
    if (sprint && P.reloading <= 0) P.ads = 0;
    const maxSpeed = downed ? 1.1 : (P.crouch ? 3.4 : sprint ? 9.5 : 6.2) * (P.ads > 0.5 ? 0.65 : 1);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const wantX = (fx * mz + rx * mx) * maxSpeed, wantZ = (fz * mz + rz * mx) * maxSpeed;
    if (P.slide > 0) { P.slide -= dt; P.vel.x *= 1 - dt * 1.4; P.vel.z *= 1 - dt * 1.4; }
    else { const acc = P.ground ? 14 : 3; P.vel.x += (wantX - P.vel.x) * Math.min(1, dt * acc); P.vel.z += (wantZ - P.vel.z) * Math.min(1, dt * acc); }
    P.vel.y -= 18 * dt;
    // move in small steps so we never tunnel through thin scanned walls
    const steps = Math.ceil(P.vel.length() * dt / 0.15) || 1;
    let grounded = false;
    for (let s = 0; s < steps; s++) { P.pos.addScaledVector(P.vel, dt / steps); if (world.collideCapsule(P.pos, 0.35, downed ? 0.8 : P.crouch ? 1.2 : 1.8, P.vel)) grounded = true; }
    // step up small ledges / stairs in scans
    if (!grounded) { const fy = world.floorAt(P.pos.x, P.pos.z, P.pos.y + 0.45, 0.6); if (isFinite(fy) && fy <= P.pos.y + 0.45 && fy >= P.pos.y - 0.25 && P.vel.y <= 0.5) { P.pos.y = fy; grounded = true; } }
    // holes in the scan: the nav grid is the safety floor
    if (!grounded) { const nf = world.navFloor(P.pos); if (isFinite(nf) && P.pos.y < nf + 0.02 && P.pos.y > nf - 1.5) { P.pos.y = nf; grounded = true; } }
    if (!grounded && world.clampToNav(P.pos, P.vel)) grounded = true;
    if (grounded) { if (!P.ground && P.vel.y < -7) { SFX.land(); P.shake += 0.15; } if (P.vel.y < 0) P.vel.y = 0; }
    P.ground = grounded;
    // stay inside the playable area of the scan (no wandering around the outside of the alley walls)
    if (world.onNav(P.pos, 1.0)) { if (P.ground) (P.lastGood ||= new THREE.Vector3()).copy(P.pos); } else if (P.lastGood) { P.pos.x = P.lastGood.x; P.pos.z = P.lastGood.z; P.vel.x *= -0.2; P.vel.z *= -0.2; }
    // fell through a hole in a scan: put us back on the nav grid
    if (P.lastGood && P.pos.y < P.lastGood.y - 4) { P.pos.copy(P.lastGood); P.pos.y += 0.3; P.vel.set(0, 0, 0); }
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (P.ground && hs > 1 && P.slide <= 0) { P.stepT -= dt * hs; if (P.stepT <= 0) { P.stepT = sprint ? 2.6 : 2.2; SFX.step(sprint); } }
    P.bob += dt * hs * 1.5;
    // aim, fire, reload
    const adsHeld = alive && (window.__adsOverride ?? (rightDown || pad.l2 > 0.4));
    P.ads += ((adsHeld && !sprint ? 1 : 0) - P.ads) * Math.min(1, dt * 12);
    P.fireCd -= dt;
    const trigger = alive && (mouseDown || pad.r2 > 0.4);
    if (trigger && !((P.meleeT || 0) > 0)) fire();
    P.triggerHeld = trigger;
    if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) { const take = Math.min(W.mag - P.mag, P.reserve); P.mag += take; P.reserve -= take; VM.cur = 'AK_Idle'; $('h-reload').textContent = ''; updateAmmo(); } }
    if (alive && game.t - P.lastHurt > 5 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 6);
    if (alive && P.hp < 30 && Math.floor(game.t * 1.3) !== Math.floor((game.t - dt) * 1.3)) SFX.heartbeat();
    // ammo caches: zombies sometimes drop a mag
    // interactions: revive a downed squadmate, grab dog tags, hand tags in at the station
    const interact = keys.KeyE || pad.interact;
    let prompt = '';
    if (alive && !game.solo) {
      let near = null; for (const [id, a] of avatars) if (a.life === 'downed' && a.pos.distanceTo(P.pos) < 1.8) near = id;
      if (near) { prompt = 'HOLD △ / E TO REVIVE'; if (interact && !P.reviving) { P.reviving = near; net.send('reviveStart', { id: near }); } }
      if (P.reviving && (!interact || !near)) { net.send('reviveStop', { id: P.reviving }); P.reviving = 0; }
      for (const [, mesh] of tagMeshes) { const tg = mesh.userData.tag; if (!tg.carrier && mesh.position.distanceTo(P.pos) < 1.6) { prompt = `△ / E — PICK UP ${tg.name}'S TAGS`; if (interact && !P.pickT) { P.pickT = 1.2; net.send('grabTag', { id: tg.id }); } } }
      if (game.station && P.pos.distanceTo(new THREE.Vector3(...game.station.p)) < 2.6) { prompt = 'REVIVAL STATION — HOLD △ / E TO BRING THEM BACK'; if (interact && !P.redeemT) { P.redeemT = 1; net.send('redeem'); } }
    }
    P.pickT = Math.max(0, (P.pickT || 0) - dt); P.redeemT = Math.max(0, (P.redeemT || 0) - dt);
    $('prompt').textContent = prompt; $('prompt').style.opacity = prompt ? 1 : 0;
    // host: run the horde, the director and the exit
    if (net.isHost) {
      game.flowT -= dt; if (game.flowT <= 0) { game.flowT = 0.5; world.updateFlow(players().filter((p) => p.alive).map((p) => p.pos)); }
      director(dt); horde.think(dt, players());
      const surv = players().filter((p) => p.alive);
      const atExit = surv.length && surv.some((p) => p.pos.distanceTo(game.exitPos) < 3.5) && surv.every((p) => p.pos.distanceTo(game.exitPos) < 16);
      game.exitT = atExit ? game.exitT + dt : 0;
      if (game.exitT > 2.5 && !game.loading) { game.exitT = -999; nextLevel(); }
    }
    // network: my state 20 Hz, zombies 10 Hz
    if (net.online) {
      game.sendT -= dt;
      if (game.sendT <= 0) {
        game.sendT = 0.05;
        net.send('s', { p: P.pos.toArray().map((v) => +v.toFixed(2)), y: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(2), v: P.vel.toArray().map((v) => +v.toFixed(1)), c: P.crouch ? 1 : 0, life: P.life, fire: P.fired ? 1 : 0, rl: P.sentReload ? 1 : 0, kneel: P.reviving ? 1 : 0, pick: P.pickT > 1 ? 1 : 0, hp: Math.round(P.hp) });
        P.fired = false; P.sentReload = false;
        if (net.isHost && (game.zT = (game.zT || 0) + 1) % 2 === 0) net.send('z', { z: horde.snapshot() });
      }
    }
    // HUD
    $('h-time').textContent = fmt(game.t); $('h-kills').textContent = game.kills; $('h-left').textContent = Math.max(0, Math.round(game.exitPos.distanceTo(P.pos))) + ' m';
    $('h-hp').style.width = `${P.hp}%`; $('h-hp').classList.toggle('low', P.hp < 35); $('h-hpn').textContent = Math.ceil(P.hp);
    const st = $('h-station'); if (game.solo) st.textContent = ''; else st.textContent = game.station ? `REVIVAL STATION OPEN ${Math.ceil(game.station.left || 0)}s` : `NEXT REVIVAL STATION ${fmt(Math.max(0, game.nextStation || 0))}`;
    $('h-tags').textContent = [...tagMeshes.values()].filter((m) => m.userData.tag.carrier === net.id).length ? `🏷 CARRYING DOG TAGS` : '';
    const ch = $('crosshair'); ch.classList.toggle('ads', P.ads > 0.6); ch.style.setProperty('--gap', `${6 + (THREE.MathUtils.lerp(W.spread, W.ads, P.ads) * (hs > 1 ? 1.5 : 1)) * 400 + P.recoil * 280}px`);
    // objective arrow toward the exit / station
    const target = game.station && [...tagMeshes.values()].some((m) => m.userData.tag.carrier === net.id) ? new THREE.Vector3(...game.station.p) : game.exitPos;
    const d = target.clone().sub(P.pos); const ang = angDiff(Math.atan2(-d.x, -d.z), P.yaw); $('arrow').style.transform = `translateX(-50%) rotate(${-ang}rad)`;
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) renderSquad();
  }
  // everyone animates (host simulates, clients puppet)
  if (playing || game.state === 'dying' || game.state === 'paused') horde.update(game.state === 'paused' ? 0 : dt, !net.isHost);
  props.update(dt, t);
  for (const a of avatars.values()) a.update(dt);
  if (game.state === 'dying') { game.deadT += dt; P.pitch += (0.4 - P.pitch) * dt * 2; }
  exitMarker.userData.light.intensity = 14 + Math.sin(t * 13) * 4 + Math.random() * 3; if (playing && Math.random() < dt * 25) smoke.emit(exitMarker.position.clone().setY(exitMarker.position.y + 0.3), new THREE.Vector3(0, 1, 0), 1, 0.9, 0.2, 3);
  if (stationMesh.visible) { stationMesh.userData.light.intensity = 16 + Math.sin(t * 4) * 6; stationMesh.rotation.y += dt * 0.3; }
  for (const m of tagMeshes.values()) m.rotation.y += dt;
  boomLight.intensity *= Math.pow(0.002, dt);

  // camera: recoil recovery, shake, crouch, bob, downed
  P.recoil *= Math.pow(0.0006, dt); P.recoilYaw *= Math.pow(0.001, dt); P.kick *= Math.pow(0.0005, dt); P.shake *= Math.pow(0.02, dt);
  const eye = game.state === 'dying' ? Math.max(0.25, P.height - game.deadT * 1.4) : P.life === 'downed' ? 0.45 : P.life === 'dead' ? 2.6 : P.crouch ? 1.05 : P.height;
  P.eyeY = THREE.MathUtils.lerp(P.eyeY ?? eye, eye, Math.min(1, dt * 8));
  const bobY = Math.sin(P.bob * 2) * 0.03 * (1 - P.ads * 0.85), bobX = Math.cos(P.bob) * 0.022 * (1 - P.ads * 0.85);
  camera.position.set(P.pos.x + (Math.random() - 0.5) * P.shake * 0.1, P.pos.y + P.eyeY + bobY + (Math.random() - 0.5) * P.shake * 0.1, P.pos.z);
  camera.rotation.set(P.pitch + P.recoil, P.yaw + P.recoilYaw, game.state === 'dying' ? Math.min(0.7, game.deadT * 0.6) : P.life === 'downed' ? 0.25 : 0);
  const fov = 74 - P.ads * (window.__zoom ?? 12); if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // the sun's shadow box follows the player
  if (LEVELS[game.level] && !LEVELS[game.level].dark) { const off = sun.position.clone().sub(sun.target.position); sun.target.position.copy(P.pos); sun.position.copy(P.pos).add(off); }
  // viewmodel
  viewmodel.visible = (playing || game.state === 'paused') && P.life === 'alive';
  if (VM.ready && viewmodel.visible) {
    const hs2 = Math.hypot(P.vel.x, P.vel.z), sprinting = hs2 > 8 && P.ground && P.ads < 0.3 && P.reloading <= 0;
    VM.cur = sprinting ? 'AK_Run' : hs2 > 1 && P.ground && P.ads < 0.5 ? 'AK_Walk' : 'AK_Idle';
    VM.A.AK_Walk.setEffectiveTimeScale(clamp(hs2 / 6, 0.7, 1.4));
    vmWeights(dt); VM.mixer.update(game.state === 'paused' ? 0 : dt);
    if (P.reloading > 0 && !P.magDropped && P.reloadMax - P.reloading > 0.55) { P.magDropped = true; dropMag(); }
    VM.swayX = THREE.MathUtils.lerp(VM.swayX || 0, -(pad.rx * 0.02) + (P.lookDX || 0) * -0.0004, Math.min(1, dt * 8));
    VM.holder.quaternion.copy(VM.baseQ); VM.holder.position.copy(VM_HIP).add(new THREE.Vector3(bobX * 0.4 + VM.swayX, bobY * 0.35, P.kick * 0.05));
    if (P.ads > 0.01) {
      camera.updateMatrixWorld(true); VM.holder.updateMatrixWorld(true);
      const m = camera.worldToLocal(VM.muzzle.getWorldPosition(new THREE.Vector3())), r = camera.worldToLocal(VM.rif.getWorldPosition(new THREE.Vector3()));
      const d = m.clone().sub(r).normalize(), up = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
      const F = m.clone().addScaledVector(d, -SIGHT_FRONT).addScaledVector(up, SIGHT_H), R = m.clone().addScaledVector(d, -SIGHT_REAR).addScaledVector(up, SIGHT_H);
      const q = new THREE.Quaternion().setFromUnitVectors(F.clone().sub(R).normalize(), new THREE.Vector3(0, 0, -1));
      const hp = VM.holder.position.clone(), R2 = R.clone().sub(hp).applyQuaternion(q).add(hp);
      const ER = window.__er ?? EYE_RELIEF; const tt = new THREE.Vector3(0, 0, -ER).sub(R2);
      VM.holder.quaternion.premultiply(new THREE.Quaternion().slerp(q, P.ads)); VM.holder.position.addScaledVector(tt, P.ads);
    }
    if ((P.meleeT || 0) > 0) { P.meleeT = Math.max(0, P.meleeT - dt); const k = 1 - P.meleeT / 0.55, sw = Math.sin(Math.min(1, k * 1.6) * Math.PI); VM.holder.position.add(new THREE.Vector3(-0.12 * sw, 0.06 * sw, -0.3 * sw)); VM.holder.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * sw, 0.35 * sw, 0.9 * sw))); }
  }
  P.lookDX = 0;
  if (flash.visible) { flash.position.copy(muzzleWorld()).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 0.04); flash.userData.t -= dt; if (flash.userData.t <= 0) flash.visible = false; }
  if (flame.visible) { flame.position.copy(muzzleWorld()); flame.userData.t -= dt; if (flame.userData.t <= 0) flame.visible = false; }
  flashLight.intensity *= Math.pow(0.0001, dt);
  // effects
  bloodP.update(dt, 9.8); mistP.update(dt, 0.5, 2); sparks.update(dt); fireP.update(dt, -3, 1); embers.update(dt, -1.5, 0.5); smoke.update(dt, -0.4, 0.6); dust.update(dt, 2, 1); splinterP.update(dt);
  for (let i = rounds.length - 1; i >= 0; i--) { const r = rounds[i], step = Math.min(r.left, 380 * dt); r.m.position.addScaledVector(r.dir, step); r.left -= step; if (r.left <= 0.01) { scene.remove(r.m); rounds.splice(i, 1); } }
  for (let i = casings.length - 1; i >= 0; i--) { const c = casings[i]; c.t -= dt; c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt;
    if (c.fy === undefined) c.fy = world.floorAt(c.m.position.x, c.m.position.z, c.m.position.y + 0.5, 3); if (isFinite(c.fy) && c.m.position.y < c.fy + 0.01) { c.m.position.y = c.fy + 0.01; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y) * 0.35; c.spin.multiplyScalar(0.5); }
    if (c.t <= 0) { scene.remove(c.m); casings.splice(i, 1); } }
  for (const d of decals) if (d.userData.grow) { const s = d.scale.x; if (s < d.userData.grow) d.scale.setScalar(Math.min(d.userData.grow, s + dt * 0.35)); }
  updateListener();
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  try { update(dt); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('frame error', e); } }
  composer.render();
}
// menu backdrop: drift slowly through the first chapter
(async () => { try { await loadLevel(0); $('loading').classList.add('hidden'); } catch (e) { console.warn(e); $('loading').classList.add('hidden'); } })();
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); });
window.__siege = { game, P, horde, world, props, start: startSolo, beginLevel, fire, VM, reload, net, LEVELS, explode, avatars, camera };
