// NEON SIEGE — first-person alien survival in the neon arena.
// Mouse & keyboard or a PS5 controller (Fortnite default layout). Everything is built procedurally; no downloads.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ARENA_R = 40;

// ============================================================== renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
$('scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04030b);
scene.fog = new THREE.FogExp2(0x070418, 0.022);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.03, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.5, 0.32);
composer.addPass(bloom); composer.addPass(new OutputPass());

scene.add(new THREE.HemisphereLight(0x7a6cff, 0x0a0420, 0.55));
const keyL = new THREE.DirectionalLight(0x9fdcff, 0.9); keyL.position.set(-10, 20, 12); scene.add(keyL);
const rimL = new THREE.PointLight(0xff2bd6, 60, 70, 1.5); rimL.position.set(18, 10, -18); scene.add(rimL);
const fillL = new THREE.PointLight(0x29f0ff, 50, 70, 1.5); fillL.position.set(-18, 9, 16); scene.add(fillL);
const neon = (c, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

// ============================================================== arena (same neon world)
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uFog: { value: new THREE.Color(0x070418) } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uFog; varying vec3 vW;
    float grid(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) * s; vec2 fw = fwidth(p) * 1.2; vec2 l = 1. - smoothstep(vec2(0.), fw + w, g); return max(l.x, l.y); }
    void main(){ float d = length(vW.xz);
      vec3 col = vec3(0.014, 0.012, 0.035) + vec3(0.05, 0.6, 0.85) * grid(vW.xz, 1.0, 0.012) * 0.2 + vec3(0.9, 0.15, 0.85) * grid(vW.xz, 5.0, 0.03) * 0.4;
      col += vec3(1.0, 0.1, 0.6) * smoothstep(0.5, 0.0, abs(d - ${ARENA_R.toFixed(1)})) * 0.8;
      float fog = 1. - exp(-pow(d * 0.026, 2.)); gl_FragColor = vec4(mix(col, uFog, fog), 1.); }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), floorMat); floor.rotation.x = -Math.PI / 2; scene.add(floor);
// boundary: a faint neon curtain
{
  const g = new THREE.CylinderGeometry(ARENA_R, ARENA_R, 3, 96, 1, true);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float a = (1. - vUv.y) * 0.22 * (0.7 + 0.3 * sin(vUv.x * 300. + uTime * 2.)); gl_FragColor = vec4(1.0, 0.2, 0.8, a); }` });
  const c = new THREE.Mesh(g, m); c.position.y = 1.5; scene.add(c); var curtain = m;
}
// skyline
{
  const cols = [0x29f0ff, 0xff2bd6, 0x7a5cff, 0x29f0ff, 0xffc23d];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + Math.random() * 0.08, r = 52 + Math.random() * 40, h = 8 + Math.random() * 40, w = 2 + Math.random() * 4;
    const geo = new THREE.BoxGeometry(w, h, w);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x05040e, roughness: 0.4, metalness: 0.8 })));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(cols[i % 5]).multiplyScalar(1.6), toneMapped: false })));
    g.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); scene.add(g);
  }
  const N = 1100, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 140; pos[i * 3 + 1] = Math.random() * 40; pos[i * 3 + 2] = (Math.random() - 0.5) * 140; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fdcff, size: 0.09, transparent: true, opacity: 0.7, toneMapped: false })); scene.add(motes);
}
// the gate — now an alien portal
const PORTAL = new THREE.Vector3(0, 0, -33);
const portalMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uFlash; varying vec2 vUv;
    void main(){ vec2 p = vUv - 0.5; float r = length(p * vec2(1.0, 1.6)); float a = atan(p.y, p.x);
      float swirl = sin(a * 5. + r * 22. - uTime * 3.) * 0.5 + 0.5;
      vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.6, 0.1, 1.0), swirl) * (1.2 + uFlash * 2.);
      float alpha = smoothstep(0.5, 0.1, r) * (0.55 + 0.35 * swirl); gl_FragColor = vec4(col, alpha); }` });
{
  const g = new THREE.Group(); g.position.set(PORTAL.x, 4.2, PORTAL.z);
  const fm = neon(0x29f0ff, 2.2);
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), fm); m.position.set(x, y, 0); g.add(m); };
  bar(11, 0.22, 0, 4.2); bar(0.22, 8.6, -5.4, 0); bar(0.22, 8.6, 5.4, 0);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 8.4), portalMat); g.add(field);
  scene.add(g);
  var portalLight = new THREE.PointLight(0x5dff9a, 40, 30, 1.6); portalLight.position.set(PORTAL.x, 3, PORTAL.z + 2); scene.add(portalLight);
}
// floor rifts (extra spawn points)
const RIFTS = [new THREE.Vector3(-30, 0, 4), new THREE.Vector3(30, 0, -2), new THREE.Vector3(-14, 0, 32), new THREE.Vector3(18, 0, 30)];
const riftMats = RIFTS.map((p) => {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5dff9a).multiplyScalar(1.5), transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 2.0, 40), m); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.02, p.z); scene.add(ring);
  const core = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: 0x020205 })); core.rotation.x = -Math.PI / 2; core.position.set(p.x, 0.015, p.z); scene.add(core);
  return m;
});

// cover: neon-edged blocks and pillars  [x, z, halfX, halfZ, height]
const COVER = [[-8, -6, 3, 0.8, 1.3], [9, -10, 1.2, 1.2, 3.2], [-14, 6, 0.8, 4, 1.5], [14, 4, 4, 0.8, 1.2], [0, -17, 6, 0.8, 1.5], [-20, -14, 2, 2, 4.5],
  [20, -18, 1.5, 1.5, 5.5], [-6, 17, 3, 0.8, 1.3], [10, 19, 1.2, 1.2, 3.2], [25, 10, 0.8, 3, 2], [-25, 21, 2, 0.8, 1.4], [-26, -4, 1.2, 1.2, 3], [3, 6, 0.6, 0.6, 2.6]];
const covers = COVER.map(([x, z, hx, hz, h], i) => {
  const geo = new THREE.BoxGeometry(hx * 2, h, hz * 2);
  const g = new THREE.Group(); g.position.set(x, h / 2, z);
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0c0b1c, roughness: 0.35, metalness: 0.75 })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(i % 2 ? 0xff2bd6 : 0x29f0ff).multiplyScalar(1.8), toneMapped: false })));
  scene.add(g);
  return { x, z, hx, hz, h, box: new THREE.Box3(new THREE.Vector3(x - hx, 0, z - hz), new THREE.Vector3(x + hx, h, z + hz)) };
});
// push a circle out of all cover boxes and keep it inside the arena
function collide(p, r, y = 0) {
  for (const c of covers) {
    if (y > c.h + 0.05) continue;
    const dx = p.x - clamp(p.x, c.x - c.hx, c.x + c.hx), dz = p.z - clamp(p.z, c.z - c.hz, c.z + c.hz), d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-5) { p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
      else { const ox = c.hx - Math.abs(p.x - c.x), oz = c.hz - Math.abs(p.z - c.z); if (ox < oz) p.x = c.x + Math.sign(p.x - c.x || 1) * (c.hx + r); else p.z = c.z + Math.sign(p.z - c.z || 1) * (c.hz + r); }
    }
  }
  const d = Math.hypot(p.x, p.z); if (d > ARENA_R - r) { p.x *= (ARENA_R - r) / d; p.z *= (ARENA_R - r) / d; }
}
const groundAt = (x, z, y) => { let g = 0; for (const c of covers) if (y >= c.h - 0.35 && Math.abs(x - c.x) < c.hx + 0.25 && Math.abs(z - c.z) < c.hz + 0.25) g = Math.max(g, c.h); return g; };

// ============================================================== procedural alien skin
function skinTextures(base, vein) {
  const S = 256, c = document.createElement('canvas'), e = document.createElement('canvas'); c.width = c.height = e.width = e.height = S;
  const x = c.getContext('2d'), y = e.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, S, S); y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.08})`; const r = rand(2, 14); x.beginPath(); x.arc(rand(0, S), rand(0, S), r, 0, 7); x.fill(); }
  for (let v = 0; v < 26; v++) {
    let px = rand(0, S), py = rand(0, S); const w = rand(0.8, 2.6);
    for (const ctx of [x, y]) { ctx.strokeStyle = ctx === x ? 'rgba(0,0,0,0.35)' : vein; ctx.lineWidth = w; }
    for (let s = 0; s < 14; s++) { const nx = px + rand(-18, 18), ny = py + rand(-18, 18); for (const ctx of [x, y]) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke(); } px = nx; py = ny; }
  }
  const t1 = new THREE.CanvasTexture(c), t2 = new THREE.CanvasTexture(e);
  for (const t of [t1, t2]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
  return [t1, t2];
}
const SKINS = { crawler: skinTextures('#2a2f24', '#9dff4a'), brute: skinTextures('#2b2230', '#ff3dbb'), spitter: skinTextures('#1f2a30', '#3dffe0') };
function skinMat(type) {
  const [map, em] = SKINS[type];
  const glow = { crawler: 0x9dff4a, brute: 0xff3dbb, spitter: 0x3dffe0 }[type];
  return new THREE.MeshPhysicalMaterial({ map, emissiveMap: em, emissive: new THREE.Color(glow), emissiveIntensity: 1.4, roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.35, transparent: true });
}

// ============================================================== aliens
const TYPES = {
  crawler: { hp: 55, speed: 3.5, dmg: 10, reach: 1.5, r: 0.7, score: 100, eye: 0xff3b2b },
  brute: { hp: 360, speed: 2.0, dmg: 28, reach: 2.4, r: 1.0, score: 400, eye: 0xffd23d },
  spitter: { hp: 120, speed: 2.8, dmg: 13, reach: 0, r: 0.55, score: 200, eye: 0x7dfff0 },
};
const aliens = [];
const seg = (mat, r1, r2, len) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 10), mat); m.position.y = -len / 2; return m; };
function limb(parent, mat, x, y, z, len1, len2, r) { // pivot -> upper -> knee pivot -> lower
  const hip = new THREE.Group(); hip.position.set(x, y, z); parent.add(hip);
  hip.add(seg(mat, r, r * 0.75, len1));
  const knee = new THREE.Group(); knee.position.y = -len1; hip.add(knee);
  knee.add(seg(mat, r * 0.75, r * 0.35, len2));
  const claw = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, r * 2.2, 6), mat); claw.position.y = -len2 - r; claw.rotation.x = Math.PI; knee.add(claw);
  return { hip, knee };
}
function eyes(head, n, color, r, spread, z) {
  const m = neon(color, 3);
  for (let i = 0; i < n; i++) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m); const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * spread; e.position.set(Math.sin(a) * z, (i % 2) * r * 1.4, Math.cos(a) * z); head.add(e); }
}
function buildAlien(type) {
  const T = TYPES[type], mat = skinMat(type), root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const a = { type, T, root, body, mat, hp: T.hp, maxHp: T.hp, legs: [], arms: [], hit: [], phase: Math.random() * 10, attackCd: 1, stagger: 0, alive: true, orbit: Math.random() < 0.5 ? 1 : -1, vel: new THREE.Vector3(), spawnT: 0, windup: 0, shootCd: rand(1.5, 3) };
  if (type === 'crawler') {
    body.position.y = 0.62;
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat); thorax.scale.set(1, 0.62, 1.25); body.add(thorax);
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat); abd.scale.set(0.95, 0.75, 1.3); abd.position.set(0, 0.12, -0.75); body.add(abd);
    const head = new THREE.Group(); head.position.set(0, 0.05, 0.72); body.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat); skull.scale.set(1, 0.8, 1.2); head.add(skull);
    eyes(head, 4, T.eye, 0.045, 1.4, 0.3);
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 6), mat); m.position.set(s * 0.12, -0.12, 0.3); m.rotation.set(Math.PI / 2.4, 0, -s * 0.4); head.add(m); }
    for (let i = 0; i < 6; i++) { const s = i % 2 ? 1 : -1, z = 0.35 - Math.floor(i / 2) * 0.35; const L = limb(body, mat, s * 0.38, 0, z, 0.55, 0.75, 0.06); L.hip.rotation.z = s * 1.0; L.knee.rotation.z = -s * 1.75; L.side = s; L.i = i; a.legs.push(L); }
    a.head = head; a.hit = [{ o: head, r: 0.34, head: true }, { o: thorax, r: 0.6 }, { o: abd, r: 0.55 }];
  } else if (type === 'brute') {
    body.position.y = 1.35;
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), mat); pelvis.scale.set(1.1, 0.7, 0.8); body.add(pelvis);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), mat); chest.scale.set(1.25, 0.95, 0.85); chest.position.set(0, 0.85, 0.15); chest.rotation.x = 0.25; body.add(chest);
    for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 6), neon(0xff3dbb, 1.6)); sp.position.set((i - 2) * 0.22, 1.2 - Math.abs(i - 2) * 0.08, -0.45); sp.rotation.x = -0.9; body.add(sp); }
    const head = new THREE.Group(); head.position.set(0, 1.45, 0.62); body.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat); skull.scale.set(1.1, 0.85, 1.15); head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.32), mat); jaw.position.set(0, -0.2, 0.08); head.add(jaw);
    eyes(head, 3, T.eye, 0.055, 1.0, 0.3);
    for (const s of [-1, 1]) {
      const A = limb(body, mat, s * 0.95, 1.05, 0.2, 0.95, 0.95, 0.17); A.hip.rotation.z = s * 0.25; A.side = s; a.arms.push(A);
      const L = limb(body, mat, s * 0.4, -0.15, 0, 0.7, 0.75, 0.19); L.side = s; a.legs.push(L);
    }
    a.head = head; a.hit = [{ o: head, r: 0.36, head: true }, { o: chest, r: 0.85 }, { o: pelvis, r: 0.6 }];
  } else {
    body.position.y = 1.15;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), mat); torso.scale.set(0.9, 1.3, 0.8); torso.position.y = 0.35; body.add(torso);
    const sac = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), new THREE.MeshPhysicalMaterial({ color: 0x3dffe0, emissive: 0x2bffd0, emissiveIntensity: 1.6, transparent: true, opacity: 0.85, roughness: 0.15, clearcoat: 1 }));
    sac.position.set(0, 0.55, -0.38); body.add(sac); a.sac = sac;
    const neck = new THREE.Group(); neck.position.set(0, 0.8, 0.1); body.add(neck);
    const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 8), mat); nk.position.y = 0.25; nk.rotation.x = 0.4; neck.add(nk);
    const head = new THREE.Group(); head.position.set(0, 0.52, 0.22); neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat); skull.scale.set(0.9, 0.8, 1.7); head.add(skull);
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), neon(0x3dffe0, 3)); mouth.position.set(0, -0.06, 0.32); head.add(mouth);
    eyes(head, 2, T.eye, 0.04, 1.2, 0.2);
    for (const s of [-1, 1]) {
      const L = limb(body, mat, s * 0.18, 0, 0, 0.62, 0.62, 0.08); L.side = s; a.legs.push(L);
      const A = limb(body, mat, s * 0.32, 0.6, 0.05, 0.45, 0.45, 0.05); A.hip.rotation.z = s * 0.35; A.side = s; a.arms.push(A);
    }
    a.head = head; a.neck = neck; a.hit = [{ o: head, r: 0.27, head: true }, { o: torso, r: 0.45 }, { o: sac, r: 0.34, sac: true }];
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(root);
  return a;
}

// ============================================================== effects
class Particles {
  constructor(n, color, size, additive = true) {
    this.n = n; this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.i = 0;
    this.p.fill(-999);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2), size, transparent: true, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(pos, dir, count, speed, spread, life = 0.8) {
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
      const s = speed * rand(0.3, 1.1);
      this.v[i * 3] = (dir.x + rand(-spread, spread)) * s; this.v[i * 3 + 1] = (dir.y + rand(-spread, spread) + 0.3) * s; this.v[i * 3 + 2] = (dir.z + rand(-spread, spread)) * s;
      this.life[i] = life * rand(0.6, 1.2);
    }
  }
  update(dt, grav = 9.8) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.p[i * 3 + 1] = -999; continue; }
      this.v[i * 3 + 1] -= grav * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.02) { this.p[i * 3 + 1] = 0.02; this.v[i * 3] *= 0.4; this.v[i * 3 + 2] *= 0.4; this.v[i * 3 + 1] *= -0.2; }
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
  }
}
const ichor = new Particles(2600, 0x7dff3a, 0.075), sparks = new Particles(1200, 0xffd27a, 0.05), acidFx = new Particles(800, 0x3dffe0, 0.08);
// pools of glowing ichor on the floor
const pools = [];
const poolGeo = new THREE.CircleGeometry(1, 18);
function pool(x, z, r, color = 0x7dff3a) {
  const m = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.011 + pools.length * 0.0001, z); m.scale.setScalar(0.1); scene.add(m);
  pools.push({ m, r, t: 0 }); if (pools.length > 70) { const o = pools.shift(); scene.remove(o.m); }
}
// tracers
const tracers = [];
function tracer(from, to, color = 0xfff0b0) {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.9, toneMapped: false }));
  scene.add(l); tracers.push({ l, t: 0.07 });
}
// shell casings
const casings = [];
const casingGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6), casingMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.3 });
// acid projectiles from spitters
const acid = [];
const acidGeo = new THREE.SphereGeometry(0.16, 12, 10), acidMat = neon(0x3dffe0, 2.2);

// ============================================================== audio (synthesised, positional)
let ac = null, master, verb, noiseBuf;
function initAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // a big room reverb from decaying noise
  verb = ac.createConvolver(); const L = ac.sampleRate * 1.6, ir = ac.createBuffer(2, L, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < L; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3.2); }
  verb.buffer = ir; const vg = ac.createGain(); vg.gain.value = 0.32; verb.connect(vg).connect(master);
  // low drone bed
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o1.type = o2.type = 'sawtooth'; o1.frequency.value = 41; o2.frequency.value = 41.6; f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = 0.04;
  o1.connect(f); o2.connect(f); f.connect(g).connect(master); o1.start(); o2.start();
}
function out(pos) { // positional output node (or plain master)
  if (!pos) return master;
  const p = ac.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.2; p.maxDistance = 120;
  p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; p.connect(master); p.connect(verb); return p;
}
function noise(dur, freq, q, vol, type = 'bandpass', dest = master, at = 0) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); const t = ac.currentTime + at; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function osc(type, f0, f1, dur, vol, dest = master, at = 0) {
  const o = ac.createOscillator(), g = ac.createGain(); const t = ac.currentTime + at; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
  shot(w) {
    if (!ac) return;
    const k = { ak: [0.2, 1150, 0.6], rifle: [0.16, 1400, 0.5], shotgun: [0.42, 700, 0.9], pistol: [0.12, 2000, 0.45] }[w] || [0.18, 1300, 0.5];
    noise(k[0], k[1], 0.7, k[2]); noise(0.03, 5000, 0.5, 0.35, 'highpass'); osc('sine', 120, 38, k[0] * 1.3, 0.7);
    noise(k[0] * 1.2, k[1] * 0.6, 0.6, k[2] * 0.4, 'bandpass', verb);
  },
  click() { if (ac) { noise(0.02, 3000, 3, 0.25); noise(0.025, 2200, 4, 0.2, 'bandpass', master, 0.08); } },
  reload(w) { if (!ac) return; noise(0.05, 1800, 3, 0.3, 'bandpass', master, 0.1); noise(0.06, 900, 2, 0.35, 'bandpass', master, w === 'shotgun' ? 0.5 : 0.7); noise(0.04, 2600, 5, 0.3, 'bandpass', master, w === 'shotgun' ? 0.9 : 1.15); },
  pump() { if (ac) { noise(0.06, 1200, 2, 0.35, 'bandpass', master, 0.18); noise(0.05, 1600, 3, 0.3, 'bandpass', master, 0.32); } },
  flesh(pos, head) { if (!ac) return; const d = out(pos); noise(0.09, 500, 1, 0.9, 'lowpass', d); if (head) osc('sine', 1700, 1500, 0.07, 0.18); },
  ping() { if (ac) osc('triangle', 1400, 1400, 0.06, 0.12); },
  swing() { if (ac) noise(0.18, 900, 0.8, 0.35, 'bandpass'); },
  butt() { if (ac) { osc('sine', 110, 45, 0.18, 0.9); noise(0.12, 400, 1, 0.8, 'lowpass'); noise(0.05, 2400, 2, 0.3, 'bandpass'); } },
  screech(pos, type) {
    if (!ac) return; const d = out(pos);
    const f = type === 'brute' ? 140 : type === 'spitter' ? 520 : 760;
    osc('sawtooth', f * 1.4, f * 0.6, 0.55, 0.22, d); osc('square', f * 2.1, f * 0.9, 0.4, 0.06, d); noise(0.35, f * 2, 3, 0.25, 'bandpass', d);
  },
  death(pos, type) { if (!ac) return; const d = out(pos); const f = type === 'brute' ? 90 : 300; osc('sawtooth', f, f * 0.3, 0.9, 0.25, d); noise(0.6, 700, 1, 0.4, 'lowpass', d); },
  spit(pos) { if (ac) { const d = out(pos); noise(0.25, 1400, 2, 0.4, 'bandpass', d); osc('sine', 300, 900, 0.2, 0.15, d); } },
  splash(pos) { if (ac) noise(0.3, 900, 1, 0.5, 'bandpass', out(pos)); },
  hurt() { if (ac) { osc('sine', 90, 40, 0.3, 0.8); noise(0.15, 300, 1, 0.6, 'lowpass'); } },
  step(run) { if (ac) noise(0.07, run ? 260 : 200, 1, run ? 0.35 : 0.22, 'lowpass'); },
  land() { if (ac) { noise(0.12, 180, 1, 0.6, 'lowpass'); } },
  wave() { if (ac) [196, 247, 294, 392].forEach((f, i) => osc('sawtooth', f, f, 0.45, 0.07, master, i * 0.12)); },
  heartbeat() { if (ac) { osc('sine', 60, 40, 0.15, 0.5); osc('sine', 55, 38, 0.15, 0.4, master, 0.22); } },
};
function updateListener() {
  if (!ac) return; const L = ac.listener, p = camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
}

// ============================================================== weapons (viewmodels built from parts)
const WEAPONS = [
  { id: 'ak', name: 'AK-74M', auto: true, rpm: 600, dmg: 34, head: 2.0, mag: 30, reload: 2.6, spread: 0.02, ads: 0.003, recoil: 0.017, kick: 0.05, pellets: 1, push: 1.2 },
];
const metal = new THREE.MeshStandardMaterial({ color: 0x1b1d26, metalness: 0.85, roughness: 0.32 });
const polymer = new THREE.MeshStandardMaterial({ color: 0x101117, metalness: 0.2, roughness: 0.75 });
const glove = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.1, roughness: 0.85 });
const bx = (w, h, d, x, y, z, m = metal) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r, l, x, y, z, m = metal) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 14), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); return o; };
function buildGun(id) {
  const g = new THREE.Group();
  const strip = neon(id === 'shotgun' ? 0xff2bd6 : 0x29f0ff, 2);
  if (id === 'rifle') {
    g.add(bx(0.06, 0.09, 0.42, 0, 0, -0.1), bx(0.055, 0.07, 0.26, 0, -0.005, -0.42, polymer), cyl(0.014, 0.28, 0, 0.012, -0.66), cyl(0.022, 0.06, 0, 0.012, -0.8));
    g.add(bx(0.04, 0.16, 0.06, 0, -0.12, -0.12, polymer).rotateX(0.18), bx(0.045, 0.12, 0.05, 0, -0.1, 0.08, polymer).rotateX(-0.3));
    g.add(bx(0.05, 0.08, 0.2, 0, -0.01, 0.22, polymer), bx(0.03, 0.05, 0.1, 0, 0.075, -0.12), bx(0.004, 0.03, 0.3, 0.031, 0.01, -0.2, strip));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), neon(0xff2030, 4)); dot.position.set(0, 0.085, -0.15); g.add(dot);
    g.userData = { muzzle: new THREE.Vector3(0, 0.012, -0.84), hip: new THREE.Vector3(0.2, -0.2, -0.38), aim: new THREE.Vector3(0, -0.085, -0.3), eject: new THREE.Vector3(0.04, 0.02, -0.05),
      rGrip: new THREE.Vector3(0.012, -0.075, -0.06), lGrip: new THREE.Vector3(-0.035, -0.055, -0.44), mag: new THREE.Vector3(-0.03, -0.17, -0.14) };
  } else if (id === 'shotgun') {
    g.add(bx(0.065, 0.09, 0.3, 0, 0, -0.05), cyl(0.022, 0.6, 0, 0.022, -0.5), cyl(0.018, 0.5, 0, -0.022, -0.44), bx(0.06, 0.06, 0.16, 0, -0.025, -0.4, polymer));
    g.add(bx(0.045, 0.13, 0.05, 0, -0.1, 0.05, polymer).rotateX(-0.35), bx(0.05, 0.085, 0.24, 0, -0.03, 0.24, polymer), bx(0.004, 0.025, 0.24, 0.034, 0.01, -0.1, strip));
    g.userData = { muzzle: new THREE.Vector3(0, 0.022, -0.82), hip: new THREE.Vector3(0.2, -0.21, -0.36), aim: new THREE.Vector3(0, -0.09, -0.28), eject: new THREE.Vector3(0.04, 0.02, -0.02), pump: g.children[3],
      rGrip: new THREE.Vector3(0.012, -0.06, 0.08), lGrip: new THREE.Vector3(-0.035, -0.06, -0.4), mag: new THREE.Vector3(-0.03, -0.06, -0.2), pumpHand: true };
  } else {
    g.add(bx(0.035, 0.045, 0.2, 0, 0.02, -0.06), bx(0.032, 0.11, 0.045, 0, -0.05, 0.02, polymer).rotateX(-0.25), cyl(0.009, 0.03, 0, 0.022, -0.17), bx(0.004, 0.012, 0.16, 0.019, 0.025, -0.06, strip));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), neon(0x7dff6a, 4)); dot.position.set(0, 0.048, -0.14); g.add(dot);
    g.userData = { muzzle: new THREE.Vector3(0, 0.022, -0.19), hip: new THREE.Vector3(0.17, -0.17, -0.34), aim: new THREE.Vector3(0, -0.052, -0.3), eject: new THREE.Vector3(0.02, 0.03, -0.03),
      rGrip: new THREE.Vector3(0.01, -0.03, 0.05), lGrip: new THREE.Vector3(-0.03, -0.06, 0.06), mag: new THREE.Vector3(-0.03, -0.14, 0.04), pistol: true };
  }
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}
const viewmodel = new THREE.Group(); camera.add(viewmodel);
// ---- the AK-74M in gloved first-person arms: "FPS AK-74m animations" by Cransh (CC BY 4.0), with idle, walk, run,
// shot, draw and three magazine-change reloads. The arms and rifle are one rig, so the hands are always on the gun.
const VM = { ready: false };
const VM_HIP = new THREE.Vector3(0.035, -0.055, -0.13);  // where the rig's eye bone sits relative to our camera (hip fire)
const SIGHT_H = 0.052;                                    // front-sight post height above the bore
const vmFill = new THREE.PointLight(0xdfe8ff, 2.2, 2.5, 1.5); vmFill.position.set(0.3, 0.25, 0.2); camera.add(vmFill); // keeps the gun readable in the dark arena
new GLTFLoader().load('/assets/ak74m_arms.glb', (g) => {
  const model = g.scene, holder = new THREE.Group();
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 1; } } });
  holder.add(model); viewmodel.add(holder); holder.rotation.y = Math.PI; // the rig faces +Z; our camera looks down -Z
  const mixer = new THREE.AnimationMixer(model), A = {};
  for (const c of g.animations) A[c.name.replace('Rig|', '')] = mixer.clipAction(c);
  for (const k of ['AK_Shot', 'AK_Reload', 'AK_Reload_full', 'AK_Reload_var2', 'AK_Draw']) { A[k].setLoop(THREE.LoopOnce, 1); A[k].clampWhenFinished = k !== 'AK_Shot'; }
  for (const k of ['AK_Idle', 'AK_Walk', 'AK_Run']) { A[k].play(); A[k].setEffectiveWeight(k === 'AK_Idle' ? 1 : 0); }
  mixer.update(0.01); model.updateMatrixWorld(true);
  const bone = (n) => model.getObjectByName(n);
  const head = bone('Head_Cam_014');
  model.position.copy(head.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert())).negate();
  Object.assign(VM, { ready: true, model, holder, mixer, A, base: A.AK_Idle, rif: bone('Rif_059'), muzzle: bone('Rif_end_079'), pmag: bone('Pmag_062'), cur: 'AK_Idle', baseQ: holder.quaternion.clone() });
  VM.durations = Object.fromEntries(g.animations.map((c) => [c.name.replace('Rig|', ''), c.duration]));
  try { renderer.compile(scene, camera); } catch {}
  if (game.state === 'play') vmDraw();
}, undefined, (e) => console.warn('weapon model failed', e));
function vmPlayBase(name) { if (VM.ready) VM.cur = name; }
// blend idle / walk / run, and let a reload or draw take the arms over completely
function vmWeights(dt) {
  const busy = P.reloading > 0 || (VM.drawT || 0) > 0;
  VM.drawT = Math.max(0, (VM.drawT || 0) - dt);
  for (const k of ['AK_Idle', 'AK_Walk', 'AK_Run']) {
    const a = VM.A[k], want = busy ? 0 : k === VM.cur ? 1 : 0;
    a.setEffectiveWeight(THREE.MathUtils.lerp(a.getEffectiveWeight(), want, Math.min(1, dt * (busy ? 14 : 7))));
  }
  for (const k of ['AK_Reload', 'AK_Reload_full', 'AK_Draw']) { const a = VM.A[k]; if (a.isRunning() || a.getEffectiveWeight() > 0) a.setEffectiveWeight(busy ? 1 : Math.max(0, a.getEffectiveWeight() - dt * 6)); }
}
function vmOneShot(name, scale = 1, weight = 1) {
  if (!VM.ready) return 0;
  const a = VM.A[name]; a.stop(); a.reset(); a.setEffectiveTimeScale(scale); a.setEffectiveWeight(weight); a.play();
  return VM.durations[name] / scale;
}
function vmDraw() { VM.drawT = vmOneShot('AK_Draw', 1, 1); SFX.click(); }
const muzzleWorld = () => (VM.ready ? VM.muzzle.getWorldPosition(new THREE.Vector3()) : camera.localToWorld(new THREE.Vector3(0.1, -0.1, -0.8)));
// a spent magazine that falls, bounces and lies on the floor
const magGeo = (() => { const g = []; for (let i = 0; i < 5; i++) g.push(new THREE.BoxGeometry(0.03, 0.05, 0.07).translate(0, -i * 0.045, -i * i * 0.004)); return g; })();
const magMat = new THREE.MeshStandardMaterial({ color: 0x2a221c, metalness: 0.4, roughness: 0.6 });
function dropMag() {
  const grp = new THREE.Group(); for (const geo of magGeo) grp.add(new THREE.Mesh(geo, magMat));
  const from = VM.ready && VM.pmag ? VM.pmag.getWorldPosition(new THREE.Vector3()) : camera.localToWorld(new THREE.Vector3(0.1, -0.3, -0.4));
  grp.position.copy(from); grp.quaternion.copy(camera.quaternion); scene.add(grp);
  casings.push({ m: grp, v: new THREE.Vector3(P.vel.x * 0.5, -0.5, P.vel.z * 0.5), spin: new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-3, 3)), t: 14, mag: true });
}

const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 2, 64, 64, 60); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = g; for (let i = 0; i < 7; i++) { x.save(); x.translate(64, 64); x.rotate((i / 7) * Math.PI * 2); x.fillRect(-6, 0, 12, 60); x.restore(); } x.beginPath(); x.arc(64, 64, 30, 0, 7); x.fill(); return new THREE.CanvasTexture(c); })();
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true })); flash.visible = false; scene.add(flash);
const flashLight = new THREE.PointLight(0xffb060, 0, 14, 2); camera.add(flashLight); flashLight.position.set(0.1, -0.05, -1.6);


// ============================================================== the player's own body (COD-style true first person)
// A rigged human (Quaternius Universal Animation Library, CC0) dressed in a tactical suit. The legs and torso play
// locomotion clips; the spine leans with your aim; both arms are solved with two-bone IK onto the gun's grips, and the
// fingers wrap the grip (trigger finger on the trigger). The head is hidden so the camera sits where your eyes are.
const BODY = { ready: false };
const nm = (n) => n.replace(/[.\[\]:/]/g, '');


const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
function setWorldQuat(bone, qWorld) { bone.parent.getWorldQuaternion(_q2); bone.quaternion.copy(_q2.invert().multiply(qWorld)); bone.updateMatrixWorld(true); }
function aimBone(bone, target) { // swing the bone so its +Y axis points at target
  bone.updateMatrixWorld(true);
  const pos = bone.getWorldPosition(new THREE.Vector3()), qw = bone.getWorldQuaternion(new THREE.Quaternion());
  const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(qw), want = target.clone().sub(pos).normalize();
  setWorldQuat(bone, new THREE.Quaternion().setFromUnitVectors(cur, want).multiply(qw));
}
function solveArm(side, target, pole, handY, handZ, curl) {
  const B_ = BODY.B, up = B_(`DEF-upper_arm.${side}`), fo = B_(`DEF-forearm.${side}`), ha = B_(`DEF-hand.${side}`);
  up.updateMatrixWorld(true);
  const S = up.getWorldPosition(new THREE.Vector3());
  const a = fo.position.length() * up.getWorldScale(_v1).x, b = ha.position.length() * fo.getWorldScale(_v1).x;
  const toT = target.clone().sub(S); const d = clamp(toT.length(), 0.05, a + b - 0.002); const n = toT.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pv = pole.clone().sub(S); const m = pv.sub(n.clone().multiplyScalar(pv.dot(n))).normalize();
  const elbow = S.clone().addScaledVector(n, a * cosA).addScaledVector(m, a * sinA);
  aimBone(up, elbow); aimBone(fo, S.clone().addScaledVector(n, d));
  // hand: Y = wrist→knuckles, Z = toward the index finger
  const Y = handY.clone().normalize(), Z = handZ.clone().sub(Y.clone().multiplyScalar(handZ.dot(Y))).normalize(), X = new THREE.Vector3().crossVectors(Y, Z);
  setWorldQuat(ha, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z)));
  // fingers wrap the grip
  for (const [f, k] of [['index', curl[0]], ['middle', curl[1]], ['ring', curl[1]], ['pinky', curl[1]]]) for (let j = 1; j <= 3; j++) {
    const bn = BODY.bones[nm(`DEF-f_${f}.0${j}.${side}`)]; if (!bn) continue;
    bn.quaternion.copy(BODY.rest[nm(bn.name)]).multiply(_q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), k * (j === 1 ? 0.9 : 1.1) * FINGER_SIGN));
  }
  for (let j = 1; j <= 3; j++) { const bn = BODY.bones[nm(`DEF-thumb.0${j}.${side}`)]; if (bn) bn.quaternion.copy(BODY.rest[nm(bn.name)]).multiply(_q1.setFromAxisAngle(new THREE.Vector3(0, 0, 1), curl[2] * (side === 'R' ? 1 : -1))); }
  ha.updateMatrixWorld(true);
}
let FINGER_SIGN = 1;
function updateBody() {}

// ============================================================== input
const keys = {}; let mouseDown = false, rightDown = false, locked = false;
addEventListener('keydown', (e) => { keys[e.code] = true; if (['Space', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault(); onKey(e.code); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (!locked) return; if (e.button === 0) mouseDown = true; if (e.button === 2) rightDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) rightDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (game.state === 'play') switchWeapon(e.deltaY > 0 ? 1 : -1); });
addEventListener('mousemove', (e) => { if (!locked || game.state !== 'play') return; const s = 0.0022 * (P.ads > 0.5 ? 0.6 : 1); P.yaw -= e.movementX * s; P.lookDX = (P.lookDX || 0) + e.movementX; P.pitch = clamp(P.pitch - e.movementY * s, -1.5, 1.5); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; if (!locked && game.state === 'play' && !usingPad) pause(); });
renderer.domElement.addEventListener('click', () => { if (game.state === 'play' && !locked) renderer.domElement.requestPointerLock(); });
function onKey(code) {
  if (code === 'KeyF') { if (document.fullscreenElement) document.exitFullscreen(); else goFullscreen(); return; }
  if (game.state === 'over' && (code === 'Enter' || code === 'Space')) return start();
  if (game.state !== 'play') return;
  if (code === 'KeyR') reload();
  if (code === 'Digit1') setWeapon(0); if (code === 'Digit2') setWeapon(1); if (code === 'Digit3') setWeapon(2);
  if (code === 'Space') jump();
  if (code === 'KeyV' || code === 'KeyQ') melee();
  if (code === 'KeyC' || code === 'ControlLeft') crouchPress();
}
// PS5 / standard gamepad, Fortnite default ("Combat Pro"-style) layout
let usingPad = false, padPrev = [], padIdx = -1;
addEventListener('gamepadconnected', (e) => { padIdx = e.gamepad.index; $('pad-status').textContent = `🎮 ${e.gamepad.id.replace(/\(.*\)/, '').trim() || 'Controller'} connected — press ✕ to play`; });
addEventListener('gamepaddisconnected', () => { padIdx = -1; $('pad-status').textContent = 'Controller disconnected — mouse & keyboard ready'; });
const B = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const pad = { lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0, sprint: false };
function rumble(strong, weak, ms) { const g = padIdx >= 0 && navigator.getGamepads()[padIdx]; g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {}); }
function pollPad(dt) {
  const gp = padIdx >= 0 ? navigator.getGamepads()[padIdx] : [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (!gp) { pad.lx = pad.ly = pad.rx = pad.ry = pad.l2 = pad.r2 = 0; return; }
  padIdx = gp.index;
  let bt = (i) => gp.buttons[i]?.pressed, edge = (i) => bt(i) && !padPrev[i];
  const dz = (x, y) => { const m = Math.hypot(x, y); if (m < 0.13) return [0, 0]; const k = (m - 0.13) / (0.87 * m); return [x * k, y * k]; };
  const std = gp.mapping === 'standard' || !/054c|sony|dualsense|wireless controller/i.test(gp.id);
  // raw Sony layout: buttons 0 □ 1 ✕ 2 ○ 3 △ 4 L1 5 R1 6 L2 7 R2 8 Create 9 Options 10 L3 11 R3; axes 0 LX 1 LY 2 RX 3 L2 4 R2 5 RY
  const MAP = std ? null : [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const btn = (i) => gp.buttons[MAP ? MAP[i] ?? i : i];
  bt = (i) => btn(i)?.pressed; edge = (i) => bt(i) && !padPrev[i];
  [pad.lx, pad.ly] = dz(gp.axes[0] || 0, gp.axes[1] || 0);
  [pad.rx, pad.ry] = std ? dz(gp.axes[2] || 0, gp.axes[3] || 0) : dz(gp.axes[2] || 0, gp.axes[5] || 0);
  pad.l2 = btn(B.L2)?.value || (!std && gp.axes[3] !== undefined ? (gp.axes[3] + 1) / 2 : 0);
  pad.r2 = btn(B.R2)?.value || (!std && gp.axes[4] !== undefined ? (gp.axes[4] + 1) / 2 : 0);
  const any = gp.buttons.some((b) => b.pressed) || Math.abs(pad.lx) + Math.abs(pad.rx) + Math.abs(pad.ly) + Math.abs(pad.ry) > 0;
  if (any) usingPad = true;
  if (game.state !== 'play') {
    if ((edge(B.CROSS) || edge(B.OPTIONS)) && ['menu', 'paused', 'over'].includes(game.state)) start();
  } else {
    if (edge(B.CROSS)) jump();
    if (edge(B.CIRCLE)) crouchPress();
    if (edge(B.R3)) melee();
    if (edge(B.SQUARE)) reload();
    if (edge(B.TRIANGLE) || edge(B.R1)) switchWeapon(1);
    if (edge(B.L1)) switchWeapon(-1);
    if (edge(B.L3)) pad.sprint = !pad.sprint;
    if (edge(B.OPTIONS)) pause();
    if (edge(B.L2)) aimAssistSnap();
    // look: Fortnite-like response curve, slower while aiming, sticky near targets
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
    let sens = 3.4 * (P.ads > 0.5 ? 0.55 : 1) * (aimFriction() ? 0.55 : 1);
    P.yaw -= curve(pad.rx) * sens * dt; P.pitch = clamp(P.pitch - curve(pad.ry) * sens * 0.75 * dt, -1.5, 1.5);
    if (Math.hypot(pad.lx, pad.ly) < 0.2) pad.sprint = false;
  }
  padPrev = Array.from({ length: 16 }, (_, i) => !!bt(i));
  $('pad-tag').textContent = usingPad ? '🎮 CONTROLLER' : '';
}

// ============================================================== player
const P = { pos: new THREE.Vector3(0, 0, 12), vel: new THREE.Vector3(), yaw: 0, pitch: 0, height: 1.68, hp: 100, lastHurt: -99, ground: true, crouch: false, slide: 0,
  ads: 0, weapon: 0, mags: [], reloading: 0, fireCd: 0, recoil: 0, recoilYaw: 0, kick: 0, bob: 0, stepT: 0, shake: 0, pumpT: 0, triggerHeld: false };
const game = { state: 'menu', t: 0, wave: 0, kills: 0, headshots: 0, toSpawn: 0, spawnT: 0, breakT: 0, alive: 0, deadT: 0, name: '' };
function jump() { if (P.ground && game.state === 'play') { P.vel.y = 6.6; P.ground = false; P.crouch = false; } }
function crouchPress() {
  const speed = Math.hypot(P.vel.x, P.vel.z);
  if (!P.crouch && speed > 9 && P.ground) { P.slide = 0.9; P.crouch = true; const f = new THREE.Vector3(P.vel.x, 0, P.vel.z).normalize(); P.vel.x = f.x * 15; P.vel.z = f.z * 15; SFX.land(); }
  else P.crouch = !P.crouch;
}
function setWeapon(i) {
  if (i === P.weapon || P.reloading > 0) { if (i !== P.weapon) P.reloading = 0; else return; }
  P.weapon = 0; P.fireCd = 0.35; P.reloading = 0; updateAmmo();
}
function switchWeapon(d) { setWeapon((P.weapon + d + WEAPONS.length) % WEAPONS.length); }
// gun-butt strike: a quick shove of the stock into whatever is in front of you
function melee() {
  if (game.state !== 'play' || (P.meleeT || 0) > 0 || P.reloading > 0) return;
  P.meleeT = 0.55; P.ads = 0; SFX.swing?.();
  setTimeout(() => {
    if (game.state !== 'play') return;
    const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    let hit = false;
    for (const a of aliens) {
      if (!a.alive) continue;
      const d = new THREE.Vector3(a.root.position.x - P.pos.x, 0, a.root.position.z - P.pos.z), dist = d.length();
      if (dist > 2.4 + a.T.r || d.normalize().dot(fwd) < 0.55) continue;
      const pt = a.hit[1].o.getWorldPosition(new THREE.Vector3());
      hit = true; a.stagger = 0.9; a.retreat = 1.2;
      damageAlien(a, 65, pt, fwd, 0, false);
      if (a.alive) { a.vel.addScaledVector(fwd, a.type === 'brute' ? 4 : 11); a.vel.y = a.type === 'brute' ? 1 : 3.5; }
    }
    if (hit) { SFX.butt(); rumble(1, 0.7, 160); P.shake += 0.25; hitMarker('kill'); } else SFX.swing();
  }, 140);
}
function reload() {
  const w = WEAPONS[P.weapon];
  if (P.reloading > 0 || P.mags[P.weapon] >= w.mag) return;
  const empty = P.mags[P.weapon] === 0, clip = empty ? 'AK_Reload_full' : 'AK_Reload';
  P.reloading = VM.ready ? vmOneShot(clip, 1.1) : w.reload; P.reloadMax = P.reloading; P.magDropped = false;
  SFX.reload(w.id); if (empty) setTimeout(() => SFX.click(), 2400); $('h-reload').textContent = 'RELOADING…';
}
// light aim assist on controller (Fortnite has it too): slow-down near targets, a small snap when you start aiming
function targetNearCrosshair(maxAngle) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); let best = null, bestA = maxAngle;
  for (const a of aliens) { if (!a.alive) continue; for (const h of a.hit) { const p = h.o.getWorldPosition(new THREE.Vector3()); const d = p.clone().sub(camera.position); const dist = d.length(); if (dist > 60) continue; const ang = f.angleTo(d); if (ang < bestA && !blocked(camera.position, p)) { bestA = ang; best = p; } } }
  return best;
}
const aimFriction = () => usingPad && !!targetNearCrosshair(0.07);
function aimAssistSnap() { if (!usingPad) return; const t = targetNearCrosshair(0.16); if (!t) return; const d = t.clone().sub(camera.position); const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); P.yaw += angDiff(yaw, P.yaw) * 0.6; P.pitch += (pitch - P.pitch) * 0.6; }
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const ray = new THREE.Ray();
function blocked(from, to) { ray.origin.copy(from); ray.direction.copy(to).sub(from).normalize(); const dist = from.distanceTo(to); const hit = new THREE.Vector3(); for (const c of covers) if (ray.intersectBox(c.box, hit) && hit.distanceTo(from) < dist) return true; return false; }

function hurt(dmg, from) {
  if (game.state !== 'play') return;
  P.hp -= dmg; P.lastHurt = game.t; P.shake = Math.min(1, P.shake + dmg / 25);
  SFX.hurt(); rumble(0.9, 0.6, 220);
  $('hurt').style.opacity = Math.min(1, 0.35 + dmg / 30); setTimeout(() => ($('hurt').style.opacity = P.hp < 35 ? 0.35 : 0), 220);
  if (from) { // a red arc pointing at the attacker
    const d = from.clone().sub(P.pos); const ang = angDiff(Math.atan2(-d.x, -d.z), P.yaw);
    const i = document.createElement('i'); i.style.transform = `rotate(${-ang}rad)`; $('dirs').appendChild(i); setTimeout(() => i.remove(), 1200);
  }
  if (P.hp <= 0) die();
}

// ============================================================== shooting
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function fire() {
  const w = WEAPONS[P.weapon];
  if (P.reloading > 0 || P.fireCd > 0) return;
  if (P.mags[P.weapon] <= 0) { SFX.click(); P.fireCd = 0.25; reload(); return; }
  P.mags[P.weapon]--; P.fireCd = 60 / w.rpm;
  SFX.shot(w.id); rumble(w.id === 'shotgun' ? 1 : 0.5, w.id === 'shotgun' ? 0.8 : 0.4, w.id === 'shotgun' ? 140 : 60);
  vmOneShot('AK_Shot', 1.9, 0.75);
  const muzzle = muzzleWorld();
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1, spread = THREE.MathUtils.lerp(w.spread, w.ads, P.ads) * (moving ? 1.5 : 1) * (P.crouch ? 0.75 : 1) * (P.ground ? 1 : 2) * (1 + P.recoil * 6);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  let anyHit = false, killed = false, headHit = false;
  for (let k = 0; k < w.pellets; k++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const res = raycastWorld(camera.position, dir, 150);
    tracer(muzzle, res.point, w.id === 'shotgun' ? 0xffd0a0 : 0xfff0b0);
    if (res.alien) {
      anyHit = true; headHit ||= res.head;
      let dmg = w.dmg * (res.head ? w.head : 1);
      if (w.falloff && res.dist > w.falloff) dmg *= Math.max(0.3, 1 - (res.dist - w.falloff) / 25);
      if (res.sac) dmg *= 1.6;
      if (damageAlien(res.alien, dmg, res.point, dir, w.push * (w.pellets > 1 ? 0.35 : 1), res.head)) killed = true;
    } else {
      sparks.emit(res.point, res.normal, 10, 4, 0.6, 0.35);
    }
  }
  if (anyHit) hitMarker(killed ? 'kill' : headHit ? 'head' : '');
  // recoil
  P.recoil += w.recoil * (1 - P.ads * 0.35); P.recoilYaw += rand(-1, 1) * w.recoil * 0.4; P.kick = Math.min(1, P.kick + w.kick * 4);
  // muzzle flash + light + casing
  flash.position.copy(muzzle).addScaledVector(fwd, 0.04); flash.material.rotation = Math.random() * 6; flash.scale.setScalar(0.32); flash.visible = true; flash.userData.t = 0.045;
  flashLight.intensity = w.id === 'shotgun' ? 9 : 5;
  const ej = (VM.ready ? VM.rif.getWorldPosition(new THREE.Vector3()) : muzzle.clone()).addScaledVector(right, 0.03).addScaledVector(up, 0.05); const m = new THREE.Mesh(casingGeo, casingMat); m.position.copy(ej); scene.add(m);
  casings.push({ m, v: right.clone().multiplyScalar(rand(1.8, 2.8)).addScaledVector(up, rand(1.2, 2)), spin: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), t: 4 });
  if (casings.length > 60) scene.remove(casings.shift().m);
  updateAmmo();
}
const sphereHit = (o, d, c, r) => { const oc = c.clone().sub(o); const t = oc.dot(d); if (t < 0) return -1; const d2 = oc.lengthSq() - t * t; if (d2 > r * r) return -1; return t - Math.sqrt(r * r - d2); };
function raycastWorld(origin, dir, max) {
  let best = { dist: max, point: origin.clone().addScaledVector(dir, max), normal: dir.clone().negate(), alien: null };
  ray.origin.copy(origin); ray.direction.copy(dir);
  const hp = new THREE.Vector3();
  for (const c of covers) if (ray.intersectBox(c.box, hp)) { const d = hp.distanceTo(origin); if (d < best.dist) { const n = new THREE.Vector3(); const cx = (hp.x - c.x) / c.hx, cz = (hp.z - c.z) / c.hz, cy = (hp.y - c.h / 2) / (c.h / 2); if (Math.abs(cx) > Math.abs(cz) && Math.abs(cx) > Math.abs(cy)) n.set(Math.sign(cx), 0, 0); else if (Math.abs(cz) > Math.abs(cy)) n.set(0, 0, Math.sign(cz)); else n.set(0, Math.sign(cy), 0); best = { dist: d, point: hp.clone(), normal: n, alien: null }; } }
  if (dir.y < 0) { const t = -origin.y / dir.y; if (t < best.dist) best = { dist: t, point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, 1, 0), alien: null }; }
  for (const a of aliens) {
    if (!a.alive) continue;
    if (a.root.position.distanceTo(origin) > best.dist + 3) continue;
    for (const h of a.hit) {
      const c = h.o.getWorldPosition(tmpV).clone(); const r = h.r * a.root.scale.x * 1.3;
      const t = sphereHit(origin, dir, c, r);
      if (t >= 0 && t < best.dist) { const p = origin.clone().addScaledVector(dir, t); best = { dist: t, point: p, normal: p.clone().sub(c).normalize(), alien: a, head: !!h.head, sac: !!h.sac }; }
    }
  }
  return best;
}
function hitMarker(kind) { const h = $('hitmark'); h.className = ''; void h.offsetWidth; h.className = 'on ' + kind; if (kind === 'head' || kind === 'kill') SFX.ping(); }

// ============================================================== alien life & death
function damageAlien(a, dmg, point, dir, push, head) {
  a.hp -= dmg; a.stagger = Math.max(a.stagger, a.type === 'brute' ? 0.12 : 0.3); a.hitFlash = 1;
  ichor.emit(point, dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.3, 0)), head ? 26 : 14, head ? 5 : 3.5, 0.7, 0.9);
  SFX.flesh(point, head);
  a.vel.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), push * (a.type === 'brute' ? 0.8 : 2.6)); // bullets knock them back
  a.flinch = 1;
  if (a.hp <= 0) { kill(a, dir, head, point); return true; }
  return false;
}
function kill(a, dir, head, point) {
  a.alive = false; a.deadT = 0; game.kills++; if (head) game.headshots++;
  a.fallDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  a.vel.addScaledVector(a.fallDir, a.type === 'brute' ? 2 : 5); a.vel.y = a.type === 'crawler' ? 3 : 1.5;
  a.spin = rand(-2, 2);
  // limbs go limp toward random angles
  a.limp = [...a.legs, ...a.arms].map(() => [rand(-1.2, 1.2), rand(-1.5, 1.5), rand(-0.5, 0.5)]);
  ichor.emit(point, new THREE.Vector3(0, 1, 0), head ? 70 : 40, 6, 1, 1.2);
  if (a.type === 'spitter') { acidFx.emit(a.sac.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), 120, 6, 1, 1.3); a.sac.visible = false; }
  if (head && a.head) { a.head.scale.setScalar(0.01); ichor.emit(point, new THREE.Vector3(0, 1, 0), 60, 7, 1.2, 1.3); }
  SFX.death(a.root.position, a.type); rumble(0.4, 0.3, 90);
  const li = document.createElement('li'); li.className = head ? 'hs' : ''; li.textContent = `${head ? '💥 HEADSHOT · ' : ''}${a.type.toUpperCase()} killed  +${a.T.score}`; $('killfeed').prepend(li); setTimeout(() => li.remove(), 3500);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
}
function spawnAlien(type, at, fromPortal) {
  const a = buildAlien(type); const hpScale = 0.8 + (game.wave - 1) * 0.08;
  a.hp = a.maxHp = a.T.hp * hpScale; a.speed = Math.min(4, a.T.speed * (0.7 + 0.3 * Math.min(1.4, diff())) * rand(0.92, 1.05)); // never more than half your walking speed
  a.root.position.set(at.x + rand(-1.5, 1.5), fromPortal ? 0 : -2.6, at.z + (fromPortal ? rand(0.5, 2) : rand(-1, 1)));
  a.rising = !fromPortal; a.root.rotation.y = Math.atan2(P.pos.x - at.x, P.pos.z - at.z);
  aliens.push(a); game.alive++;
  if (Math.random() < 0.5) SFX.screech(a.root.position, type);
  if (fromPortal) portalMat.uniforms.uFlash.value = 1;
}
function updateAliens(dt) {
  for (let i = aliens.length - 1; i >= 0; i--) {
    const a = aliens[i], R = a.root, T = a.T;
    if (!a.alive) { // ragdoll-ish collapse, then dissolve
      a.deadT += dt;
      a.vel.y -= 14 * dt; R.position.addScaledVector(a.vel, dt);
      if (R.position.y < 0) { R.position.y = 0; a.vel.y = 0; a.vel.x *= 0.85; a.vel.z *= 0.85; }
      const fall = Math.min(1, a.deadT * 2.4);
      const local = a.fallDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -R.rotation.y);
      a.body.rotation.x = THREE.MathUtils.lerp(a.body.rotation.x, local.z * (Math.PI / 2.1), fall * 0.2);
      a.body.rotation.z = THREE.MathUtils.lerp(a.body.rotation.z, -local.x * (Math.PI / 2.1), fall * 0.2);
      a.body.position.y = THREE.MathUtils.lerp(a.body.position.y, a.type === 'crawler' ? 0.35 : 0.45, fall * 0.15);
      R.rotation.y += a.spin * dt * (1 - fall);
      [...a.legs, ...a.arms].forEach((L, k) => { const t = a.limp[k]; L.hip.rotation.x += (t[0] - L.hip.rotation.x) * dt * 5; L.knee.rotation.x += (t[1] - L.knee.rotation.x) * dt * 5; });
      if (a.deadT > 0.8 && !a.pooled) { a.pooled = true; pool(R.position.x, R.position.z, a.type === 'brute' ? 2.4 : 1.4, a.type === 'spitter' ? 0x3dffe0 : 0x7dff3a); }
      if (a.deadT > 9) { a.mat.opacity = Math.max(0, 1 - (a.deadT - 9) / 2); R.position.y -= dt * 0.3; }
      if (a.deadT > 11) { scene.remove(R); aliens.splice(i, 1); }
      continue;
    }
    if (a.rising) { R.position.y += dt * 2.2; if (R.position.y >= 0) { R.position.y = 0; a.rising = false; } }
    a.phase += dt;
    const toP = new THREE.Vector3(P.pos.x - R.position.x, 0, P.pos.z - R.position.z), dist = toP.length(); toP.normalize();
    a.stagger = Math.max(0, a.stagger - dt); a.attackCd -= dt; a.retreat = Math.max(0, (a.retreat || 0) - dt);
    a.hitFlash = Math.max(0, (a.hitFlash || 0) - dt * 6); a.mat.emissiveIntensity = 1.4 + a.hitFlash * 6; a.flinch = Math.max(0, (a.flinch || 0) - dt * 5);
    let want = toP.clone(), speed = a.speed;
    if (a.type === 'spitter') { // keep range, strafe, spit acid
      if (dist < 11) want.negate(); else if (dist < 18) { want.set(-toP.z, 0, toP.x).multiplyScalar(Math.sin(a.phase * 0.5) > 0 ? 1 : -1); speed *= 0.6; }
      a.shootCd -= dt;
      if (a.shootCd <= 0 && dist < 34 && !a.rising) {
        a.shootCd = rand(2.2, 3.4);
        const from = a.head.getWorldPosition(new THREE.Vector3());
        const target = P.pos.clone().add(new THREE.Vector3(0, P.height - 0.3, 0)).addScaledVector(P.vel, dist / 16 * 0.6);
        if (!blocked(from, target)) { const v = target.clone().sub(from); const tFlight = v.length() / 16; v.divideScalar(tFlight); v.y += 4 * tFlight; const m = new THREE.Mesh(acidGeo, acidMat); m.position.copy(from); scene.add(m); acid.push({ m, v, t: 4 }); SFX.spit(from); }
      }
    }
    if (a.type === 'crawler') {
      if (a.retreat > 0) want.copy(toP).negate();                                   // backing off after a strike
      else if (dist < 7 && a.attackCd > 0) { want.set(-toP.z, 0, toP.x).multiplyScalar(a.orbit).addScaledVector(toP, dist < 5 ? -0.9 : 0.1); } // circle at range
      if (dist < 3.5 && a.attackCd <= 0 && !a.leap && !a.retreat) { a.leap = 0.4; a.vel.addScaledVector(toP, 4.5); a.vel.y = 2.4; SFX.screech(R.position, 'crawler'); }
    }
    if (a.type === 'brute' && a.retreat > 0) { want.copy(toP).negate(); speed *= 0.7; }
    if (a.leap) { a.leap -= dt; if (a.leap <= 0) a.leap = 0; }
    if (a.type === 'brute' && dist < T.reach + 0.6 && a.attackCd <= 0 && !a.windup) { a.windup = 0.55; SFX.screech(R.position, 'brute'); }
    if (a.windup) { a.windup -= dt; speed *= 0.2; if (a.windup <= 0) { a.windup = 0; a.attackCd = 2.4 / Math.min(1.5, diff()); a.retreat = 0.9; if (dist < T.reach + 0.5) { hurt(T.dmg * diff(), R.position); P.vel.addScaledVector(toP, 9); P.vel.y = 3; } } }
    if (a.type === 'crawler' && dist < T.reach && a.attackCd <= 0) { a.attackCd = 2.2 / Math.min(1.6, diff()); a.retreat = 1.6; a.leap = 0; a.vel.addScaledVector(toP, -6); hurt(T.dmg * diff(), R.position); }
    // separation from the pack
    for (const b of aliens) { if (b === a || !b.alive) continue; const dx = R.position.x - b.root.position.x, dz = R.position.z - b.root.position.z, d = Math.hypot(dx, dz), m = T.r + b.T.r; if (d < m && d > 1e-3) { want.x += (dx / d) * (m - d) * 2; want.z += (dz / d) * (m - d) * 2; } }
    want.y = 0; if (want.lengthSq() > 1) want.normalize();
    const moveSpeed = a.stagger > 0 || a.rising ? 0 : speed;
    a.vel.x += (want.x * moveSpeed - a.vel.x) * Math.min(1, dt * (a.leap ? 0.5 : 6)); a.vel.z += (want.z * moveSpeed - a.vel.z) * Math.min(1, dt * (a.leap ? 0.5 : 6));
    if (!a.rising) { a.vel.y -= 14 * dt; R.position.addScaledVector(a.vel, dt); if (R.position.y < 0) { R.position.y = 0; a.vel.y = 0; } }
    collide(R.position, T.r, R.position.y);
    { // solid: aliens can't stand inside you
      const dx = R.position.x - P.pos.x, dz = R.position.z - P.pos.z, d = Math.hypot(dx, dz), m = T.r + 0.6;
      if (d < m && d > 1e-3) { R.position.x = P.pos.x + (dx / d) * m; R.position.z = P.pos.z + (dz / d) * m; }
    }
    // face where it's going (or the player when close)
    const face = dist < 8 ? Math.atan2(toP.x, toP.z) : Math.atan2(a.vel.x, a.vel.z);
    R.rotation.y += angDiff(face, R.rotation.y) * Math.min(1, dt * 8);
    // procedural gait
    const hs = Math.hypot(a.vel.x, a.vel.z), cyc = a.phase * (a.type === 'crawler' ? 14 : a.type === 'brute' ? 5 : 8) * Math.min(1.4, 0.3 + hs / speed);
    if (a.type === 'crawler') a.legs.forEach((L) => { const ph = cyc + (L.i % 2 === Math.floor(L.i / 2) % 2 ? 0 : Math.PI); L.hip.rotation.y = Math.sin(ph) * 0.45 * Math.min(1, hs); L.hip.rotation.z = L.side * (1.0 + Math.max(0, Math.cos(ph)) * 0.35); });
    else {
      a.legs.forEach((L) => { const ph = cyc + (L.side > 0 ? 0 : Math.PI); L.hip.rotation.x = Math.sin(ph) * 0.6 * Math.min(1, hs / 2); L.knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * Math.min(1, hs / 2) + (a.type === 'brute' ? 0.15 : 0); });
      a.arms.forEach((A) => { const ph = cyc + (A.side > 0 ? Math.PI : 0); A.hip.rotation.x = a.windup ? -2.6 + a.windup * 2 : Math.sin(ph) * 0.5 - 0.2; A.knee.rotation.x = a.windup ? -0.4 : -0.5 - Math.abs(Math.sin(ph)) * 0.3; });
    }
    a.body.position.y += ((a.type === 'crawler' ? 0.62 : a.type === 'brute' ? 1.35 : 1.15) + Math.abs(Math.sin(cyc)) * 0.06 - a.body.position.y) * Math.min(1, dt * 10);
    a.body.rotation.x = (a.type === 'brute' ? 0.15 : 0) - a.flinch * 0.35 + (a.windup ? -0.2 : 0);
    if (a.sac) a.sac.scale.setScalar(1 + Math.sin(a.phase * 4) * 0.08 + (a.shootCd < 0.5 ? 0.25 : 0));
    if (Math.random() < dt * 0.06) SFX.screech(R.position, a.type);
  }
  // acid globs
  for (let i = acid.length - 1; i >= 0; i--) {
    const g = acid[i]; g.t -= dt; g.v.y -= 8 * dt; g.m.position.addScaledVector(g.v, dt);
    const head = P.pos.clone().add(new THREE.Vector3(0, P.height - 0.3, 0));
    let done = false;
    if (g.m.position.distanceTo(head) < 0.75 || (g.m.position.distanceTo(P.pos.clone().add(new THREE.Vector3(0, 0.8, 0))) < 0.7)) { hurt(TYPES.spitter.dmg * diff(), g.m.position.clone().sub(g.v)); done = true; }
    else if (g.m.position.y < 0.05 || covers.some((c) => c.box.containsPoint(g.m.position)) || g.t <= 0) { done = true; pool(g.m.position.x, g.m.position.z, 0.8, 0x3dffe0); SFX.splash(g.m.position); }
    if (done) { acidFx.emit(g.m.position, new THREE.Vector3(0, 1, 0), 30, 3, 1, 0.7); scene.remove(g.m); acid.splice(i, 1); }
    else if (Math.random() < 0.5) acidFx.emit(g.m.position, new THREE.Vector3(0, 0, 0), 1, 0.3, 1, 0.4);
  }
}

// ============================================================== waves
const SPAWNS = () => [PORTAL, ...RIFTS];
const diff = () => clamp(0.4 + (game.wave - 1) * 0.13 + game.t / 900, 0.4, 2.2); // 0.4 = first minute, ~1 by wave 5, keeps climbing
function startWave() {
  game.wave++; game.toSpawn = Math.min(70, 3 + Math.floor(game.wave * 2.5)); game.spawnT = 1.5; game.breakT = 0;
  banner(`WAVE ${game.wave}`, game.wave === 1 ? 'They are coming through the gate' : 'They are getting stronger'); SFX.wave();
}
function pickType() {
  const w = game.wave, r = Math.random();
  if (w >= 4 && r < Math.min(0.18, 0.04 + w * 0.012)) return 'brute';
  if (w >= 3 && r < Math.min(0.4, 0.15 + w * 0.03)) return 'spitter';
  return 'crawler';
}
function updateWaves(dt) {
  const living = aliens.filter((a) => a.alive).length;
  if (game.toSpawn > 0) {
    game.spawnT -= dt;
    if (game.spawnT <= 0 && living < Math.min(26, 3 + game.wave * 2)) {
      game.spawnT = Math.max(0.35, 2.2 / diff());
      const sp = SPAWNS(); const i = Math.random() < 0.45 ? 0 : 1 + Math.floor(Math.random() * RIFTS.length);
      spawnAlien(pickType(), sp[i], i === 0); game.toSpawn--;
      if (i > 0) riftMats[i - 1].opacity = 1;
    }
  } else if (living === 0) {
    if (game.breakT === 0) { game.breakT = 6; banner(`WAVE ${game.wave} CLEARED`, 'Reload. Breathe.'); P.hp = Math.min(100, P.hp + 25); }
    game.breakT -= dt; if (game.breakT <= 0.001) startWave();
  }
  $('h-left').textContent = living + game.toSpawn;
}
function banner(text, sub) { const b = $('banner'); b.innerHTML = `${text}<small>${sub || ''}</small>`; b.style.opacity = 1; clearTimeout(banner.t); banner.t = setTimeout(() => (b.style.opacity = 0), 2400); }

// ============================================================== game flow
function goFullscreen() { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); }
function start() {
  initAudio(); ac?.resume?.(); goFullscreen();
  if (game.state === 'paused') { game.state = 'play'; $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); if (!usingPad) renderer.domElement.requestPointerLock()?.catch?.(() => {}); return; }
  for (const a of aliens) scene.remove(a.root); aliens.length = 0;
  for (const g of acid) scene.remove(g.m); acid.length = 0;
  for (const p of pools) scene.remove(p.m); pools.length = 0;
  Object.assign(P, { pos: new THREE.Vector3(0, 0, 12), vel: new THREE.Vector3(), yaw: 0, pitch: 0, hp: 100, lastHurt: -99, crouch: false, slide: 0, ads: 0, reloading: 0, recoil: 0, recoilYaw: 0, shake: 0 });
  P.mags = WEAPONS.map((w) => w.mag); P.weapon = 0; vmDraw();
  Object.assign(game, { state: 'play', t: 0, wave: 0, kills: 0, headshots: 0, toSpawn: 0, breakT: 0, deadT: 0, name: ($('name').value || 'Player').trim().slice(0, 16) });
  try { localStorage.setItem('siege-name', game.name); } catch {}
  $('menu').classList.add('hidden'); $('over').classList.add('hidden'); $('hud').classList.remove('hidden'); $('hurt').style.opacity = 0;
  $('play').textContent = 'PLAY';
  if (!usingPad) renderer.domElement.requestPointerLock()?.catch?.(() => {});
  updateAmmo(); startWave();
}
function pause() {
  if (game.state !== 'play') return;
  game.state = 'paused'; $('play').textContent = 'RESUME'; $('menu').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function die() {
  game.state = 'dying'; game.deadT = 0; P.hp = 0; rumble(1, 1, 600);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(async () => {
    game.state = 'over';
    $('hud').classList.add('hidden'); $('over').classList.remove('hidden');
    $('o-time').textContent = fmt(game.t); $('o-wave').textContent = game.wave; $('o-kills').textContent = game.kills; $('o-hs').textContent = game.headshots;
    $('o-rank').textContent = 'Sending your score…';
    try {
      const r = await (await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: game.name, time: game.t, kills: game.kills, wave: game.wave, headshots: game.headshots }) })).json();
      $('o-rank').textContent = r.rank && r.rank <= 50 ? `#${r.rank} on the global board` : '';
      $('o-board').innerHTML = boardHtml(r.top || [], game.name, game.t);
    } catch { $('o-rank').textContent = ''; }
  }, 2200);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const boardHtml = (rows, me, myT) => rows.length ? `<table class="lb"><tr><th>#</th><th>CALLSIGN</th><th>SURVIVED</th><th>WAVE</th><th>KILLS</th></tr>${rows.map((r, i) => `<tr class="${r.name === me && Math.abs(r.time - myT) < 0.2 ? 'me' : ''}"><td>${i + 1}</td><td>${r.name.replace(/[<>&]/g, '')}</td><td>${fmt(r.time)}</td><td>${r.wave}</td><td>${r.kills}</td></tr>`).join('')}</table>` : '';
fetch('/api/scores').then((r) => r.json()).then((rows) => { $('board').innerHTML = rows.length ? `<h3 style="font-family:Orbitron;font-size:12px;letter-spacing:3px;color:#ff2bd6">LONGEST SURVIVORS</h3>${boardHtml(rows)}` : ''; }).catch(() => {});
try { $('name').value = localStorage.getItem('siege-name') || ''; } catch {}
$('play').onclick = start; $('again').onclick = start;

function updateAmmo() {
  const w = WEAPONS[P.weapon], m = P.mags[P.weapon] ?? w.mag;
  $('h-weapon').textContent = w.name; $('h-mag').textContent = m; $('h-mag').classList.toggle('low', m <= Math.ceil(w.mag * 0.25));
}

// ============================================================== main loop
const clock = new THREE.Clock();
function update(dt) {
  pollPad(dt);
  const t = clock.elapsedTime;
  portalMat.uniforms.uTime.value = t; portalMat.uniforms.uFlash.value = Math.max(0, portalMat.uniforms.uFlash.value - dt * 2); curtain.uniforms.uTime.value = t;
  portalLight.intensity = 40 + portalMat.uniforms.uFlash.value * 120 + Math.sin(t * 3) * 6;
  riftMats.forEach((m) => { m.opacity = Math.max(0.45 + Math.sin(t * 2) * 0.1, m.opacity - dt); });
  motes.rotation.y = t * 0.01;

  if (game.state === 'play') {
    game.t += dt;
    const w = WEAPONS[P.weapon];
    // movement
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.lx, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - pad.ly;
    const mlen = Math.hypot(mx, mz); if (mlen > 1) { mx /= mlen; mz /= mlen; }
    const sprint = (keys.ShiftLeft || pad.sprint) && mz > 0.3 && !P.crouch && P.ads < 0.5;
    if (sprint && P.reloading <= 0) P.ads = 0;
    const maxSpeed = (P.crouch ? 4 : sprint ? 12 : 8) * (P.ads > 0.5 ? 0.7 : 1);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const wantX = (fx * mz + rx * mx) * maxSpeed, wantZ = (fz * mz + rz * mx) * maxSpeed;
    if (P.slide > 0) { P.slide -= dt; P.vel.x *= 1 - dt * 1.2; P.vel.z *= 1 - dt * 1.2; }
    else { const acc = P.ground ? 16 : 4; P.vel.x += (wantX - P.vel.x) * Math.min(1, dt * acc); P.vel.z += (wantZ - P.vel.z) * Math.min(1, dt * acc); }
    P.vel.y -= 18 * dt;
    P.pos.addScaledVector(P.vel, dt);
    const gy = groundAt(P.pos.x, P.pos.z, P.pos.y);
    if (P.pos.y <= gy) { if (!P.ground && P.vel.y < -6) { SFX.land(); P.shake += 0.15; } P.pos.y = gy; P.vel.y = 0; P.ground = true; } else if (P.pos.y > gy + 0.05) P.ground = false;
    collide(P.pos, 0.42, P.pos.y);
    // footsteps
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (P.ground && hs > 1 && P.slide <= 0) { P.stepT -= dt * hs; if (P.stepT <= 0) { P.stepT = 2.3; SFX.step(sprint); } }
    P.bob += dt * hs * 1.6;
    // aim, fire, reload
    const adsHeld = rightDown || pad.l2 > 0.4;
    P.ads += ((adsHeld && !sprint ? 1 : 0) - P.ads) * Math.min(1, dt * 12);
    P.fireCd -= dt;
    const trigger = mouseDown || pad.r2 > 0.4;
    if (trigger && (w.auto || !P.triggerHeld) && !((P.meleeT || 0) > 0)) fire();
    P.triggerHeld = trigger;
    if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) { P.mags[P.weapon] = w.mag; vmPlayBase('AK_Idle'); $('h-reload').textContent = ''; updateAmmo(); } }
    // regen
    if (game.t - P.lastHurt > 4 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 9);
    if (P.hp < 30 && Math.floor(game.t * 1.3) !== Math.floor((game.t - dt) * 1.3)) SFX.heartbeat();
    updateWaves(dt);
    $('h-time').textContent = fmt(game.t); $('h-wave').textContent = game.wave; $('h-kills').textContent = game.kills;
    $('h-hp').style.width = `${P.hp}%`; $('h-hp').classList.toggle('low', P.hp < 35); $('h-hpn').textContent = Math.ceil(P.hp);
    const ch = $('crosshair'); ch.classList.toggle('ads', P.ads > 0.6); ch.style.setProperty('--gap', `${6 + (THREE.MathUtils.lerp(w.spread, w.ads, P.ads) * (hs > 1 ? 1.5 : 1)) * 420 + P.recoil * 300}px`);
  }
  if (game.state === 'play' || game.state === 'dying' || game.state === 'paused') {
    if (game.state !== 'paused') updateAliens(dt);
  }
  if (game.state === 'dying') { game.deadT += dt; P.pitch += (0.5 - P.pitch) * dt * 2; }

  // camera: recoil recovery, shake, crouch, bob
  P.recoil *= Math.pow(0.0006, dt); P.recoilYaw *= Math.pow(0.001, dt); P.kick *= Math.pow(0.0005, dt); P.shake *= Math.pow(0.02, dt);
  const eye = game.state === 'dying' ? Math.max(0.25, P.height - game.deadT * 1.4) : P.crouch ? 1.05 : P.height;
  P.eyeY = THREE.MathUtils.lerp(P.eyeY ?? eye, eye, Math.min(1, dt * 10));
  const bobY = Math.sin(P.bob * 2) * 0.035 * (1 - P.ads * 0.85), bobX = Math.cos(P.bob) * 0.025 * (1 - P.ads * 0.85);
  camera.position.set(P.pos.x + (Math.random() - 0.5) * P.shake * 0.12, P.pos.y + P.eyeY + bobY + (Math.random() - 0.5) * P.shake * 0.12, P.pos.z);
  camera.rotation.set(P.pitch + P.recoil, P.yaw + P.recoilYaw, game.state === 'dying' ? Math.min(0.7, game.deadT * 0.6) : 0);
  const fov = 78 - P.ads * 22; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // viewmodel: hip ↔ sights, bob, sway, kick, shotgun pump
  viewmodel.visible = game.state === 'play' || game.state === 'paused';
  if (VM.ready && viewmodel.visible) {
    const hs2 = Math.hypot(P.vel.x, P.vel.z), sprinting = hs2 > 9.5 && P.ground && P.ads < 0.3 && P.reloading <= 0;
    vmPlayBase(sprinting ? 'AK_Run' : hs2 > 1 && P.ground && P.ads < 0.5 ? 'AK_Walk' : 'AK_Idle');
    VM.A.AK_Walk.setEffectiveTimeScale(clamp(hs2 / 7, 0.7, 1.4));
    vmWeights(dt); VM.mixer.update(game.state === 'paused' ? 0 : dt);
    // the old magazine leaves the gun and falls
    if (P.reloading > 0 && !P.magDropped && P.reloadMax - P.reloading > 0.55) { P.magDropped = true; dropMag(); }
    // hip pose with weapon sway, then blend to sights: rotate the barrel onto the view axis and lift the front post to the crosshair
    VM.swayX = THREE.MathUtils.lerp(VM.swayX || 0, -(pad.rx * 0.02) + (P.lookDX || 0) * -0.0004, Math.min(1, dt * 8));
    VM.holder.quaternion.copy(VM.baseQ); VM.holder.position.copy(VM_HIP).add(new THREE.Vector3(bobX * 0.4 + VM.swayX, bobY * 0.35, P.kick * 0.05));
    if (P.ads > 0.01) {
      VM.holder.updateMatrixWorld(true);
      const m = camera.worldToLocal(VM.muzzle.getWorldPosition(new THREE.Vector3())), r = camera.worldToLocal(VM.rif.getWorldPosition(new THREE.Vector3()));
      const q = new THREE.Quaternion().setFromUnitVectors(m.clone().sub(r).normalize(), new THREE.Vector3(0, 0, -1));
      VM.holder.quaternion.premultiply(new THREE.Quaternion().slerp(q, P.ads));
      VM.holder.updateMatrixWorld(true);
      const m2 = camera.worldToLocal(VM.muzzle.getWorldPosition(new THREE.Vector3()));
      VM.holder.position.x -= m2.x * P.ads; VM.holder.position.y -= (m2.y + SIGHT_H) * P.ads;
    }
  }
  if ((P.meleeT || 0) > 0 && VM.ready) {
    P.meleeT = Math.max(0, P.meleeT - dt);
    const k = 1 - P.meleeT / 0.55, sw = Math.sin(Math.min(1, k * 1.6) * Math.PI);
    VM.holder.position.add(new THREE.Vector3(-0.12 * sw, 0.06 * sw, -0.3 * sw));
    VM.holder.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * sw, 0.35 * sw, 0.9 * sw)));
  }
  P.lookDX = 0;
  if (flash.visible) { flash.position.copy(muzzleWorld()).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 0.04); flash.userData.t -= dt; if (flash.userData.t <= 0) flash.visible = false; }
  flashLight.intensity *= Math.pow(0.0001, dt);

  // effects
  ichor.update(dt); sparks.update(dt); acidFx.update(dt, 6);
  for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.t -= dt; tr.l.material.opacity = Math.max(0, tr.t / 0.07); if (tr.t <= 0) { scene.remove(tr.l); tr.l.geometry.dispose(); tracers.splice(i, 1); } }
  for (let i = casings.length - 1; i >= 0; i--) { const c = casings[i]; c.t -= dt; c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; if (c.m.position.y < 0.01) { c.m.position.y = 0.01; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y) * 0.4; c.spin.multiplyScalar(0.5); } if (c.t <= 0) { scene.remove(c.m); casings.splice(i, 1); } }
  for (const p of pools) { p.t += dt; p.m.scale.setScalar(Math.min(p.r, 0.1 + p.t * p.r * 1.5)); if (p.t > 25) p.m.material.opacity = Math.max(0, 0.75 - (p.t - 25) / 8); }
  updateListener();
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  try { update(dt); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('frame error', e); } }
  composer.render();
}
// menu backdrop: the camera drifts around the arena
camera.position.set(0, 1.7, 12);
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); });
// test hook for automated screenshots
window.__siege = { game, P, aliens, spawnAlien, start, fire, TYPES, kill, damageAlien, VM, reload };
