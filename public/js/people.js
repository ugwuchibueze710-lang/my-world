// Thousands of animated people: instanced bodies with shader-driven walking, working, fighting,
// plus crowns, spears, shields and sacks. Far away they become coloured dots so armies stay visible.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STATE } from '/shared/constants.js';
import { WORLD_SIZE, HALF } from '/shared/world.js';

const MAX_NEAR = 7000, MAX_ALL = 16000, NEAR_R = 650;

function part(g, partId, limb) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(partId), 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  g.deleteAttribute('uv');
  return g;
}
function humanGeometry(female) {
  const P = [];
  // legs (pivot at hip, y=0.88)
  P.push(part(new THREE.CylinderGeometry(0.075, 0.06, 0.84, 6).translate(-0.1, 0.46, 0), 2, 1));
  P.push(part(new THREE.CylinderGeometry(0.075, 0.06, 0.84, 6).translate(0.1, 0.46, 0), 2, 2));
  P.push(part(new THREE.BoxGeometry(0.11, 0.07, 0.22).translate(-0.1, 0.035, 0.04), 3, 1));
  P.push(part(new THREE.BoxGeometry(0.11, 0.07, 0.22).translate(0.1, 0.035, 0.04), 3, 2));
  // torso
  P.push(part(new THREE.CylinderGeometry(female ? 0.16 : 0.2, female ? 0.15 : 0.16, 0.6, 8).translate(0, 1.17, 0), 0, 0));
  P.push(part(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 8).translate(0, 0.86, 0), 2, 0)); // belt
  if (female) P.push(part(new THREE.CylinderGeometry(0.17, 0.33, 0.72, 10).translate(0, 0.62, 0), 0, 0)); // skirt
  // arms (pivot at shoulder, y=1.42)
  const ax = female ? 0.21 : 0.25;
  P.push(part(new THREE.CylinderGeometry(0.055, 0.048, 0.58, 6).translate(-ax, 1.13, 0), 0, 3));
  P.push(part(new THREE.CylinderGeometry(0.055, 0.048, 0.58, 6).translate(ax, 1.13, 0), 0, 4));
  P.push(part(new THREE.SphereGeometry(0.055, 6, 4).translate(-ax, 0.82, 0), 1, 3));
  P.push(part(new THREE.SphereGeometry(0.055, 6, 4).translate(ax, 0.82, 0), 1, 4));
  // neck + big cartoon head (face is painted in the shader) + hair
  P.push(part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6).translate(0, 1.5, 0), 1, 0));
  P.push(part(new THREE.SphereGeometry(0.155, 20, 16).scale(0.96, 1.04, 0.94).translate(0, 1.69, 0), 1, 0));
  P.push(part(new THREE.SphereGeometry(0.165, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4).rotateX(-0.42).translate(0, 1.705, -0.012), 4, 0));
  P.push(part(new THREE.SphereGeometry(0.03, 6, 4).translate(-0.152, 1.68, 0), 1, 0)); // ears
  P.push(part(new THREE.SphereGeometry(0.03, 6, 4).translate(0.152, 1.68, 0), 1, 0));
  if (female) P.push(part(new THREE.BoxGeometry(0.29, 0.36, 0.1).translate(0, 1.6, -0.12), 4, 0));
  return mergeGeometries(P);
}

export class People {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.agents = new Map();
    this.list = [];
    this.kColors = new Map();
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; attribute float aPart; attribute float aLimb; attribute vec4 aAnim; attribute vec3 aHair; attribute vec2 aFace;
          varying float vPart; varying vec3 vSkin; varying vec3 vHair; varying vec3 vLoc; varying vec2 vFace; varying float vBlink;
          mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float gait = aAnim.y, act = aAnim.z, ph = aAnim.x;
          float f = gait > 1.5 ? 13.0 : 8.0;
          float sw = sin(uTime * f + ph);
          float a = 0.0;
          vec3 pivot = vec3(0.0, 0.88, 0.0);
          if (aLimb > 0.5 && aLimb < 2.5) { a = (aLimb < 1.5 ? 1.0 : -1.0) * sw * (gait > 1.5 ? 0.75 : gait > 0.5 ? 0.45 : 0.0); }
          else if (aLimb > 2.5) {
            pivot = vec3(0.0, 1.42, 0.0);
            float side = aLimb < 3.5 ? -1.0 : 1.0;
            a = side * sw * (gait > 1.5 ? 0.7 : gait > 0.5 ? 0.38 : 0.0);
            if (act > 0.5 && act < 1.5) { a = aLimb > 3.5 ? -1.9 + sin(uTime * 9.0 + ph) * 1.25 : -0.7; }               // fighting
            else if (act > 1.5 && act < 2.5) { a = -0.9 + sin(uTime * 4.5 + ph + side) * 0.75; }                        // working
            else if (act > 2.5 && act < 3.5) { a = aLimb > 3.5 ? -1.5 + sin(uTime * 2.0 + ph) * 0.3 : 0.0; }            // eating/drinking
            else if (act > 3.5 && act < 4.5) { a = -2.6 + sin(uTime * 6.0 + ph + side) * 0.3; }                         // fleeing, arms up
          }
          mat3 R = rotX(a);
          objectNormal = R * objectNormal;
        `)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed = R * (transformed - pivot) + pivot;
          if (act > 1.5 && act < 2.5) { float b = 0.35 + 0.15 * sin(uTime * 4.5 + ph); if (transformed.y > 0.9) { transformed = rotX(b) * (transformed - vec3(0.0,0.9,0.0)) + vec3(0.0,0.9,0.0); } }
          transformed.y += gait > 0.5 ? abs(sw) * (gait > 1.5 ? 0.06 : 0.03) : 0.0;
          vPart = aPart; vHair = aHair; vLoc = position; vFace = aFace;
          vBlink = step(0.965, fract(uTime * 0.27 + aAnim.x * 0.37));
          float tone = aAnim.w;
          vSkin = mix(vec3(0.95, 0.76, 0.62), vec3(0.32, 0.2, 0.13), tone);
        `);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vPart; varying vec3 vSkin; varying vec3 vHair; varying vec3 vLoc; varying vec2 vFace; varying float vBlink;
          float ell(vec2 p, vec2 c, vec2 r){ vec2 d = (p - c) / r; return dot(d, d); }
          // South Park-style face painted on the head sphere: big eyes, pupils, brows, expressive mouth
          vec3 face(vec3 col){
            vec3 d = vLoc - vec3(0.0, 1.69, 0.0);
            if (d.z < 0.02 || length(d) > 0.175) return col;
            vec2 f = d.xy / 0.15;
            float mood = vFace.x, mouthOpen = vFace.y;
            float happy = step(0.5, mood) * step(mood, 1.5), sad = step(1.5, mood) * step(mood, 2.5);
            float angry = step(2.5, mood) * step(mood, 3.5), scared = step(3.5, mood);
            // eyes
            for (int i = 0; i < 2; i++) {
              float sx = i == 0 ? -1.0 : 1.0;
              vec2 ec = vec2(0.34 * sx, 0.14);
              vec2 er = vec2(0.25, 0.3 * (1.0 - vBlink * 0.92)) * (1.0 + scared * 0.15);
              float e = ell(f, ec, er);
              if (e < 1.0) {
                col = vec3(0.97);
                vec2 pc = ec + vec2(-0.05 * sx, -0.02 + scared * 0.04);
                float pr = scared > 0.5 ? 0.07 : 0.1;
                if (vBlink < 0.5 && length(f - pc) < pr) col = vec3(0.04);
                if (vBlink < 0.5 && length(f - pc - vec2(0.03, 0.03)) < 0.025) col = vec3(1.0);
                // sad: droopy lids, angry: lids cut diagonally
                float lid = sad * (f.y - (ec.y + 0.12 - 0.12 * sx * (f.x - ec.x) * 2.0)) + angry * (f.y - (ec.y + 0.1 + 0.6 * sx * (f.x - ec.x)));
                if (lid > 0.0) col = vSkin * 0.85;
              }
              if (e > 1.0 && e < 1.3) col = mix(col, vec3(0.1), 0.6);
              // brows
              float tilt = angry * -0.55 + sad * 0.45 + scared * 0.2;
              float by = ec.y + 0.36 + scared * 0.1 + tilt * sx * (f.x - ec.x) * -1.0;
              if (abs(f.x - ec.x) < 0.2 && abs(f.y - by) < 0.035) col = vHair * 0.6;
            }
            // mouth
            vec2 m = f - vec2(0.0, -0.42);
            float curve = (happy * 0.9 - sad * 0.7 - angry * 0.4) * m.x * m.x;
            if (mouthOpen > 0.05 || scared > 0.5) {
              float h = max(mouthOpen * 0.17, scared * 0.09) + 0.02;
              if (ell(m, vec2(0.0, curve * 0.5 - h * 0.3), vec2(0.17 + happy * 0.05, h)) < 1.0) col = vec3(0.25, 0.02, 0.03);
              if (ell(m, vec2(0.0, curve * 0.5 - h * 0.85), vec2(0.09, h * 0.35)) < 1.0 && mouthOpen > 0.3) col = vec3(0.75, 0.25, 0.28);
            } else if (abs(m.y - curve) < 0.028 && abs(m.x) < 0.2 + happy * 0.05) col = vec3(0.18, 0.05, 0.04);
            // cheeks blush when happy
            if (happy > 0.5 && (ell(f, vec2(0.45, -0.18), vec2(0.12, 0.08)) < 1.0 || ell(f, vec2(-0.45, -0.18), vec2(0.12, 0.08)) < 1.0)) col = mix(col, vec3(0.95, 0.5, 0.5), 0.35);
            return col;
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = face(vSkin);
          else if (vPart > 1.5 && vPart < 2.5) diffuseColor.rgb = diffuseColor.rgb * 0.35 + vec3(0.07, 0.06, 0.05);
          else if (vPart > 2.5 && vPart < 3.5) diffuseColor.rgb = vec3(0.12, 0.08, 0.05);
          else if (vPart > 3.5) diffuseColor.rgb = vHair;`);
    };
    this.mat = mat;
    const mk = (geo) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_NEAR);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      const hair = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 3), 3); hair.setUsage(THREE.DynamicDrawUsage);
      const faceA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 2), 2); faceA.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim); geo.setAttribute('aHair', hair); geo.setAttribute('aFace', faceA);
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.male = mk(humanGeometry(false));
    this.female = mk(humanGeometry(true));

    const gold = new THREE.MeshStandardMaterial({ color: 0xffcf4d, metalness: 0.95, roughness: 0.25, emissive: 0x3a2500 });
    const crownG = mergeGeometries([new THREE.CylinderGeometry(0.13, 0.12, 0.08, 10, 1, true).toNonIndexed(),
      ...[0, 1, 2, 3, 4].map((i) => new THREE.ConeGeometry(0.025, 0.08, 4).translate(Math.cos(i * 1.2566) * 0.125, 0.07, Math.sin(i * 1.2566) * 0.125).toNonIndexed())]);
    this.crowns = new THREE.InstancedMesh(crownG, gold, 600);
    const spear = mergeGeometries([new THREE.CylinderGeometry(0.02, 0.02, 2.3, 5).translate(0, 1.15, 0).toNonIndexed(), new THREE.ConeGeometry(0.045, 0.22, 5).translate(0, 2.4, 0).toNonIndexed()]);
    this.spears = new THREE.InstancedMesh(spear, new THREE.MeshStandardMaterial({ color: 0x8a7a66, metalness: 0.5, roughness: 0.5 }), 4000);
    this.shields = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), 4000);
    this.helmets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 }), 4000);
    this.sacks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x8b6b43, roughness: 1 }), 4000);
    for (const m of [this.crowns, this.spears, this.shields, this.helmets, this.sacks]) {
      m.count = 0; m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
    }
    this.shields.setColorAt(0, new THREE.Color());

    // far view: dots
    const pg = new THREE.BufferGeometry();
    this.ptPos = new Float32Array(MAX_ALL * 3); this.ptCol = new Float32Array(MAX_ALL * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.ptCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);

    // selection marker
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false; this.ring.renderOrder = 6;
    scene.add(this.ring);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 60, 8, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.visible = false; scene.add(this.beam);
    this.selected = 0;
    this.frameT = 0;
    this._M = new THREE.Matrix4(); this._Q = new THREE.Quaternion(); this._P = new THREE.Vector3(); this._S = new THREE.Vector3(); this._E = new THREE.Euler();
    this._C = new THREE.Color();
  }

  setKingdomColors(kingdoms) { for (const k of kingdoms) this.kColors.set(k.id, new THREE.Color(k.color)); }

  ingest(view, now) {
    const n = view.getUint32(4, true);
    const seen = ++this.frameT;
    const q = (v) => (v / 65535) * WORLD_SIZE - HALF;
    for (let i = 0, o = 16; i < n; i++, o += 16) {
      const id = view.getUint32(o, true);
      const x = q(view.getUint16(o + 4, true)), z = q(view.getUint16(o + 6, true));
      let a = this.agents.get(id);
      if (!a) {
        a = { id, x, z, ax: x, az: z, bx: x, bz: z, t0: now, y: this.world.gridHeight(x, z), yx: 1e9, yz: 0, hd: 0, ph: (id * 2.399) % 6.28 };
        this.agents.set(id, a);
      } else {
        a.ax = a.x; a.az = a.z; a.bx = x; a.bz = z; a.t0 = now;
        if (Math.abs(x - a.ax) > 40 || Math.abs(z - a.az) > 40) { a.ax = x; a.az = z; } // teleport (storm toss)
      }
      a.k = view.getUint16(o + 8, true); a.st = view.getUint8(o + 10); a.fl = view.getUint8(o + 11);
      a.hp = view.getUint8(o + 12) / 255; a.sh = (view.getUint8(o + 13) / 255) * Math.PI * 2;
      a.ex = view.getUint8(o + 14); a.age = view.getUint8(o + 15) / 2; a.seen = seen;
    }
    for (const [id, a] of this.agents) if (a.seen !== seen) this.agents.delete(id);
    this.list = [...this.agents.values()];
  }

  update(now, time, camera, focus, hidden) {
    this.uniforms.uTime.value = time;
    const cp = camera.position;
    const camH = cp.y - focus.y;
    const showNear = camH < 1600;
    const w = this.world;
    const M = this._M, Q = this._Q, P = this._P, S = this._S, E = this._E, C = this._C;
    let nm = 0, nf = 0, nc = 0, ns = 0, nsk = 0, np = 0;
    const male = this.male, female = this.female;
    const mAnim = male.geometry.attributes.aAnim.array, fAnim = female.geometry.attributes.aAnim.array;
    const mHair = male.geometry.attributes.aHair.array, fHair = female.geometry.attributes.aHair.array;
    const mFace = male.geometry.attributes.aFace.array, fFace = female.geometry.attributes.aFace.array;
    for (const a of this.list) {
      const t = Math.min(1, (now - a.t0) / 260);
      const nx = a.ax + (a.bx - a.ax) * t, nz = a.az + (a.bz - a.az) * t;
      const dx = nx - a.x, dz = nz - a.z;
      const moving = dx * dx + dz * dz > 1e-5;
      if (moving) { const th = Math.atan2(dx, dz); let d = th - a.hd; d = Math.atan2(Math.sin(d), Math.cos(d)); a.hd += d * 0.25; }
      else if (a.st === STATE.FIGHT) a.hd = a.sh;
      a.x = nx; a.z = nz;
      a.mv = moving;
      const near = showNear && Math.abs(nx - cp.x) < NEAR_R && Math.abs(nz - cp.z) < NEAR_R;
      if (near) {
        // stand on the ground exactly as drawn (avoids floating/sinking where terrain LOD simplifies)
        if (this.surface) a.y = this.surface(nx, nz);
        else if (Math.abs(nx - a.yx) > 0.4 || Math.abs(nz - a.yz) > 0.4) { a.y = w.heightAt(nx, nz); a.yx = nx; a.yz = nz; }
      } else if (np < MAX_ALL) {
        a.y = w.gridHeight(nx, nz);
      }
      const col = this.kColors.get(a.k) || C.set(0x999999);
      if (!near || camH > 260) {
        if (np < MAX_ALL) {
          this.ptPos[np * 3] = nx; this.ptPos[np * 3 + 1] = a.y + 3; this.ptPos[np * 3 + 2] = nz;
          const royal = ((a.fl >> 3) & 7) >= 2 && ((a.fl >> 3) & 7) <= 3;
          const sold = ((a.fl >> 3) & 7) === 1 || ((a.fl >> 3) & 7) === 5;
          const b = royal ? 1.6 : sold ? 1.15 : 0.85;
          this.ptCol[np * 3] = Math.min(1, col.r * b + (royal ? 0.3 : 0)); this.ptCol[np * 3 + 1] = Math.min(1, col.g * b + (royal ? 0.25 : 0)); this.ptCol[np * 3 + 2] = Math.min(1, col.b * b);
          np++;
        }
      }
      if (!near) continue;
      if (hidden && hidden.has(a.id)) continue; // drawn as a full rigged character instead
      const female = a.fl & 1, ag = (a.fl >> 1) & 3, role = (a.fl >> 3) & 7;
      const mesh = female ? this.female : this.male;
      const idx = female ? nf : nm;
      if (idx >= MAX_NEAR) continue;
      // size by age
      let s = ag === 0 ? 0.38 : ag === 1 ? 0.55 + Math.min(1, a.age / 14) * 0.35 : ag === 3 ? 0.95 : 1.0;
      if (role === 2) s *= 1.06;
      // pose
      let gait = 0, act = 0;
      const st = a.st;
      if (moving) gait = st === STATE.FLEE || st === STATE.FIGHT || (st === STATE.MARCH && (now - a.t0) < 400 && Math.hypot(a.bx - a.ax, a.bz - a.az) > 1.6) ? 2 : 1;
      if (st === STATE.FIGHT) act = 1; else if (st === STATE.FARM || st === STATE.MINE || st === STATE.BUILD) act = 2;
      else if (st === STATE.EAT || st === STATE.DRINK) act = 3; else if (st === STATE.FLEE && (a.ex & 0)) act = 4;
      let lying = st === STATE.REST && ag >= 1 && !moving;
      const sick = a.ex & 1;
      if (sick && !moving) lying = true;
      P.set(nx, a.y, nz);
      if (ag === 0) { P.x += Math.cos(a.hd) * 0.22; P.y += 0.75; }
      const inBed = (a.ex & 64) && st === STATE.REST;
      if (inBed) { P.x += Math.cos(a.sh) * 0.85 * s; P.z -= Math.sin(a.sh) * 0.85 * s; P.y += 0.5; E.set(-Math.PI / 2, a.sh + Math.PI / 2, 0, 'YXZ'); Q.setFromEuler(E); }
      else if (lying) { E.set(-Math.PI / 2, a.hd, 0, 'YXZ'); Q.setFromEuler(E); P.y += 0.15; }
      else Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.hd);
      S.set(s, s, s);
      M.compose(P, Q, S);
      mesh.setMatrixAt(idx, M);
      // clothing colour: kingdom colour blended with earthy cloth; royals richer; soldiers armoured
      const hash = (a.id * 0.618034) % 1;
      if (role === 2 || role === 3) C.copy(col).multiplyScalar(0.9).lerp(new THREE.Color(0.55, 0.08, 0.12), 0.25);
      else if (role === 1 || role === 5) C.setRGB(0.42, 0.43, 0.45).lerp(col, 0.45);
      else C.setRGB(0.45 + hash * 0.2, 0.36 + hash * 0.12, 0.24 + hash * 0.08).lerp(col, 0.35);
      if (a.hp < 0.3) C.lerp(new THREE.Color(0.5, 0.05, 0.03), 0.4);
      mesh.setColorAt(idx, C);
      const anim = female ? fAnim : mAnim, hair = female ? fHair : mHair;
      anim[idx * 4] = a.ph; anim[idx * 4 + 1] = gait; anim[idx * 4 + 2] = act; anim[idx * 4 + 3] = ((a.k * 0.37 + hash * 0.6) % 1);
      const hc = ag === 3 ? 0.75 : 0.05 + ((a.id * 0.371) % 1) * 0.3;
      hair[idx * 3] = hc; hair[idx * 3 + 1] = hc * (ag === 3 ? 1 : 0.75); hair[idx * 3 + 2] = hc * (ag === 3 ? 1 : 0.55);
      const faceArr = female ? fFace : mFace;
      // lip sync: speech boundaries pulse the mouth; otherwise flap while a line is being spoken
      let mouth = 0;
      if (a.mouthUntil > now) { a.mouthPulse = (a.mouthPulse || 0) * Math.pow(0.0005, 1 / 60); mouth = a.voiced ? Math.max(a.mouthPulse, 0.25 + 0.25 * Math.sin(time * 17 + a.ph)) : 0.45 + 0.45 * Math.sin(time * 15 + a.ph) * Math.sin(time * 6.3); }
      faceArr[idx * 2] = (a.ex >> 2) & 7; faceArr[idx * 2 + 1] = Math.max(0, mouth);
      if (female) nf++; else nm++;
      if (lying || ag === 0) continue;
      // accessories (follow body yaw)
      const ch = Math.cos(a.hd), sn = Math.sin(a.hd);
      if ((role === 2 || role === 3) && nc < 600) {
        P.set(nx, a.y + 1.8 * s, nz); Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.hd); S.set(s * 1.25, s * 1.25, s * 1.25); M.compose(P, Q, S); this.crowns.setMatrixAt(nc++, M);
      }
      if ((role === 1 || role === 5) && ns < 4000) {
        P.set(nx + ch * 0.32 * s, a.y + 0.2, nz - sn * 0.32 * s);
        if (st === STATE.FIGHT) { E.set(0.5 + Math.sin(time * 9 + a.ph) * 0.6, a.hd, 0, 'YXZ'); Q.setFromEuler(E); } else Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.hd);
        S.set(s, s, s); M.compose(P, Q, S); this.spears.setMatrixAt(ns, M);
        P.set(nx - ch * 0.3 * s + sn * 0.12, a.y + 1.1 * s, nz + sn * 0.3 * s + ch * 0.12); Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.hd); M.compose(P, Q, S);
        this.shields.setMatrixAt(ns, M); this.shields.setColorAt(ns, col);
        P.set(nx, a.y + 1.71 * s, nz); S.set(s * 1.22, s * 1.22, s * 1.22); M.compose(P, Q, S); this.helmets.setMatrixAt(ns, M); S.set(s, s, s);
        ns++;
      }
      if ((a.fl & 128) && nsk < 4000) {
        P.set(nx - sn * 0.22 * s, a.y + 1.2 * s, nz - ch * 0.22 * s); Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.hd); S.set(s, s, s); M.compose(P, Q, S);
        this.sacks.setMatrixAt(nsk++, M);
      }
    }
    for (const [m, n] of [[this.male, nm], [this.female, nf]]) {
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.geometry.attributes.aAnim.needsUpdate = true; m.geometry.attributes.aHair.needsUpdate = true; m.geometry.attributes.aFace.needsUpdate = true;
    }
    this.crowns.count = nc; this.crowns.instanceMatrix.needsUpdate = true;
    for (const m of [this.spears, this.shields, this.helmets]) { m.count = ns; m.instanceMatrix.needsUpdate = true; }
    if (this.shields.instanceColor) this.shields.instanceColor.needsUpdate = true;
    this.sacks.count = nsk; this.sacks.instanceMatrix.needsUpdate = true;
    this.points.geometry.setDrawRange(0, np);
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
    this.points.material.size = camH > 3000 ? 2.4 : camH > 1200 ? 3 : 3.6;

    const sel = this.agents.get(this.selected);
    this.ring.visible = this.beam.visible = !!sel;
    if (sel) {
      this.ring.position.set(sel.x, sel.y + 0.08, sel.z);
      const sc = Math.max(1, camH / 60); this.ring.scale.setScalar(sc);
      this.beam.position.set(sel.x, sel.y, sel.z); this.beam.scale.set(Math.max(1, camH / 120), Math.max(1, camH / 400), Math.max(1, camH / 120));
      this.ring.material.opacity = 0.6 + Math.sin(time * 4) * 0.3;
    }
  }

  // nearest agent to a screen point (pixels)
  pick(mx, my, camera, width, height, maxPx = 14) {
    const v = new THREE.Vector3();
    let best = null, bd = maxPx * maxPx;
    for (const a of this.list) {
      v.set(a.x, a.y + 1, a.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
