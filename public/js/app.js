// Neon Hive client: a neon arena where glowing AI minds attack puzzles, and every solve splits a mind in two.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const $ = (id) => document.getElementById(id);
const GATE = new THREE.Vector3(0, 5.6, -9); // where the puzzle hangs in the world

// ---------------------------------------------------------------- renderer & scene
const host = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer(); labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 3 });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04030b);
scene.fog = new THREE.FogExp2(0x070418, 0.028);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 6.5, 14);
const controls = new OrbitControls(camera, renderer.domElement);
let dragging = false; controls.addEventListener('start', () => { dragging = true; }); controls.addEventListener('end', () => { setTimeout(() => { dragging = false; }, 4000); });
controls.target.set(0, 2.8, -3); controls.enableDamping = true; controls.minDistance = 6; controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49; controls.autoRotate = true; controls.autoRotateSpeed = 0.25;

scene.add(new THREE.HemisphereLight(0x6a5cff, 0x080010, 0.35));
const key = new THREE.PointLight(0x29f0ff, 12, 40, 1.6); key.position.set(-6, 8, 6); scene.add(key);
const rim = new THREE.PointLight(0xff2bd6, 12, 40, 1.6); rim.position.set(7, 6, -6); scene.add(rim);
const gateLight = new THREE.PointLight(0x29f0ff, 10, 24, 1.8); gateLight.position.copy(GATE).add(new THREE.Vector3(0, 0, 2)); scene.add(gateLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- the arena
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uPulseCol: { value: new THREE.Color(0x29f0ff) }, uFog: { value: new THREE.Color(0x070418) } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform float uTime, uPulse; uniform vec3 uPulseCol, uFog; varying vec3 vW;
    float grid(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) * s; vec2 fw = fwidth(p) * 1.2; vec2 l = 1. - smoothstep(vec2(0.), fw + w, g); return max(l.x, l.y); }
    void main(){
      float d = length(vW.xz);
      float g1 = grid(vW.xz, 1.0, 0.012), g2 = grid(vW.xz, 5.0, 0.03);
      vec3 col = vec3(0.012, 0.01, 0.03);
      col += vec3(0.05, 0.6, 0.85) * g1 * 0.22 + vec3(0.9, 0.15, 0.85) * g2 * 0.45;
      float ring = smoothstep(0.35, 0., abs(d - uPulse * 26.)) * (1. - uPulse);
      col += uPulseCol * ring * 2.2;
      col += vec3(0.1, 0.5, 0.9) * 0.08 * smoothstep(9., 0., d);
      float fog = 1. - exp(-pow(d * 0.035, 2.));
      gl_FragColor = vec4(mix(col, uFog, fog), 1.);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), floorMat); floor.rotation.x = -Math.PI / 2; scene.add(floor);

// the puzzle gate: a neon frame with a shimmering field
const gate = new THREE.Group(); gate.position.copy(GATE); scene.add(gate);
const neon = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, toneMapped: false });
const frameMat = neon(new THREE.Color(0x29f0ff).multiplyScalar(2.2));
const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frameMat); m.position.set(x, y, 0); gate.add(m); };
bar(10.4, 0.14, 0, 3.1); bar(10.4, 0.14, 0, -3.1); bar(0.14, 6.3, -5.2, 0); bar(0.14, 6.3, 5.2, 0);
const fieldMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0x29f0ff) }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uFlash; uniform vec3 uCol; varying vec2 vUv;
    void main(){ float s = sin(vUv.y * 140. + uTime * 4.) * 0.5 + 0.5; float n = fract(sin(dot(floor(vUv * vec2(60., 34.)) + floor(uTime * 8.), vec2(12.9898, 78.233))) * 43758.5453);
      float a = 0.06 + 0.05 * s + 0.05 * step(0.93, n) + uFlash * 0.5; gl_FragColor = vec4(uCol * (1.0 + uFlash * 2.), a); }`,
});
const field = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 6.1), fieldMat); gate.add(field);

// skyline of neon towers and drifting motes
const towers = new THREE.Group(); scene.add(towers);
{
  const cols = [0x29f0ff, 0xff2bd6, 0x7a5cff, 0x29f0ff, 0xffc23d];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + Math.random() * 0.1, r = 34 + Math.random() * 30, h = 6 + Math.random() * 26, w = 1.5 + Math.random() * 3;
    const geo = new THREE.BoxGeometry(w, h, w); const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(1.6), toneMapped: false }));
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x05040e, roughness: 0.4, metalness: 0.8 }));
    const g = new THREE.Group(); g.add(body, edges); g.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); towers.add(g);
  }
  const N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 90; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fdcff, size: 0.08, transparent: true, opacity: 0.7, toneMapped: false })); scene.add(motes);
}

// ---------------------------------------------------------------- the minds
const minds = new Map(); // id -> { group, core, visor, halo, mat, target, label, nameTag, ... }
const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.8, 6, 16), headGeo = new THREE.SphereGeometry(0.3, 24, 16);
const visorGeo = new THREE.BoxGeometry(0.4, 0.07, 0.1), haloGeo = new THREE.TorusGeometry(0.55, 0.025, 8, 48), coreGeo = new THREE.IcosahedronGeometry(0.13, 1);
const hueColor = (h, l = 0.6) => new THREE.Color().setHSL(h / 360, 1, l);

function slotFor(i, n) {
  // an amphitheatre of arcs facing the gate; the first mind stands alone at the front
  if (i === 0) return new THREE.Vector3(0, 0, -3.2);
  let ring = 1, start = 1;
  while (true) {
    const R = 6 + ring * 2.1, cap = Math.floor((R * 2.1) / 1.25);
    if (i < start + cap) { const k = i - start, a = -1.05 + (cap > 1 ? (k / (cap - 1)) * 2.1 : 0); return new THREE.Vector3(Math.sin(a) * R, 0, GATE.z + Math.cos(a) * R); }
    start += cap; ring++;
  }
}
function makeMind(a) {
  const col = hueColor(a.hue), g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x15152a, metalness: 0.7, roughness: 0.35, emissive: col.clone().multiplyScalar(0.06) });
  const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 1.0;
  const head = new THREE.Mesh(headGeo, mat); head.position.y = 1.85;
  const glow = neon(col.clone().multiplyScalar(2.6));
  const visor = new THREE.Mesh(visorGeo, glow); visor.position.set(0, 1.88, 0.25);
  const core = new THREE.Mesh(coreGeo, glow); core.position.set(0, 1.12, 0.3);
  const halo = new THREE.Mesh(haloGeo, glow); halo.rotation.x = Math.PI / 2; halo.position.y = 0.05;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), glow); spine.position.set(0, 1.0, 0.33);
  g.add(body, head, visor, core, halo, spine);
  // thought bubble + name tag
  const bubble = document.createElement('div'); bubble.className = 'label'; bubble.style.opacity = 0; bubble.style.color = `hsl(${a.hue},100%,70%)`;
  const label = new CSS2DObject(bubble); label.position.set(0, 2.55, 0); g.add(label);
  const tagEl = document.createElement('div'); tagEl.className = 'label name'; tagEl.textContent = a.name; tagEl.style.color = `hsl(${a.hue},100%,75%)`;
  const tag = new CSS2DObject(tagEl); tag.position.set(0, -0.15, 0.6); g.add(tag);
  scene.add(g);
  return { a, g, mat, glow, core, halo, visor, head, bubble, bubbleUntil: 0, target: new THREE.Vector3(), phase: Math.random() * 6, spawnT: 1, flash: 0, flashCol: new THREE.Color() };
}
function say(m, text, color, secs = 5) {
  m.bubble.textContent = text; m.bubble.style.color = color || `hsl(${m.a.hue},100%,70%)`; m.bubble.style.opacity = 1; m.bubbleUntil = performance.now() + secs * 1000;
}

// beams from a thinking mind to the gate
const beams = [];
function beam(m, color, life = 1.6) {
  const from = m.g.position.clone().add(new THREE.Vector3(0, 1.88, 0));
  const to = GATE.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, 0.1));
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(2.5), transparent: true, opacity: 1, toneMapped: false }));
  scene.add(line); beams.push({ line, life, max: life });
}
// particle bursts
const bursts = [];
function burst(pos, color, n = 140, speed = 5) {
  const p = new Float32Array(n * 3), v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p.set([pos.x, pos.y, pos.z], i * 3); const d = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random())); d.y = Math.abs(d.y) * 0.8 + 1; v.set([d.x, d.y, d.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: color.clone().multiplyScalar(2.5), size: 0.09, transparent: true, toneMapped: false }));
  scene.add(pts); bursts.push({ pts, v, life: 1.6 });
}

// ---------------------------------------------------------------- sound (tiny synth, starts on ENTER)
let ac = null;
function tone(freq, dur = 0.25, type = 'sine', vol = 0.08, slide = 0) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, ac.currentTime + dur);
  g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
}
const sfx = {
  think: () => tone(660 + Math.random() * 300, 0.08, 'triangle', 0.025),
  wrong: () => tone(180, 0.35, 'sawtooth', 0.04, 0.6),
  solved: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.07), i * 90)),
  clone: () => tone(220, 0.9, 'sine', 0.08, 4),
  fail: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'square', 0.035), i * 160)),
};
function drone() {
  if (!ac) return;
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 55; o2.frequency.value = 55.4; f.type = 'lowpass'; f.frequency.value = 320; g.gain.value = 0.035;
  o1.connect(f); o2.connect(f); f.connect(g).connect(ac.destination); o1.start(); o2.start();
}
$('enter').onclick = () => { $('splash').classList.add('gone'); try { ac = new (window.AudioContext || window.webkitAudioContext)(); drone(); } catch {} };

// ---------------------------------------------------------------- state from the hive
let lastFeed = '', state = null, pulse = 1, pulseCol = new THREE.Color(0x29f0ff), fieldFlash = 0;
function applyState(s) {
  state = s;
  $('s-level').textContent = s.level; $('s-minds').textContent = s.agents.length; $('s-solved').textContent = s.stats.solved; $('s-failed').textContent = s.stats.failed; $('s-assists').textContent = s.stats.assists;
  $('mode').textContent = !s.ai ? 'SIMULATION MODE — add GROQ_API_KEY for real AI' : s.resting ? 'THE HIVE RESTS WHILE NO ONE WATCHES' : 'LIVE AI · GROQ';
  // minds: add / remove / re-slot
  const ids = new Set(s.agents.map((a) => a.id));
  for (const [id, m] of minds) if (!ids.has(id)) { burst(m.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Color(0xff3b5c), 120, 3); scene.remove(m.g); m.bubble.remove(); m.g.traverse((o) => o.element?.remove?.()); minds.delete(id); }
  s.agents.forEach((a, i) => {
    let m = minds.get(a.id);
    if (!m) {
      m = makeMind(a); minds.set(a.id, m);
      const parent = minds.get(a.parent);
      if (parent && !s.full) { m.g.position.copy(parent.g.position); m.spawnT = 0; m.g.scale.setScalar(0.05); }
      else m.g.position.copy(slotFor(i, s.agents.length));
    }
    m.a = a; m.target.copy(slotFor(i, s.agents.length));
  });
  // puzzle panel
  const p = s.puzzle;
  if (p) {
    $('p-level').textContent = `LEVEL ${p.level}`; $('p-title').textContent = p.title.toUpperCase();
    if ($('p-prompt').textContent !== p.prompt) { $('p-prompt').textContent = p.prompt; $('p-prompt').classList.toggle('code', !!p.code); }
    $('p-hint').textContent = p.hint ? `HINT · ${p.hint}` : '';
    $('p-timer').style.width = `${Math.max(0, 100 - (p.elapsed / p.limit) * 100)}%`;
    $('p-tried').innerHTML = p.tried.map((t) => `<span title="${t.by}">${escapeHtml(t.answer)}</span>`).join('');
    const box = $('puzzle');
    if (!p.done) { box.classList.remove('solved', 'failed'); $('p-answer').textContent = ''; $('p-answer').className = ''; }
  }
  // events drive the show
  for (const e of s.events || []) handleEvent(e);
  // log
  const feedHtml = (s.feed || []).map((f) => `<li class="${f.type}">${escapeHtml(f.text)}</li>`).join('');
  if (feedHtml !== lastFeed) { lastFeed = feedHtml; $('feed-list').innerHTML = feedHtml; }
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function handleEvent(e) {
  const m = e.agent ? minds.get(e.agent) : null;
  switch (e.type) {
    case 'think': if (m) { say(m, '◌ thinking…', null, 30); beam(m, hueColor(m.a.hue)); sfx.think(); } break;
    case 'glitch': if (m) say(m, '… signal lost', '#7c93b5', 3); break;
    case 'wrong':
      if (m) { say(m, `✗ ${e.answer}${e.thought ? ' — ' + e.thought : ''}`, '#ff6b85', 6); m.flash = 1; m.flashCol.set(0xff3b5c); }
      sfx.wrong(); break;
    case 'right':
      if (m) { say(m, `✓ ${e.answer}${e.thought ? ' — ' + e.thought : ''}`, '#9dff8f', 8); m.flash = 1.5; m.flashCol.set(0x7dff6a); beam(m, new THREE.Color(0x7dff6a), 2.5); }
      break;
    case 'solved':
      $('puzzle').classList.add('solved'); $('p-answer').textContent = `✓ SOLVED · ${e.answer}`; $('p-answer').className = 'ok';
      pulse = 0; pulseCol.set(0x7dff6a); fieldFlash = 1; fieldMat.uniforms.uCol.value.set(0x7dff6a); sfx.solved();
      burst(GATE.clone(), new THREE.Color(0x7dff6a), 160, 5); break;
    case 'clone': {
      const c = minds.get(e.agent), parent = minds.get(e.parent);
      if (c && parent) { c.g.position.copy(parent.g.position); c.spawnT = 0; c.g.scale.setScalar(0.05); burst(parent.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)), hueColor(c.a.hue), 200, 4); say(c, '✦ I am born', null, 4); }
      setTimeout(sfx.clone, 300); break;
    }
    case 'failed':
      $('puzzle').classList.add('failed'); $('p-answer').textContent = `✗ TIME'S UP · answer: ${e.answer}`; $('p-answer').className = 'bad';
      pulse = 0; pulseCol.set(0xff3b5c); fieldFlash = 1; fieldMat.uniforms.uCol.value.set(0xff3b5c); sfx.fail(); break;
    case 'puzzle': fieldMat.uniforms.uCol.value.set(0x29f0ff); pulse = 0; pulseCol.set(0x29f0ff); break;
    case 'assist': if (m) say(m, '✦ absorbing the player\'s answer', '#ffc23d', 5); break;
  }
}

// ---------------------------------------------------------------- connection
let ws;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.t === 'state') applyState(m); else if (m.t === 'answerResult') showResult(m); };
  ws.onclose = () => setTimeout(connect, 1500);
}
connect();
function showResult(r) {
  const el = $('help-result');
  el.textContent = r.closed ? 'This puzzle is already closed — wait for the next one.' : r.ok ? '✓ Correct! The hive absorbs your answer.' : '✗ Not quite. The hive notes your guess.';
  el.className = r.ok ? 'ok' : 'bad'; clearTimeout(showResult.t); showResult.t = setTimeout(() => { el.textContent = ''; }, 3500);
}
$('help').onsubmit = (e) => {
  e.preventDefault(); const v = $('help-input').value.trim(); if (!v || ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'answer', text: v })); $('help-input').value = '';
};

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  floorMat.uniforms.uTime.value = t; fieldMat.uniforms.uTime.value = t;
  pulse = Math.min(1, pulse + dt * 0.45); floorMat.uniforms.uPulse.value = pulse; floorMat.uniforms.uPulseCol.value.copy(pulseCol);
  fieldFlash = Math.max(0, fieldFlash - dt * 1.2); fieldMat.uniforms.uFlash.value = fieldFlash * 0.45;
  frameMat.color.copy(fieldMat.uniforms.uCol.value).multiplyScalar(2.2 + fieldFlash);
  gateLight.color.copy(fieldMat.uniforms.uCol.value); gateLight.intensity = 10 + fieldFlash * 30;
  gate.position.y = GATE.y + Math.sin(t * 0.8) * 0.08;
  motes.rotation.y = t * 0.01;
  for (const m of minds.values()) {
    const thinking = m.a.busy;
    m.spawnT = Math.min(1, m.spawnT + dt * 0.7);
    const k = 1 - Math.pow(0.02, dt * (m.spawnT < 1 ? 0.6 : 1));
    m.g.position.x += (m.target.x - m.g.position.x) * k; m.g.position.z += (m.target.z - m.g.position.z) * k;
    m.g.position.y = 0.15 + Math.sin(t * 1.6 + m.phase) * 0.08 + (m.spawnT < 1 ? Math.sin(m.spawnT * Math.PI) * 1.2 : 0);
    const sc = m.spawnT < 1 ? 0.05 + 0.95 * (1 - Math.pow(1 - m.spawnT, 3)) : 1; m.g.scale.setScalar(sc);
    // face the gate
    m.g.rotation.y = Math.atan2(GATE.x - m.g.position.x, GATE.z - m.g.position.z) + Math.PI + Math.PI;
    m.halo.rotation.z = t * (thinking ? 4 : 0.8); m.halo.scale.setScalar(1 + (thinking ? Math.sin(t * 8) * 0.12 : 0));
    m.core.rotation.y = t * 2; m.core.scale.setScalar(1 + (thinking ? 0.35 + Math.sin(t * 14 + m.phase) * 0.25 : Math.sin(t * 2 + m.phase) * 0.1));
    m.head.rotation.y = thinking ? Math.sin(t * 3 + m.phase) * 0.25 : 0;
    m.flash = Math.max(0, m.flash - dt * 1.2);
    const base = hueColor(m.a.hue);
    m.glow.color.copy(base).multiplyScalar(1.8).lerp(m.flashCol.clone().multiplyScalar(3.5), Math.min(1, m.flash));
    m.mat.emissive.copy(base).multiplyScalar(0.06 + (thinking ? 0.08 : 0)).lerp(m.flashCol, Math.min(1, m.flash) * 0.6);
    if (m.bubbleUntil && now > m.bubbleUntil) { m.bubble.style.opacity = 0; m.bubbleUntil = 0; }
    if (!thinking && m.bubble.textContent === '◌ thinking…' && m.bubbleUntil) m.bubbleUntil = Math.min(m.bubbleUntil, now + 300);
  }
  for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; b.life -= dt; b.line.material.opacity = Math.max(0, b.life / b.max); if (b.life <= 0) { scene.remove(b.line); b.line.geometry.dispose(); beams.splice(i, 1); } }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.life -= dt; const p = b.pts.geometry.attributes.position;
    for (let j = 0; j < p.count; j++) { b.v[j * 3 + 1] -= 6 * dt; p.array[j * 3] += b.v[j * 3] * dt; p.array[j * 3 + 1] += b.v[j * 3 + 1] * dt; p.array[j * 3 + 2] += b.v[j * 3 + 2] * dt; }
    p.needsUpdate = true; b.pts.material.opacity = Math.max(0, b.life / 1.6);
    if (b.life <= 0) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); }
  }
  if (!dragging) {
    const want = 13 + Math.sqrt(minds.size) * 1.6, off = camera.position.clone().sub(controls.target), d = off.length();
    camera.position.copy(controls.target).add(off.multiplyScalar(1 + (want - d) / d * Math.min(1, dt * 0.6)));
  }
  controls.update();
  composer.render(); labels.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); });
