// Forests and rocks, streamed in per terrain chunk with wind sway and seasonal colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SIZE, HALF, GRID } from '/shared/world.js';

const CH = 16, CS = WORLD_SIZE / CH;

function colorize(g, c) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function jitter(g, amt, seed) {
  const p = g.attributes.position; let s = seed;
  for (let i = 0; i < p.count; i++) {
    s = (s * 16807) % 2147483647; const a = s / 2147483647 - 0.5;
    s = (s * 16807) % 2147483647; const b = s / 2147483647 - 0.5;
    p.setX(i, p.getX(i) + a * amt); p.setZ(i, p.getZ(i) + b * amt);
  }
  g.computeVertexNormals();
  return g;
}

function pineGeometry() {
  const parts = [colorize(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6).translate(0, 1.6, 0), [0.28, 0.19, 0.12])];
  const layers = [[2.4, 3.6, 2.2], [3.9, 2.9, 4.4], [5.3, 2.2, 6.4], [6.4, 1.4, 8.0]];
  layers.forEach(([y, r, top], i) => {
    const h = top - y + 1.6;
    parts.push(colorize(jitter(new THREE.ConeGeometry(r, h, 8, 1).translate(0, y + h / 2 - 0.4, 0), 0.35, 11 + i), [0.10 + i * 0.01, 0.20 + i * 0.015, 0.11]));
  });
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
function broadleafGeometry() {
  const parts = [colorize(new THREE.CylinderGeometry(0.22, 0.38, 3.6, 6).translate(0, 1.8, 0), [0.30, 0.22, 0.15])];
  const blobs = [[0, 5.0, 0, 2.6], [1.3, 4.2, 0.6, 1.9], [-1.2, 4.4, -0.5, 2.0], [0.3, 6.0, -0.9, 1.7], [-0.5, 5.6, 1.1, 1.6]];
  blobs.forEach(([x, y, z, r], i) => parts.push(colorize(jitter(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), 0.5, 7 + i), [1, 1, 1])));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position; let s = 3;
  for (let i = 0; i < p.count; i++) { s = (s * 16807) % 2147483647; const k = 0.75 + (s / 2147483647) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
  g.computeVertexNormals();
  return colorize(g.toNonIndexed(), [0.45, 0.43, 0.4]);
}

export class Vegetation {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group(); scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0) }, uWindS: { value: 0.3 }, uLeaf: { value: new THREE.Color(0.2, 0.36, 0.1) } };
    const sway = (mat, leafy) => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind; uniform float uWindS;' + (leafy ? '\nuniform vec3 uLeaf;' : ''))
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float hh = max(position.y - 1.5, 0.0);
            float ph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
            float bend = hh * hh * 0.004 * (uWindS * (0.6 + 0.4 * sin(uTime * (1.2 + uWindS) + ph)) + 0.08 * sin(uTime * 2.3 + ph));
            transformed.x += uWind.x * bend; transformed.z += uWind.z * bend;`)
          .replace('#include <color_vertex>', leafy ? `#include <color_vertex>
            float lph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
            if (color.r > 0.9) vColor.rgb = uLeaf * (0.8 + 0.4 * fract(lph * 7.31));
            #ifdef USE_INSTANCING_COLOR
              vColor.rgb *= instanceColor;
            #endif` : '#include <color_vertex>');
      };
      return mat;
    };
    this.pineGeo = pineGeometry(); this.leafGeo = broadleafGeometry(); this.rockGeo = rockGeometry();
    this.pineMat = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), false);
    this.leafMat = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), true);
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.chunks = new Map();
    this.clearings = [];
  }

  buildChunk(i, j) {
    const w = this.world, x0 = -HALF + i * CS, z0 = -HALF + j * CS;
    let seed = (i * 73856093) ^ (j * 19349663) ^ 0x5bd1e995;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pines = [], leaves = [], rocks = [];
    const tries = 2600;
    for (let k = 0; k < tries; k++) {
      const x = x0 + rnd() * CS, z = z0 + rnd() * CS;
      const c = w.cellIndex(x, z); if (c < 0) continue;
      const h0 = w.gh[c]; if (h0 < 2) continue;
      const sl = w.slope[c];
      const dens = w.forest[c] * 0.95 + (w.moist[c] > 0.35 && sl < 0.4 ? 0.025 : 0);
      if (w.minerals[c] > 0.5 && sl > 0.3 && rnd() < 0.05 && rocks.length < 160) rocks.push([x, z, 0.8 + rnd() * 2.6]);
      if (rnd() > dens || sl > 0.75 || w.river[c] && w.rdist[c] === 0 && rnd() < 0.8) continue;
      const h = w.heightAt(x, z);
      if (h < 1.6) continue;
      const cold = w.temp[c] < 5 || h > 250;
      const s = 0.7 + rnd() * 0.75;
      (cold || rnd() < 0.3 ? pines : leaves).push([x, h, z, s, rnd() * 6.283]);
    }
    for (const r of rocks) r.splice(1, 0, w.heightAt(r[0], r[1]));
    const mk = (geo, mat, list, shadow) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      list.forEach((t, idx) => {
        P.set(t[0], t[1] - 0.3, t[2]); Q.setFromAxisAngle(Y, t[4] ?? 0); const s = t[3]; S.set(s, s * (0.9 + (idx % 7) * 0.04), s);
        M.compose(P, Q, S); m.setMatrixAt(idx, M);
        if (m.instanceColor || mat === this.leafMat) { const v = 0.82 + ((idx * 0.137) % 1) * 0.36; m.setColorAt(idx, new THREE.Color(v, v * (0.95 + ((idx * 0.71) % 1) * 0.1), v)); }
      });
      m.castShadow = shadow; m.receiveShadow = true;
      m.computeBoundingSphere();
      m.userData.base = list;
      this.group.add(m);
      return m;
    };
    const rk = rocks.map((r) => [r[0], r[1], r[2], r[3], rnd() * 6.283]);
    return { i, j, cx: x0 + CS / 2, cz: z0 + CS / 2, pine: mk(this.pineGeo, this.pineMat, pines, true), leaf: mk(this.leafGeo, this.leafMat, leaves, true), rock: mk(this.rockGeo, this.rockMat, rk, true) };
  }

  // clear trees inside settlements and fields
  setClearings(kingdoms, cult) {
    this.clearings = kingdoms.map((k) => [k.x, k.z, 40 + Math.sqrt(k.houses.length) * 22]);
    this.cult = cult;
    for (const ch of this.chunks.values()) this.applyClearings(ch);
  }
  applyClearings(ch) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const m of [ch.pine, ch.leaf]) {
      if (!m) continue;
      const base = m.userData.base;
      let changed = false;
      base.forEach((t, idx) => {
        let hide = false;
        for (const [cx, cz, r] of this.clearings) if (Math.abs(t[0] - cx) < r && Math.abs(t[2] - cz) < r && Math.hypot(t[0] - cx, t[2] - cz) < r) { hide = true; break; }
        if (!hide && this.cult) { const c = this.world.cellIndex(t[0], t[2]); if (c >= 0 && this.cult[c] > 40) hide = true; }
        if (hide === !!t.hidden) return;
        t.hidden = hide; changed = true;
        P.set(t[0], t[1] - 0.3, t[2]); Q.setFromAxisAngle(Y, t[4]); const s = hide ? 0.0001 : t[3]; S.set(s, s * (0.9 + (idx % 7) * 0.04), s);
        M.compose(P, Q, S); m.setMatrixAt(idx, M);
      });
      if (changed) m.instanceMatrix.needsUpdate = true;
    }
  }

  update(camera, time, wind, windS, yearFrac, budgetMs = 5) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value.set(wind.x, 0, wind.z);
    this.uniforms.uWindS.value += (Math.min(2.2, windS / 7) - this.uniforms.uWindS.value) * 0.02;
    // seasonal leaf colour for broadleaf trees
    const s = yearFrac;
    const spring = new THREE.Color(0.30, 0.48, 0.14), summer = new THREE.Color(0.18, 0.34, 0.09), autumn = new THREE.Color(0.62, 0.32, 0.08), winter = new THREE.Color(0.36, 0.30, 0.22);
    const c = s < 0.25 ? spring.clone().lerp(summer, s / 0.25) : s < 0.5 ? summer.clone().lerp(autumn, Math.max(0, (s - 0.42) / 0.08)) : s < 0.75 ? autumn.clone().lerp(winter, Math.max(0, (s - 0.66) / 0.09)) : winter.clone().lerp(spring, Math.max(0, (s - 0.94) / 0.06));
    this.uniforms.uLeaf.value.copy(c);

    const cp = camera.position, t0 = performance.now();
    const R = 2800;
    const ci = Math.floor((cp.x + HALF) / CS), cj = Math.floor((cp.z + HALF) / CS);
    const need = [];
    for (let j = cj - 6; j <= cj + 6; j++) for (let i = ci - 6; i <= ci + 6; i++) {
      if (i < 0 || j < 0 || i >= CH || j >= CH) continue;
      const cx = -HALF + (i + 0.5) * CS, cz = -HALF + (j + 0.5) * CS;
      const d = Math.hypot(cx - cp.x, cz - cp.z, Math.max(0, cp.y - 200));
      if (d < R) need.push([d, i, j]);
    }
    need.sort((a, b) => a[0] - b[0]);
    for (const [d, i, j] of need) {
      const key = i + j * CH;
      if (!this.chunks.has(key)) {
        if (performance.now() - t0 > budgetMs) break;
        const ch = this.buildChunk(i, j);
        this.applyClearings(ch);
        this.chunks.set(key, ch);
      }
    }
    for (const ch of this.chunks.values()) {
      const d = Math.hypot(ch.cx - cp.x, ch.cz - cp.z, Math.max(0, cp.y - 200));
      const vis = d < R + 200;
      const shadow = d < 900;
      for (const m of [ch.pine, ch.leaf, ch.rock]) if (m) { m.visible = vis; m.castShadow = shadow; }
    }
  }
}
