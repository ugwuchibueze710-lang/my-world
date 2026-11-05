// Zombies: real rigged bodies on the shared Mixamo skeleton, per-limb damage, dismemberment (the limb really
// comes off as its own piece of the mesh), crawling when legs are gone, flow-field pathing through the scans.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { spawnChar, loadClip, bindClip, loadCharTemplate } from '/js/rig.js';
import { ZTYPES, BODY_HINT } from '/js/levels.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const norm = (n) => n.replace(/^.*?mixamorig\d*[:_]?/i, '').replace(/_\d+$/, '').replace(/[^A-Za-z0-9]/g, '');
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const CLIPS = ['anim_z_walk', 'anim_z_walk_creep', 'anim_z_run', 'anim_z_crawl', 'anim_z_runcrawl', 'anim_z_attack_swipe', 'anim_z_attack_punch', 'anim_z_attack_overhead',
  'anim_z_scream', 'anim_z_hit_flinch', 'anim_z_hit_stumble', 'anim_z_death_back', 'anim_z_death_forward', 'anim_z_bite_ground', 'anim_z_getup'];
const LOOPS = new Set(['anim_z_walk', 'anim_z_walk_creep', 'anim_z_run', 'anim_z_crawl', 'anim_z_runcrawl', 'anim_z_bite_ground']);
const INPLACE = new Set(['anim_z_walk', 'anim_z_walk_creep', 'anim_z_run', 'anim_z_crawl', 'anim_z_runcrawl', 'anim_z_attack_swipe', 'anim_z_attack_punch', 'anim_z_attack_overhead', 'anim_z_scream', 'anim_z_hit_flinch', 'anim_z_hit_stumble', 'anim_z_bite_ground']);

// hit volumes along the skeleton: [zone, from bone, to bone, radius]
const PARTS = [
  ['head', 'Head', 'HeadTopEnd', 0.12], ['torso', 'Hips', 'Spine2', 0.17], ['torso', 'Spine2', 'Neck', 0.16],
  ['armL', 'LeftArm', 'LeftForeArm', 0.065], ['armL', 'LeftForeArm', 'LeftHand', 0.055], ['armR', 'RightArm', 'RightForeArm', 0.065], ['armR', 'RightForeArm', 'RightHand', 0.055],
  ['legL', 'LeftUpLeg', 'LeftLeg', 0.09], ['legL', 'LeftLeg', 'LeftFoot', 0.07], ['legR', 'RightUpLeg', 'RightLeg', 0.09], ['legR', 'RightLeg', 'RightFoot', 0.07],
];
// what comes off for each zone: upper arm shots take the forearm, thigh shots take the shin (keeps a stump)
const SEVER = { head: 'Head', armL: 'LeftForeArm', armR: 'RightForeArm', legL: 'LeftLeg', legR: 'RightLeg' };
const ZONE_HP = { head: 55, armL: 45, armR: 45, legL: 70, legR: 70 };

export class Horde {
  constructor(ctx) { this.ctx = ctx; this.list = []; this.seq = 1; this.clips = {}; this.gibs = []; this.ready = this.preload(); }
  async preload() { await Promise.all(CLIPS.map(async (c) => { this.clips[c] = await loadClip(c); })); }
  async prewarm(bodies) { await Promise.all(bodies.map((b) => loadCharTemplate(b))); }

  async spawn(body, type, pos, id) {
    await this.ready;
    const T = ZTYPES[type], root = await spawnChar(body, 1.78 * (T.scale || 1) * rand(0.94, 1.04));
    const inner = root.userData.inner; root.position.copy(pos);
    const bones = {}; inner.traverse((o) => { if (o.isBone) bones[norm(o.name)] = o; });
    const mixer = new THREE.AnimationMixer(inner), A = {};
    for (const c of CLIPS) { const a = mixer.clipAction(bindClip(this.clips[c], inner, { inPlace: INPLACE.has(c) })); if (!LOOPS.has(c)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } A[c] = a; }
    const z = { id: id ?? this.seq++, body, type, T, root, inner, bones, mixer, A, hp: T.hp * this.ctx.hpScale(), zone: { ...ZONE_HP }, severed: {}, alive: true,
      speed: rand(...T.speed), state: 'idle', cur: null, attackCd: rand(0.5, 1.5), screamed: false, flinch: 0, vel: new THREE.Vector3(), yaw: Math.random() * 6, stuck: 0, lastPos: pos.clone(),
      mats: [], deadT: 0, target: null, phase: Math.random() * 10, bleed: [] };
    inner.traverse((o) => { if (o.isMesh) z.mats.push(o.material); });
    inner.updateMatrixWorld(true); const hipH = bones.Hips ? Math.max(0.5, bones.Hips.getWorldPosition(new THREE.Vector3()).y - pos.y) : 0.95;
    z.natural = {}; for (const c of ['anim_z_walk', 'anim_z_walk_creep', 'anim_z_run', 'anim_z_crawl', 'anim_z_runcrawl']) { const sp = this.clips[c].userData?.speedPerHip; z.natural[c] = sp && sp > 0.05 ? sp * hipH : { anim_z_walk: 1.2, anim_z_walk_creep: 0.7, anim_z_run: 3.6, anim_z_crawl: 0.5, anim_z_runcrawl: 1.4 }[c]; }
    z.baseY = inner.position.y; z.visY = pos.y; z.dir = new THREE.Vector3(); z.flinchCd = 0; z.side = 0;
    this.ctx.scene.add(root); this.list.push(z);
    this.play(z, T.anim, 0); z.A[T.anim].time = Math.random() * 2;
    return z;
  }
  get(id) { return this.list.find((z) => z.id === id); }

  play(z, name, fade = 0.25, scale = 1) {
    if (z.cur === name && LOOPS.has(name)) return z.A[name];
    const next = z.A[name]; if (!next) return null;
    next.reset(); next.setEffectiveTimeScale(scale); next.setEffectiveWeight(1); next.play();
    if (z.cur && z.A[z.cur] && z.cur !== name) z.A[z.cur].crossFadeTo(next, fade, false);
    z.cur = name; return next;
  }
  locomotion(z) { return z.crawling ? (z.T.run ? 'anim_z_runcrawl' : 'anim_z_crawl') : z.T.anim; }

  // ----------------------------------------------------------------- AI (host only)
  think(dt, players) {
    const W = this.ctx.world;
    for (const z of this.list) {
      if (!z.alive) continue;
      z.phase += dt; z.attackCd -= dt; z.flinch = Math.max(0, z.flinch - dt); z.flinchCd -= dt;
      const R = z.root.position;
      // nearest living, visible-ish survivor
      let best = null, bd = 1e9; for (const p of players) { if (!p.alive) continue; const d = p.pos.distanceTo(R); if (d < bd) { bd = d; best = p; } }
      z.target = best;
      if (!best) { if (z.state !== 'feed') { z.state = 'wander'; } continue; }
      const toP = new THREE.Vector3(best.pos.x - R.x, 0, best.pos.z - R.z), dist = toP.length(); toP.normalize();
      // first sight: a scream that tells everyone they're coming
      if (!z.screamed && dist < 22 && W.visible(R.clone().setY(R.y + 1.6), best.pos.clone().setY(best.pos.y + 1.5))) {
        z.screamed = true; if (!z.crawling && Math.random() < 0.55) { z.state = 'scream'; z.busy = this.play(z, 'anim_z_scream', 0.2).getClip().duration * 0.9; this.ctx.sfx.groan(R, z, true); this.ctx.net?.zfx({ id: z.id, fx: 'scream' }); }
      }
      if (z.busy > 0) { z.busy -= dt; if (z.state === 'attack' && !z.hitDone && z.busy < z.hitAt) { z.hitDone = true; if (dist < z.T.reach + 0.35 && Math.abs(best.pos.y - R.y) < 1.3) this.ctx.hurtPlayer(best, z.T.dmg * (z.severed.armL && z.severed.armR ? 0.5 : z.severed.armL || z.severed.armR ? 0.75 : 1) * this.ctx.dmgScale(), R); }
        if (z.busy <= 0) { z.state = 'chase'; this.play(z, this.locomotion(z), 0.3); } else { this.face(z, toP, dt * 3); continue; } }
      // attack
      if (dist < z.T.reach && z.attackCd <= 0 && Math.abs(best.pos.y - R.y) < 1.3) {
        const name = z.crawling ? 'anim_z_bite_ground' : z.severed.armL && z.severed.armR ? 'anim_z_attack_punch' : pick(['anim_z_attack_swipe', 'anim_z_attack_punch', 'anim_z_attack_overhead']);
        const a = this.play(z, name, 0.15, z.crawling ? 1.6 : 1.15); const dur = z.crawling ? 0.9 : a.getClip().duration / 1.15;
        z.state = 'attack'; z.busy = dur; z.hitAt = dur * 0.55; z.hitDone = false; z.attackCd = dur + rand(0.6, 1.4);
        this.ctx.sfx.groan(R, z, false); this.ctx.net?.zfx({ id: z.id, fx: 'attack', anim: name });
        continue;
      }
      // move along the flow field (or straight at them when in the open)
      let goal = null;
      if (dist < 6 && W.visible(R.clone().setY(R.y + 1.2), best.pos.clone().setY(best.pos.y + 1.2))) goal = best.pos;
      else goal = W.steer(R, new THREE.Vector3());
      const want = goal ? new THREE.Vector3(goal.x - R.x, 0, goal.z - R.z).normalize() : toP.clone();
      // shove apart from the pack
      for (const o of this.list) { if (o === z || !o.alive) continue; const dx = R.x - o.root.position.x, dz = R.z - o.root.position.z, d = Math.hypot(dx, dz); if (d < 0.7 && d > 1e-3) { want.x += (dx / d) * (0.7 - d) * 3; want.z += (dz / d) * (0.7 - d) * 3; } }
      // stuck on scan geometry: side-step
      if (z.stuck > 0.8 && !z.side) z.side = (Math.random() < 0.5 ? -1 : 1) * 1.2;
      if (z.side) { want.applyAxisAngle(new THREE.Vector3(0, 1, 0), z.side); z.sideT = (z.sideT || 0) + dt; if (z.sideT > 1.1) { z.side = 0; z.sideT = 0; z.stuck = 0; } }
      want.y = 0; if (want.lengthSq() > 1e-6) want.normalize();
      // heading turns smoothly (no snapping between grid cells); body walks where it faces, like a real walker
      z.dir.lerp(want, Math.min(1, dt * 2.5)); if (z.dir.lengthSq() < 1e-4) z.dir.copy(want); z.dir.normalize();
      this.face(z, dist < 2.5 ? toP : z.dir, dt * 2.6);
      const fwd = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
      const name = this.locomotion(z), nat = z.natural[name] || 1;
      // play the cycle at a rate that matches the speed we want, then move exactly as fast as the feet say
      const desired = (z.crawling ? nat : z.speed) * (dist < z.T.reach ? 0 : 1);
      const rate = THREE.MathUtils.clamp(desired / nat, 0.6, 1.5);
      const align = Math.max(0, fwd.dot(z.dir)); // slow down while turning
      const sp = desired > 0 ? nat * rate * (0.35 + 0.65 * align) * (z.flinch > 0 ? 0.3 : 1) : 0;
      z.vel.x += (fwd.x * sp - z.vel.x) * Math.min(1, dt * 6); z.vel.z += (fwd.z * sp - z.vel.z) * Math.min(1, dt * 6);
      z.state = 'chase'; if (z.cur !== name && !(z.busy > 0)) this.play(z, name, 0.4);
      z.A[name].setEffectiveTimeScale(desired > 0 ? rate * (0.5 + 0.5 * align) : 0.3);
    }
  }
  face(z, dir, k) { const want = Math.atan2(dir.x, dir.z); z.yaw += angDiff(want, z.yaw) * Math.min(1, k); }

  // physics + animation for everyone (host and clients)
  update(dt, puppet) {
    const W = this.ctx.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i], R = z.root.position;
      if (puppet && z.net) { // smooth toward the host's snapshot
        R.lerp(z.net.p, Math.min(1, dt * 10)); z.yaw += angDiff(z.net.y, z.yaw) * Math.min(1, dt * 10);
        if (z.alive && z.net.anim && z.cur !== z.net.anim && !(z.busy > 0)) this.play(z, z.net.anim, 0.25);
        z.busy = Math.max(0, (z.busy || 0) - dt);
      } else if (z.alive) {
        z.vel.y -= 18 * dt;
        R.addScaledVector(z.vel, dt);
        const v = z.vel; let g = W.collideCapsule(R, 0.28, z.crawling ? 0.7 : 1.7, v);
        if (!g) { const nf = W.navFloor(R); if (isFinite(nf) && R.y < nf + 0.02 && R.y > nf - 1.5) { R.y = nf; g = true; } }
        if (!g && W.clampToNav(R, v)) g = true;
        if (g) { v.y = Math.max(0, v.y); z.safe = (z.safe || new THREE.Vector3()).copy(R); }
        // fell through anyway: back to where it last stood, not a random teleport
        if (z.safe && R.y < z.safe.y - 3) { R.copy(z.safe); v.set(0, 0, 0); }
        const moved = R.distanceTo(z.lastPos); z.stuck = moved < dt * 0.25 && z.state === 'chase' ? z.stuck + dt : Math.max(0, z.stuck - dt); z.lastPos.copy(R);
      }
      if (!z.alive) {
        z.deadT += dt;
        if (!puppet) { z.vel.x *= 0.9; z.vel.z *= 0.9; z.vel.y -= 18 * dt; R.addScaledVector(z.vel, dt); W.collideCapsule(R, 0.25, 0.5, z.vel); }
        if (z.deadT > 25) for (const m of z.mats) { m.transparent = true; m.opacity = Math.max(0, 1 - (z.deadT - 25) / 3); }
        if (z.deadT > 28) { this.ctx.scene.remove(z.root); this.list.splice(i, 1); continue; }
      }
      z.root.rotation.y = z.yaw;
      if (z.baseY !== undefined) { z.visY += (R.y - z.visY) * Math.min(1, dt * 9); if (Math.abs(R.y - z.visY) > 0.6) z.visY = R.y; z.inner.position.y = z.baseY + (z.visY - R.y); }
      // bleeding stumps
      for (const b of z.bleed) { b.t -= dt; if (b.t > 0 && Math.random() < dt * 30) { const p = b.bone.getWorldPosition(new THREE.Vector3()); this.ctx.fx.blood(p, new THREE.Vector3(rand(-0.3, 0.3), -0.2, rand(-0.3, 0.3)), 2, 1.5); } }
      z.mixer.update(dt);
    }
    // severed limbs tumbling
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i]; g.t += dt;
      if (!g.rest) {
        g.v.y -= 18 * dt; g.o.position.addScaledVector(g.v, dt);
        g.o.rotateOnWorldAxis(g.axis, g.spin * dt);
        const fy = W.floorAt(g.o.position.x, g.o.position.z, g.o.position.y + 0.6, 2);
        if (g.o.position.y < fy + 0.05) { g.o.position.y = fy + 0.05; if (Math.abs(g.v.y) > 1.5) { g.v.y *= -0.3; g.v.x *= 0.5; g.v.z *= 0.5; g.spin *= 0.5; this.ctx.fx.splat(g.o.position, 0.18); this.ctx.sfx.thud(g.o.position); } else { g.rest = true; } }
        if (g.t < 0.6 && Math.random() < 0.5) this.ctx.fx.blood(g.o.position, new THREE.Vector3(0, 0, 0), 1, 0.5);
      }
      if (g.t > 30) { this.ctx.scene.remove(g.o); this.gibs.splice(i, 1); }
    }
  }

  // ----------------------------------------------------------------- shooting
  // ray against every zombie's bone capsules; returns nearest {z, zone, point, dist}
  raycast(origin, dir, maxDist) {
    let best = null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
    const seg = new THREE.Ray(origin, dir);
    for (const z of this.list) {
      if (z.root.position.distanceTo(origin) > maxDist + 3) continue;
      // quick reject: bounding sphere around the body
      const c = z.root.position.clone(); c.y += 0.9; if (seg.distanceSqToPoint(c) > 1.6) continue;
      z.inner.updateMatrixWorld(true);
      for (const [zone, f, t, r0] of PARTS) {
        if (z.severed[zone] && zone !== 'torso') continue;
        const B1 = z.bones[f], B2 = z.bones[t] || z.bones[f]?.children[0]; if (!B1 || !B2) continue;
        B1.getWorldPosition(a); B2.getWorldPosition(b); if (zone === 'head' && !z.bones[t]) b.y += 0.2;
        const r = r0 * (z.T.scale || 1) * 1.15;
        const d2 = seg.distanceSqToSegment(a, b, pa, pb);
        if (d2 < r * r) { const dist = pa.distanceTo(origin) - Math.sqrt(Math.max(0, r * r - d2)); if (dist > 0 && dist < maxDist && (!best || dist < best.dist)) best = { z, zone, point: origin.clone().addScaledVector(dir, dist), dist }; }
      }
    }
    return best;
  }

  // damage from a bullet / melee. Returns 'kill' | 'sever' | 'hit'
  damage(z, zone, dmg, point, dir, opts = {}) {
    if (!z.alive) { if (zone !== 'torso' && !z.severed[zone] && Math.random() < 0.5) this.sever(z, zone, dir); this.ctx.fx.blood(point, dir, 10, 3); return 'hit'; }
    const mult = zone === 'head' ? 3 : zone === 'torso' ? 1 : 0.7;
    z.hp -= dmg * mult; z.flinch = 0.35;
    this.ctx.fx.blood(point, dir.clone().multiplyScalar(0.8), zone === 'head' ? 26 : 14, zone === 'head' ? 4 : 3);
    this.ctx.fx.wallSpray?.(point, dir);
    let res = 'hit';
    if (zone !== 'torso') {
      z.zone[zone] -= dmg * (opts.melee ? 0.5 : 1);
      if (z.zone[zone] <= 0 && !z.severed[zone]) { this.sever(z, zone, dir); res = 'sever'; this.ctx.net?.zfx({ id: z.id, fx: 'sever', zone, dir: dir.toArray() }); }
    }
    if (zone === 'head' && z.severed.head) z.hp = 0;
    // a stagger on heavy hits
    if (z.alive && z.hp > 0 && !(z.busy > 0) && (opts.melee || (z.flinchCd <= 0 && (zone === 'head' || dmg * mult > 40 || Math.random() < 0.3)))) { z.flinchCd = rand(1.6, 2.6); const n = opts.melee || Math.random() < 0.4 ? 'anim_z_hit_stumble' : 'anim_z_hit_flinch'; z.busy = this.play(z, n, 0.08, 1.3).getClip().duration / 1.3 * 0.75; z.state = 'hit'; this.ctx.net?.zfx({ id: z.id, fx: 'anim', anim: n }); }
    z.vel.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), opts.push ?? 0.8);
    if (z.hp <= 0) { this.kill(z, dir, zone); return 'kill'; }
    return res;
  }

  sever(z, zone, dir) {
    if (z.severed[zone]) return; z.severed[zone] = true;
    const boneName = SEVER[zone], bone = z.bones[boneName]; if (!bone) return;
    z.inner.updateMatrixWorld(true);
    this.makeGib(z, bone, dir);
    bone.scale.setScalar(0.0001);                  // the limb collapses into the joint — it is gone from the body
    const stump = bone.parent; z.bleed.push({ bone: stump, t: 6 });
    // a dark wet cap on the stump
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.35, metalness: 0.1 }));
    const ws = stump.getWorldScale(new THREE.Vector3()).x || 1; cap.scale.setScalar(1 / ws); bone.parent.add(cap); cap.position.copy(bone.position).multiplyScalar(0.92);
    this.ctx.fx.blood(bone.getWorldPosition(new THREE.Vector3()), dir, 40, 4);
    this.ctx.sfx.sever(z.root.position);
    if (zone === 'legL' || zone === 'legR') { z.crawling = true; if (z.alive) { z.busy = 0.9; this.play(z, z.T.run ? 'anim_z_runcrawl' : 'anim_z_crawl', 0.2); } }
    if (zone === 'head' && z.alive) this.kill(z, dir, 'head');
  }

  // clone the body, keep only the severed bone chain visible, freeze the pose and let it fly
  makeGib(z, bone, dir) {
    const clone = SkeletonUtils.clone(z.inner);
    clone.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.frustumCulled = false; } });
    // match the live pose bone-by-bone
    const live = {}; z.inner.traverse((o) => { if (o.isBone) live[o.name] = o; });
    clone.traverse((o) => { if (o.isBone && live[o.name]) { o.position.copy(live[o.name].position); o.quaternion.copy(live[o.name].quaternion); o.scale.copy(live[o.name].scale); } });
    const holder = new THREE.Group(); this.ctx.scene.add(holder);
    z.inner.updateMatrixWorld(true); holder.position.copy(z.root.position); holder.quaternion.copy(z.root.quaternion);
    holder.add(clone); clone.position.copy(z.inner.position); clone.scale.copy(z.inner.scale); clone.updateMatrixWorld(true);
    const cb = clone.getObjectByName(bone.name); const keep = new Set(); cb.traverse((o) => keep.add(o));
    // lift the severed chain out of its parents so hiding the rest doesn't hide it
    const armature = clone.children.find((c) => !c.isMesh) || clone;
    armature.attach(cb);
    clone.traverse((o) => { if (o.isBone && !keep.has(o) && o !== cb) o.scale.setScalar(0.0001); });
    clone.updateMatrixWorld(true);
    const p0 = cb.getWorldPosition(new THREE.Vector3());
    // pivot the whole gib around the limb's own centre so it tumbles naturally
    holder.updateMatrixWorld(true);
    const pivot = new THREE.Group(); this.ctx.scene.add(pivot); pivot.position.copy(p0); pivot.attach(holder);
    this.gibs.push({ o: pivot, v: new THREE.Vector3(dir.x * rand(2, 4), rand(2, 3.5), dir.z * rand(2, 4)), axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), spin: rand(5, 11), t: 0 });
    if (this.gibs.length > 40) { const g = this.gibs.shift(); this.ctx.scene.remove(g.o); }
  }

  kill(z, dir, zone) {
    if (!z.alive) return; z.alive = false; z.deadT = 0; z.busy = 0;
    const local = new THREE.Vector3(dir.x, 0, dir.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -z.yaw);
    const name = z.crawling ? 'anim_z_death_forward' : local.z > 0 ? 'anim_z_death_forward' : 'anim_z_death_back';
    this.play(z, name, 0.12, rand(0.95, 1.15));
    z.vel.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 1.2);
    this.ctx.onKill?.(z, zone);
    this.ctx.net?.zfx({ id: z.id, fx: 'kill', zone, dir: dir.toArray(), anim: name });
    setTimeout(() => { if (z.root.parent) this.ctx.fx.pool(z.root.position, rand(0.7, 1.2)); }, 900);
  }

  // ----------------------------------------------------------------- network
  snapshot() { return this.list.map((z) => [z.id, z.body, z.type, +z.root.position.x.toFixed(2), +z.root.position.y.toFixed(2), +z.root.position.z.toFixed(2), +z.yaw.toFixed(2), z.alive ? 1 : 0, z.cur, (z.crawling ? 1 : 0)]); }
  async applySnapshot(arr) {
    const seen = new Set();
    for (const [id, body, type, x, y, zz, yaw, alive, anim, crawl] of arr) {
      seen.add(id); let z = this.get(id);
      if (!z) { if (!alive) continue; z = await this.spawn(body, type, new THREE.Vector3(x, y, zz), id); }
      z.net = { p: new THREE.Vector3(x, y, zz), y: yaw, anim }; z.crawling = !!crawl;
      if (!alive && z.alive) { z.alive = false; z.deadT = 0; if (anim) this.play(z, anim, 0.12); }
    }
    for (const z of this.list) if (z.alive && !seen.has(z.id)) { this.ctx.scene.remove(z.root); this.list.splice(this.list.indexOf(z), 1); }
  }
  applyFx(m) {
    const z = this.get(m.id); if (!z) return; const dir = m.dir ? new THREE.Vector3().fromArray(m.dir) : new THREE.Vector3(0, 0, 1);
    if (m.fx === 'sever') this.sever(z, m.zone, dir);
    if (m.fx === 'kill') { z.alive = false; z.deadT = 0; this.play(z, m.anim, 0.12); setTimeout(() => this.ctx.fx.pool(z.root.position, 1), 900); }
    if (m.fx === 'attack' || m.fx === 'anim') { const a = this.play(z, m.anim, 0.15); z.busy = a ? a.getClip().duration * 0.9 : 0.8; if (m.fx === 'attack') this.ctx.sfx.groan(z.root.position, z, false); }
    if (m.fx === 'scream') { const a = this.play(z, 'anim_z_scream', 0.2); z.busy = a.getClip().duration * 0.9; this.ctx.sfx.groan(z.root.position, z, true); }
  }
  clear() { for (const z of this.list) this.ctx.scene.remove(z.root); this.list.length = 0; for (const g of this.gibs) this.ctx.scene.remove(g.o); this.gibs.length = 0; }
  alive() { return this.list.filter((z) => z.alive).length; }
}

export function pickZombie(level) {
  const body = pick(level.zombies.types);
  const hint = BODY_HINT[body];
  const r = Math.random();
  const type = hint === 'brute' ? (r < 0.7 ? 'brute' : 'walker') : r < 0.18 + level.idx * 0.05 ? 'runner' : r < 0.45 ? 'shambler' : hint && r < 0.6 ? hint : 'walker';
  return { body, type };
}
