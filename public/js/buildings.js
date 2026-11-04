// Castles (growing with each realm), houses, wells, banners, and the ruins of fallen kingdoms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneTexture, plasterTexture, roofTexture } from './textures.js';

const MAX_HOUSES = 8000;

function box(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z); }
function cyl(rt, rb, h, x, y, z, seg = 12) { return new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z); }
function cone(r, h, x, y, z, seg = 12) { return new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z); }
function crenels(w, d, y, size = 1.2) {
  const g = [];
  for (let x = -w / 2; x <= w / 2; x += size * 2) { g.push(box(size, size, size, x, y, -d / 2)); g.push(box(size, size, size, x, y, d / 2)); }
  for (let z = -d / 2 + size * 2; z <= d / 2 - size; z += size * 2) { g.push(box(size, size, size, -w / 2, y, z)); g.push(box(size, size, size, w / 2, y, z)); }
  return g;
}
function wallRing(R, h, t, y, gate = true) {
  const g = [];
  const sides = [[0, -R, 2 * R, t], [0, R, 2 * R, t], [-R, 0, t, 2 * R], [R, 0, t, 2 * R]];
  sides.forEach(([x, z, w, d], i) => {
    if (gate && i === 1) { g.push(box(R - 5, h, t, -R / 2 - 2.5, y, z), box(R - 5, h, t, R / 2 + 2.5, y, z), box(10, h * 0.45, t, 0, y + h * 0.55, z)); }
    else g.push(box(w, h, d, x, y, z));
  });
  for (let x = -R; x <= R; x += 3) { g.push(box(1.2, 1.2, t, x, y + h, -R)); }
  for (let z = -R; z <= R; z += 3) { g.push(box(t, 1.2, 1.2, -R, y + h, z), box(t, 1.2, 1.2, R, y + h, z)); }
  return g;
}

export class Buildings {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group(); scene.add(this.group);
    const st = stoneTexture(256); st.repeat.set(0.12, 0.12);
    this.stone = new THREE.MeshStandardMaterial({ map: st, roughness: 0.92, color: 0xd8d2c4 });
    this.stone.onBeforeCompile = (sh) => { // world-space triplanar-ish UVs so blocks look right at any size
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvec3 wp = (modelMatrix * vec4(position,1.0)).xyz; vec3 an = abs(normal); vMapUv = (an.y > 0.5 ? wp.xz : an.x > 0.5 ? wp.zy : wp.xy) * 0.18;\n#endif');
    };
    const rt = roofTexture(); rt.repeat.set(2, 2);
    this.roof = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.75 });
    this.wood = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.9 });
    this.gold = new THREE.MeshStandardMaterial({ color: 0xffcc55, metalness: 0.9, roughness: 0.25, emissive: 0x332200 });
    this.flagUniforms = { uTime: { value: 0 } };
    this.castles = new Map();
    this.ruins = new Map();

    // houses: walls + roofs + glowing windows, all instanced
    const pt = plasterTexture();
    const wallGeo = new THREE.BoxGeometry(6, 3.6, 5).translate(0, 1.6, 0);
    const roofGeo = new THREE.CylinderGeometry(0.01, 4.3, 3.2, 4, 1).rotateY(Math.PI / 4).scale(1.0, 1, 0.84).translate(0, 4.9, 0);
    const winGeo = mergeGeometries([
      new THREE.PlaneGeometry(0.9, 1.0).translate(-1.4, 2.0, 2.51), new THREE.PlaneGeometry(0.9, 1.0).translate(1.4, 2.0, 2.51),
      new THREE.PlaneGeometry(0.9, 1.0).rotateY(Math.PI).translate(-1.4, 2.0, -2.51), new THREE.PlaneGeometry(0.9, 1.0).translate(0, 0, 0).rotateY(Math.PI / 2).translate(3.01, 2.0, 0),
    ]);
    const chimGeo = new THREE.BoxGeometry(0.8, 2.4, 0.8).translate(1.6, 5.2, 0.8);
    this.houseWalls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ map: pt, roughness: 0.95 }), MAX_HOUSES);
    this.houseRoofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ map: rt, roughness: 0.85 }), MAX_HOUSES);
    this.houseChim = new THREE.InstancedMesh(chimGeo, this.stone, MAX_HOUSES);
    this.winMat = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.0, fog: true });
    this.houseWin = new THREE.InstancedMesh(winGeo, this.winMat, MAX_HOUSES);
    for (const m of [this.houseWalls, this.houseRoofs, this.houseChim, this.houseWin]) { m.count = 0; m.castShadow = m !== this.houseWin; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
    // interiors (house-local coordinates match the simulation's bed positions)
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
    const nonIdx = (gs) => mergeGeometries(gs.map((g) => g.toNonIndexed()));
    const floorGeo = box(5.7, 0.06, 4.7, 0, 0.0, 0);
    const bedFrame = nonIdx([box(2.1, 0.35, 1.6, -1.55, 0.05, -0.55), box(0.12, 0.9, 1.6, -2.62, 0.05, -0.55), // double bed + headboard
      box(1.9, 0.3, 0.8, 1.75, 0.05, -1.3), box(1.9, 0.3, 0.8, 1.75, 0.05, -0.2), box(1.9, 0.3, 0.8, 1.75, 0.05, 0.9)]);
    const blankets = nonIdx([box(1.5, 0.12, 1.5, -1.2, 0.4, -0.55), box(1.3, 0.1, 0.72, 2.0, 0.35, -1.3), box(1.3, 0.1, 0.72, 2.0, 0.35, -0.2), box(1.3, 0.1, 0.72, 2.0, 0.35, 0.9)]);
    const pillows = nonIdx([box(0.4, 0.12, 0.55, -2.35, 0.4, -0.93), box(0.4, 0.12, 0.55, -2.35, 0.4, -0.17), box(0.32, 0.1, 0.5, 0.95, 0.35, -1.3), box(0.32, 0.1, 0.5, 0.95, 0.35, -0.2), box(0.32, 0.1, 0.5, 0.95, 0.35, 0.9)]);
    const table = nonIdx([box(1.4, 0.08, 0.8, 0.0, 0.72, 1.55), box(0.08, 0.72, 0.08, -0.6, 0, 1.25), box(0.08, 0.72, 0.08, 0.6, 0, 1.25), box(0.08, 0.72, 0.08, -0.6, 0, 1.85), box(0.08, 0.72, 0.08, 0.6, 0, 1.85),
      box(0.4, 0.45, 0.4, -0.9, 0, 1.55), box(0.4, 0.45, 0.4, 0.9, 0, 1.55)]);
    const hearth = box(1.1, 1.2, 0.6, -2.4, 0, 1.7);
    const fire = new THREE.ConeGeometry(0.28, 0.55, 8).translate(-2.4, 0.4, 1.75);
    const mk = (g, mat, shadow = false) => { const m = new THREE.InstancedMesh(g, mat, MAX_HOUSES); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = shadow; this.group.add(m); return m; };
    this.inFloor = mk(floorGeo, new THREE.MeshStandardMaterial({ color: 0x6b4c32, roughness: 0.9 }));
    this.inBeds = mk(bedFrame, this.wood, true);
    this.inBlankets = mk(blankets, new THREE.MeshStandardMaterial({ color: 0xa83a32, roughness: 1 }));
    this.inPillows = mk(pillows, new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 1 }));
    this.inTable = mk(table, this.wood, true);
    this.inHearth = mk(hearth, this.stone);
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
    this.inFire = mk(fire, this.fireMat);
    this.interiors = [this.inFloor, this.inBeds, this.inBlankets, this.inPillows, this.inTable, this.inHearth, this.inFire];
    this.houseMats = [];
    this.cut = new Set(); this.cutT = 0;
    this.hearthLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff9040, 0, 9, 1.6); this.group.add(l); return l; });
    this.houseVer = '';
    this.housePositions = [];
  }

  castleGeometry(tier) {
    const s = [], r = [], w = [];
    if (tier <= 1) {
      // timber longhall with palisade
      w.push(box(14, 5, 8, 0, 0, 0));
      r.push(new THREE.CylinderGeometry(0.01, 9.5, 5, 4, 1).rotateY(Math.PI / 4).scale(1.05, 1, 0.62).translate(0, 7.4, 0));
      for (let a = 0; a < 40; a++) { const t = (a / 40) * Math.PI * 2; if (a > 8 && a < 12) continue; /* gate gap facing local +z */ w.push(cyl(0.3, 0.35, 4.5, Math.cos(t) * 17, -0.5, Math.sin(t) * 17, 5)); }
    } else if (tier === 2) {
      s.push(box(12, 15, 12, 0, 0, 0), ...crenels(12, 12, 15));
      s.push(cyl(3.2, 3.6, 19, 7, 0, 7), cyl(3.2, 3.6, 19, -7, 0, -7));
      r.push(cone(4, 6, 7, 19, 7), cone(4, 6, -7, 19, -7));
      s.push(...wallRing(24, 5, 1.4, 0));
      w.push(box(9, 4, 6, -12, 0, 10), box(7, 3.5, 6, 13, 0, -11));
    } else {
      const R = tier === 3 ? 34 : 50, K = tier === 3 ? 16 : 22, KH = tier === 3 ? 22 : 30;
      s.push(box(K, KH, K, 0, 0, 0), ...crenels(K, K, KH, 1.4));
      s.push(cyl(4, 4.6, KH + 9, K / 2, 0, K / 2), cyl(4, 4.6, KH + 9, -K / 2, 0, -K / 2), cyl(4, 4.6, KH + 6, K / 2, 0, -K / 2), cyl(4, 4.6, KH + 6, -K / 2, 0, K / 2));
      r.push(cone(5.2, 9, K / 2, KH + 9, K / 2), cone(5.2, 9, -K / 2, KH + 9, -K / 2), cone(5.2, 7, K / 2, KH + 6, -K / 2), cone(5.2, 7, -K / 2, KH + 6, K / 2));
      s.push(...wallRing(R, 9, 2.2, 0));
      for (const [x, z] of [[R, R], [-R, R], [R, -R], [-R, -R]]) { s.push(cyl(5, 5.6, 14, x, 0, z)); r.push(cone(6.3, 8, x, 14, z)); }
      s.push(box(8, 14, 6, -9, 0, R + 2), box(8, 14, 6, 9, 0, R + 2), box(10, 4, 6, 0, 10, R + 2)); // gatehouse towers and arch over an open gate
      if (tier >= 4) {
        s.push(cyl(6, 7, KH + 22, 0, 0, 0, 16)); r.push(cone(8, 14, 0, KH + 22, 0, 16));
        for (const [x, z] of [[0, R], [0, -R], [R, 0], [-R, 0]]) if (z !== R) { s.push(cyl(4.5, 5, 13, x, 0, z)); r.push(cone(5.6, 7, x, 13, z)); }
        w.push(box(14, 6, 9, -R * 0.55, 0, -R * 0.4), box(12, 6, 8, R * 0.5, 0, -R * 0.5), box(10, 5, 10, R * 0.5, 0, R * 0.45));
      }
    }
    // foundations sink into slopes
    s.push(box(tier <= 1 ? 1 : 14, 6, tier <= 1 ? 1 : 14, 0, -6, 0));
    const m = (arr) => (arr.length ? mergeGeometries(arr.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
    return { stone: m(s), roof: m(r), wood: m(w) };
  }

  flagMesh(color, capital, h) {
    const g = new THREE.PlaneGeometry(capital ? 9 : 6, capital ? 5.5 : 4, 10, 4).translate(capital ? 4.5 : 3, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, emissive: new THREE.Color(color).multiplyScalar(0.15) });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.flagUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(position.x * 0.9 - uTime * 6.0) * 0.35 * (position.x / 6.0);');
    };
    const flag = new THREE.Mesh(g, mat);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 6).translate(0, 4, 0), this.wood);
    const grp = new THREE.Group();
    flag.position.y = 6.2;
    grp.add(pole, flag);
    if (capital) {
      const crown = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.4, 1.1, 16, 1, true), this.gold);
      crown.add(ring);
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3, 6), this.gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 1.5, 1.1, Math.sin(a) * 1.5); crown.add(sp); }
      crown.position.y = 9.6; crown.userData.spin = true;
      grp.add(crown);
    }
    grp.position.y = h;
    return grp;
  }

  syncKingdoms(kingdoms) {
    const seen = new Set();
    for (const k of kingdoms) {
      seen.add(k.id);
      let c = this.castles.get(k.id);
      const key = `${k.tier}|${k.capital}|${k.color}`;
      if (!c || c.key !== key) {
        if (c) this.group.remove(c.group);
        const grp = new THREE.Group();
        const geos = this.castleGeometry(k.tier);
        const y = this.world.heightAt(k.x, k.z);
        for (const [g, mat] of [[geos.stone, this.stone], [geos.roof, this.roof], [geos.wood, this.wood]]) {
          if (!g) continue;
          const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; grp.add(m);
        }
        const topH = k.tier <= 1 ? 10 : k.tier === 2 ? 25 : k.tier === 3 ? 40 : 61;
        const flag = this.flagMesh(k.color, k.capital, topH);
        grp.add(flag);
        if (k.well) { // well beside the keep
          const wg = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1.1, 14, 1, true), this.stone); ring.position.y = 0.55;
          const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.2, 4), this.wood); roof.position.y = 3; roof.rotation.y = Math.PI / 4;
          const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4), this.wood); p1.position.set(1, 1.6, 0);
          const p2 = p1.clone(); p2.position.x = -1;
          wg.add(ring, roof, p1, p2);
          const c = Math.cos(k.rot), sn = Math.sin(k.rot);
          wg.position.set(8, this.world.heightAt(k.x + 8 * c - 6.5 * sn, k.z - 8 * sn - 6.5 * c) - y, -6.5);
          wg.children.forEach((m) => { m.castShadow = true; });
          grp.add(wg);
        }
        grp.position.set(k.x, y, k.z);
        grp.rotation.y = k.rot;
        this.group.add(grp);
        c = { group: grp, key, flag };
        this.castles.set(k.id, c);
      }
    }
    for (const [id, c] of this.castles) if (!seen.has(id)) { this.group.remove(c.group); this.castles.delete(id); }

    // houses
    const ver = kingdoms.map((k) => k.id + ':' + k.hv).join(',');
    if (ver !== this.houseVer) {
      this.houseVer = ver;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      const C = new THREE.Color();
      let n = 0;
      this.housePositions = [];
      for (const k of kingdoms) {
        for (const h of k.houses) {
          if (n >= MAX_HOUSES) break;
          const [x, z, rot] = h;
          const y = this.world.heightAt(x, z);
          const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
          S.set(0.85 + hash * 0.45, 0.9 + hash * 0.3, 0.85 + ((hash * 7) % 1) * 0.4);
          P.set(x, y - 0.2, z); Q.setFromAxisAngle(Y, (rot || 0) + Math.PI / 2);
          M.compose(P, Q, S);
          this.houseWalls.setMatrixAt(n, M); this.houseRoofs.setMatrixAt(n, M); this.houseChim.setMatrixAt(n, M); this.houseWin.setMatrixAt(n, M);
          C.setHSL(0.08 + hash * 0.05, 0.25 + hash * 0.2, 0.75 + hash * 0.15); this.houseWalls.setColorAt(n, C);
          C.setHSL(hash < 0.6 ? 0.02 + hash * 0.03 : 0.58, hash < 0.6 ? 0.45 : 0.08, 0.5 + hash * 0.2); this.houseRoofs.setColorAt(n, C);
          this.housePositions.push([x, z, k.id, (rot || 0) + Math.PI / 2, S.x, S.z]);
          this.houseMats[n] = M.clone();
          for (const im of this.interiors) im.setMatrixAt(n, M);
          n++;
        }
      }
      this.cut.clear();
      for (const m of [this.houseWalls, this.houseRoofs, this.houseChim, this.houseWin, ...this.interiors]) {
        m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  syncRuins(ruins) {
    for (const r of ruins) {
      const key = `${r.x},${r.z}`;
      if (this.ruins.has(key)) continue;
      const grp = new THREE.Group();
      const parts = [];
      const R = r.tier >= 3 ? 30 : 18;
      let seed = r.x * 31 + r.z;
      const rnd = () => { seed = (seed * 16807 + 7) % 2147483647; return Math.abs(seed) / 2147483647; };
      parts.push(box(10, 6 + rnd() * 6, 10, 0, -1, 0));
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        if (rnd() < 0.35) continue;
        parts.push(box(2, 1 + rnd() * 5, R * 0.42, Math.cos(a) * R, -0.5, Math.sin(a) * R).rotateY(-a));
      }
      for (let i = 0; i < 18; i++) parts.push(box(1 + rnd() * 2, 0.6 + rnd(), 1 + rnd() * 2, (rnd() - 0.5) * R * 2, -0.2, (rnd() - 0.5) * R * 2));
      const m = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ map: this.stone.map, color: 0x8a857a, roughness: 1 }));
      m.castShadow = m.receiveShadow = true;
      grp.add(m);
      grp.position.set(r.x, this.world.heightAt(r.x, r.z), r.z);
      this.group.add(grp);
      this.ruins.set(key, grp);
    }
  }

  // lift the roofs off houses near the camera so you can see inside (doll-house view)
  updateCutaway(camera) {
    const cp = camera.position, want = new Set();
    for (let i = 0; i < this.housePositions.length; i++) {
      const [x, z] = this.housePositions[i];
      const d = Math.hypot(x - cp.x, z - cp.z);
      if (d < 24 && cp.y - this.world.heightAt(x, z) < 45) want.add(i);
    }
    const Z = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;
    for (const i of this.cut) if (!want.has(i)) { this.houseRoofs.setMatrixAt(i, this.houseMats[i]); this.houseChim.setMatrixAt(i, this.houseMats[i]); changed = true; }
    for (const i of want) if (!this.cut.has(i)) { this.houseRoofs.setMatrixAt(i, Z); this.houseChim.setMatrixAt(i, Z); changed = true; }
    this.cut = want;
    if (changed) { this.houseRoofs.instanceMatrix.needsUpdate = true; this.houseChim.instanceMatrix.needsUpdate = true; }
    // hearths light the rooms you are looking into
    const lit = [...want].sort((a, b) => Math.hypot(this.housePositions[a][0] - cp.x, this.housePositions[a][1] - cp.z) - Math.hypot(this.housePositions[b][0] - cp.x, this.housePositions[b][1] - cp.z));
    this.hearthLights.forEach((l, j) => {
      const i = lit[j];
      if (i === undefined) { l.userData.on = false; return; }
      const p = new THREE.Vector3(-2.4, 1.0, 1.4).applyMatrix4(this.houseMats[i]);
      l.position.copy(p); l.userData.on = true;
    });
  }
  // the house (if any) that contains a point, with its frame — used by the movie director
  houseAt(x, z) {
    let best = null, bd = 6;
    for (const h of this.housePositions) { const d = Math.hypot(h[0] - x, h[1] - z); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  update(time, night) {
    const flick = 0.75 + 0.25 * Math.sin(time * 9) * Math.sin(time * 5.3);
    this.fireMat.color.setRGB(1, 0.45 + 0.15 * flick, 0.12);
    this.hearthLights.forEach((l) => { l.intensity = l.userData.on ? (0.6 + night * 3.2) * flick : 0; });
    this.flagUniforms.uTime.value = time;
    this.winMat.opacity = night * 0.95;
    for (const c of this.castles.values()) c.flag.traverse((o) => { if (o.userData.spin) o.rotation.y = time * 0.6; });
  }
}
