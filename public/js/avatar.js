// A squadmate as everyone else sees them: full rigged soldier body, rifle in hand, directional
// running/walking/crouching blended from their real velocity, aim pitch on the spine, and the
// downed / reviving / dead / picking-up poses driven by the co-op state.
import * as THREE from 'three';
import { spawnChar, loadClip, bindClip } from '/js/rig.js';

const CL = ['anim_p_run_fwd', 'anim_p_run_back', 'anim_p_run_left', 'anim_p_run_right', 'anim_p_walk', 'anim_p_crouch_walk', 'anim_p_crouch_idle', 'anim_p_fire',
  'anim_p_reload', 'anim_p_jump', 'anim_p_hit', 'anim_p_death', 'anim_p_crawl', 'anim_p_kneel', 'anim_p_pickup', 'anim_p_standup'];
const ONCE = new Set(['anim_p_reload', 'anim_p_jump', 'anim_p_hit', 'anim_p_death', 'anim_p_pickup', 'anim_p_standup']);
const norm = (n) => n.replace(/^.*?mixamorig\d*[:_]?/i, '').replace(/_\d+$/, '').replace(/[^A-Za-z0-9]/g, '');
let clips = null;
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.8, roughness: 0.4 }), woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 });
function rifle() {
  const g = new THREE.Group(); const b = (w, h, d, x, y, z, m = gunMat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); };
  b(0.05, 0.08, 0.42, 0, 0, 0.05); b(0.04, 0.06, 0.25, 0, -0.01, 0.38, woodMat); b(0.022, 0.022, 0.3, 0, 0.015, 0.6); b(0.045, 0.14, 0.06, 0, -0.1, 0.12); b(0.04, 0.11, 0.05, 0, -0.08, -0.1, woodMat); b(0.045, 0.08, 0.26, 0, -0.01, -0.28, woodMat);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.07), gunMat); mag.position.set(0, -0.12, 0.13); mag.rotation.x = 0.35; g.add(mag);
  return g;
}

export class Avatar {
  constructor(scene, info) { this.scene = scene; this.info = info; this.ready = this.build(info.skin); this.pos = new THREE.Vector3(); this.tpos = new THREE.Vector3(); this.yaw = 0; this.tyaw = 0; this.pitch = 0; this.vel = new THREE.Vector3(); this.life = 'alive'; this.state = {}; }
  async build(skin) {
    if (!clips) clips = Object.fromEntries(await Promise.all(CL.map(async (c) => [c, await loadClip(c)])));
    this.root = await spawnChar(skin || 'player_swat', 1.8); const inner = this.root.userData.inner;
    this.mixer = new THREE.AnimationMixer(inner); this.A = {};
    for (const c of CL) { const a = this.mixer.clipAction(bindClip(clips[c], inner, { inPlace: true })); if (ONCE.has(c)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } this.A[c] = a; }
    for (const c of ['anim_p_run_fwd', 'anim_p_run_back', 'anim_p_run_left', 'anim_p_run_right', 'anim_p_walk', 'anim_p_crouch_walk', 'anim_p_crouch_idle', 'anim_p_fire']) { this.A[c].play(); this.A[c].setEffectiveWeight(0); }
    this.bones = {}; inner.traverse((o) => { if (o.isBone) this.bones[norm(o.name)] = o; });
    const hand = this.bones.RightHand; if (hand) { const r = rifle(); const ws = hand.getWorldScale(new THREE.Vector3()).x || 1; r.scale.setScalar(1 / ws); r.rotation.set(0, Math.PI / 2, -Math.PI / 2); r.position.set(0.03 / ws, 0.1 / ws, 0.03 / ws); hand.add(r); }
    // a name tag
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = 'bold 26px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 6, 256, 36); x.fillStyle = '#7dff6a'; x.fillText(this.info.name || 'Survivor', 128, 34);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); this.tag.scale.set(0.9, 0.17, 1); this.tag.position.y = 2.15; this.root.add(this.tag);
    this.scene.add(this.root);
  }
  set(m) { // a state packet from the network
    if (m.p) this.tpos.fromArray(m.p); if (m.y !== undefined) this.tyaw = m.y; if (m.pt !== undefined) this.pitch = m.pt;
    if (m.v) this.vel.fromArray(m.v); this.state = m;
    if (m.fire && this.A) this.fireT = 0.15; if (m.rl && this.A && !this.reloading) { this.reloading = true; this.oneShot('anim_p_reload', 1.3); setTimeout(() => (this.reloading = false), 2200); }
  }
  oneShot(name, speed = 1) { const a = this.A?.[name]; if (!a) return; a.reset(); a.setEffectiveTimeScale(speed); a.setEffectiveWeight(1); a.play(); return a; }
  setLife(life) {
    if (!this.A || life === this.life) { this.life = life; return; }
    const prev = this.life; this.life = life;
    for (const k of ['anim_p_death', 'anim_p_crawl', 'anim_p_kneel', 'anim_p_standup']) this.A[k].stop();
    if (life === 'dead') this.oneShot('anim_p_death');
    if (life === 'downed') { this.A.anim_p_crawl.reset().play(); }
    if (life === 'alive' && prev !== 'alive') this.oneShot('anim_p_standup', 1.4);
    this.root.visible = true;
  }
  update(dt) {
    if (!this.root) return;
    this.pos.lerp(this.tpos, Math.min(1, dt * 12)); let d = this.tyaw - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.yaw += d * Math.min(1, dt * 12);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw + Math.PI; // characters face +Z, our yaw faces -Z
    const A = this.A, s = this.state;
    // locomotion weights from velocity in the body's frame
    const v = this.vel.clone().setY(0), sp = v.length();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const f = v.dot(fwd), r = v.dot(right);
    const busy = this.life !== 'alive' || s.kneel || s.pick;
    const W = { anim_p_run_fwd: 0, anim_p_run_back: 0, anim_p_run_left: 0, anim_p_run_right: 0, anim_p_walk: 0, anim_p_crouch_walk: 0, anim_p_crouch_idle: 0, anim_p_fire: 0 };
    if (!busy) {
      if (s.c) { if (sp > 0.5) W.anim_p_crouch_walk = 1; else W.anim_p_crouch_idle = 1; }
      else if (sp < 0.5) W.anim_p_fire = 1;                     // standing, rifle shouldered
      else if (sp < 5 && f > Math.abs(r)) W.anim_p_walk = 1;
      else { const t = Math.abs(f) + Math.abs(r) + 1e-6; if (f > 0) W.anim_p_run_fwd = f / t; else W.anim_p_run_back = -f / t; if (r > 0) W.anim_p_run_right = r / t; else W.anim_p_run_left = -r / t; }
    }
    for (const k in W) { const a = A[k]; a.setEffectiveWeight(THREE.MathUtils.lerp(a.getEffectiveWeight(), W[k], Math.min(1, dt * 8))); }
    A.anim_p_fire.setEffectiveTimeScale(this.fireT > 0 ? 1 : 0.05); this.fireT = Math.max(0, (this.fireT || 0) - dt);
    for (const k of ['anim_p_run_fwd', 'anim_p_run_back', 'anim_p_run_left', 'anim_p_run_right']) A[k].setEffectiveTimeScale(THREE.MathUtils.clamp(sp / 9, 0.6, 1.3));
    if (this.life === 'alive' && s.kneel && !this.kneeling) { this.kneeling = true; A.anim_p_kneel.reset().play(); } else if ((!s.kneel || this.life !== 'alive') && this.kneeling) { this.kneeling = false; A.anim_p_kneel.fadeOut(0.3); }
    if (s.pick && !this.picking) { this.picking = true; this.oneShot('anim_p_pickup', 1.6); setTimeout(() => (this.picking = false), 1200); }
    this.mixer.update(dt);
    // aim: bend the spine with their camera pitch
    if (this.life === 'alive' && this.bones.Spine1 && !s.kneel) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch * 0.45); this.bones.Spine1.quaternion.multiply(q); this.bones.Spine2?.quaternion.multiply(q); }
    this.tag.visible = this.life !== 'dead';
  }
  dispose() { if (this.root) this.scene.remove(this.root); }
}
