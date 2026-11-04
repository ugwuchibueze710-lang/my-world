// Chunked, level-of-detail terrain with a procedural splat shader (grass, forest floor, rock, sand,
// snow by temperature, seasonal colour, cultivated fields, kingdom borders, storm effects).
import * as THREE from 'three';
import { WORLD_SIZE, HALF, GRID } from '/shared/world.js';

const CHUNKS = 16, CSIZE = WORLD_SIZE / CHUNKS;
const LODS = [64, 32, 16, 6];

export class Terrain {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group(); scene.add(this.group);
    this.makeTextures();
    this.material = this.makeMaterial();
    this.chunks = [];
    this.queue = [];
    for (let j = 0; j < CHUNKS; j++) for (let i = 0; i < CHUNKS; i++) {
      const x0 = -HALF + i * CSIZE, z0 = -HALF + j * CSIZE;
      // skip chunks that are entirely deep ocean
      let maxH = -1e9;
      for (let s = 0; s <= 8; s++) for (let t = 0; t <= 8; t++) maxH = Math.max(maxH, world.gridHeight(x0 + (s / 8) * CSIZE, z0 + (t / 8) * CSIZE));
      if (maxH < -12) continue;
      const ch = { i, j, x0, z0, cx: x0 + CSIZE / 2, cz: z0 + CSIZE / 2, geos: [], lod: -1, mesh: null };
      ch.geos[3] = this.buildGeometry(ch, LODS[3]);
      ch.mesh = new THREE.Mesh(ch.geos[3], this.material);
      ch.mesh.receiveShadow = true; ch.mesh.castShadow = false;
      ch.mesh.frustumCulled = true;
      ch.lod = 3;
      this.group.add(ch.mesh);
      this.chunks.push(ch);
      (this.byIJ ||= new Map()).set(i + j * CHUNKS, ch);
    }
  }

  makeTextures() {
    const w = this.world;
    const N = GRID * GRID;
    const bio = new Uint8Array(N * 4);
    for (let c = 0; c < N; c++) {
      bio[c * 4] = Math.min(255, w.forest[c] * 255);
      bio[c * 4 + 1] = Math.min(255, w.fert[c] * 170);
      bio[c * 4 + 2] = Math.min(255, w.minerals[c] * 170);
      bio[c * 4 + 3] = Math.min(255, w.moist[c] * 255);
    }
    this.biomeTex = new THREE.DataTexture(bio, GRID, GRID, THREE.RGBAFormat);
    this.biomeTex.magFilter = THREE.LinearFilter; this.biomeTex.minFilter = THREE.LinearFilter; this.biomeTex.needsUpdate = true;
    this.landData = new Uint8Array(N * 4);
    this.landTex = new THREE.DataTexture(this.landData, GRID, GRID, THREE.RGBAFormat);
    this.landTex.magFilter = THREE.LinearFilter; this.landTex.minFilter = THREE.LinearFilter; this.landTex.needsUpdate = true;
    this.ownerData = new Uint8Array(128 * 128 * 4);
    this.ownerTex = new THREE.DataTexture(this.ownerData, 128, 128, THREE.RGBAFormat);
    this.ownerTex.magFilter = THREE.NearestFilter; this.ownerTex.minFilter = THREE.NearestFilter; this.ownerTex.needsUpdate = true;
  }

  setLand(ownerIdx, ownerIds, cult, colorOf) {
    for (let c = 0; c < GRID * GRID; c++) this.landData[c * 4] = cult[c];
    this.landTex.needsUpdate = true;
    this.cult = cult;
    for (let c = 0; c < 128 * 128; c++) {
      const o = ownerIdx[c];
      if (!o) { this.ownerData[c * 4 + 3] = 0; continue; }
      const col = colorOf(ownerIds[o - 1]);
      this.ownerData[c * 4] = col.r * 255; this.ownerData[c * 4 + 1] = col.g * 255; this.ownerData[c * 4 + 2] = col.b * 255;
      this.ownerData[c * 4 + 3] = 255;
    }
    this.ownerTex.needsUpdate = true;
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    const u = this.uniforms = {
      uBiome: { value: this.biomeTex }, uLand: { value: this.landTex }, uOwner: { value: this.ownerTex },
      uYear: { value: 0 }, uSeasonal: { value: 0 }, uOverlay: { value: 0.0 }, uBorders: { value: 1.0 }, uTime: { value: 0 },
      uFx: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uFxI: { value: new Float32Array(16) }, uFxN: { value: 0 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWN;
          uniform sampler2D uBiome; uniform sampler2D uLand; uniform sampler2D uOwner;
          uniform float uYear; uniform float uSeasonal; uniform float uOverlay; uniform float uBorders; uniform float uTime;
          uniform vec4 uFx[16]; uniform float uFxI[16]; uniform int uFxN;
          float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }
          float fbm3(vec2 p){ return vn(p)*0.55 + vn(p*2.07)*0.3 + vn(p*4.13)*0.15; }
          float roughOut = 0.93;
        `)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 uv = (vWPos.xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
            vec4 b = texture2D(uBiome, uv);
            float h = vWPos.y;
            float slope = 1.0 - clamp(normalize(vWN).y, 0.0, 1.0);
            float n1 = fbm3(vWPos.xz * 0.012);
            float n2 = fbm3(vWPos.xz * 0.11);
            float n3 = vn(vWPos.xz * 1.7);
            float s = fract(uYear);
            float wAut = smoothstep(0.47, 0.6, s) * (1.0 - smoothstep(0.72, 0.78, s));
            float wWin = smoothstep(0.72, 0.8, s) * (1.0 - smoothstep(0.95, 1.0, s));
            float wSum = smoothstep(0.28, 0.4, s) * (1.0 - smoothstep(0.5, 0.58, s));
            vec3 lush = vec3(0.17, 0.30, 0.075), dry = vec3(0.42, 0.40, 0.19);
            vec3 grass = mix(dry, lush, clamp(b.a * 1.35 - 0.1 + (n1 - 0.5) * 0.4, 0.0, 1.0));
            grass = mix(grass, vec3(0.44, 0.38, 0.16), wSum * 0.35 * (1.0 - b.a));
            grass = mix(grass, vec3(0.43, 0.33, 0.13), wAut * 0.55);
            grass = mix(grass, vec3(0.33, 0.31, 0.22), wWin * 0.65);
            grass *= 0.78 + 0.42 * n2 + 0.1 * n3;
            vec3 floorC = vec3(0.075, 0.12, 0.045) * (0.8 + 0.5 * n2);
            vec3 col = mix(grass, floorC, smoothstep(0.25, 0.75, b.r));
            vec3 rock = mix(vec3(0.30, 0.285, 0.27), vec3(0.52, 0.49, 0.45), n2) * (0.82 + 0.35 * n3);
            rock = mix(rock, vec3(0.45, 0.33, 0.24), b.b * 0.35 * n1);
            float rockAmt = clamp(smoothstep(0.32, 0.55, slope + (n1 - 0.5) * 0.25) + smoothstep(240.0, 420.0, h + (n1 - 0.5) * 120.0), 0.0, 1.0);
            col = mix(col, rock, rockAmt);
            float sandAmt = (1.0 - smoothstep(1.4, 3.8, h + (n2 - 0.5) * 2.0)) * (1.0 - smoothstep(0.25, 0.45, slope));
            col = mix(col, vec3(0.74, 0.66, 0.47) * (0.88 + 0.2 * n3), sandAmt);
            col = mix(col, vec3(0.30, 0.27, 0.19), 1.0 - smoothstep(-4.0, 0.6, h));
            // cultivated fields: a patchwork of crops that follows the seasons
            float cult = texture2D(uLand, uv).r;
            if (cult > 0.02) {
              vec2 plot = floor(vWPos.xz / 34.0);
              float ph = th(plot);
              float ang = ph * 3.14159;
              vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * vWPos.xz;
              float rows = smoothstep(0.2, 0.8, sin(rp.x * 2.4) * 0.5 + 0.5);
              vec3 crop = mix(vec3(0.26, 0.42, 0.11), vec3(0.36, 0.48, 0.14), ph);
              crop = mix(crop, mix(vec3(0.74, 0.60, 0.24), vec3(0.66, 0.55, 0.20), ph), smoothstep(0.3, 0.45, s) * (1.0 - smoothstep(0.62, 0.7, s)));
              crop = mix(crop, vec3(0.45, 0.35, 0.22), smoothstep(0.6, 0.7, s) * (1.0 - smoothstep(0.95, 1.0, s)));
              vec3 soil = vec3(0.33, 0.25, 0.16);
              vec3 field = mix(soil, crop, 0.55 + 0.45 * rows) * (0.9 + 0.2 * vn(vWPos.xz * 0.6));
              float edge = smoothstep(0.0, 1.2, min(min(fract(vWPos.x / 34.0), 1.0 - fract(vWPos.x / 34.0)), min(fract(vWPos.z / 34.0), 1.0 - fract(vWPos.z / 34.0))) * 34.0);
              field = mix(vec3(0.22, 0.27, 0.12), field, edge);
              col = mix(col, field, smoothstep(0.03, 0.3, cult) * (1.0 - rockAmt) * (1.0 - sandAmt) * step(0.5, h));
            }
            // snow where it is cold enough (same climate model as the simulation)
            float tempC = -3.0 + uv.y * 26.0 - max(h, 0.0) * 0.011 + uSeasonal + (n1 - 0.5) * 3.0;
            float snow = smoothstep(0.5, -1.5, tempC) * (1.0 - smoothstep(0.55, 0.85, slope)) * step(0.3, h);
            float wet = 0.0, burn = 0.0, drought = 0.0;
            for (int i = 0; i < 16; i++) {
              if (i >= uFxN) break;
              vec4 e = uFx[i];
              float d = length(vWPos.xz - e.xy);
              float k = (1.0 - smoothstep(e.z * 0.55, e.z, d)) * uFxI[i];
              if (e.w < 1.5) snow = max(snow, k * smoothstep(4.0, -1.0, tempC) * (1.0 - smoothstep(0.6, 0.85, slope)));
              else if (e.w < 2.5) drought = max(drought, k);
              else if (e.w < 3.5) wet = max(wet, k);
              else if (e.w < 4.5) burn = max(burn, k * (0.6 + 0.4 * n3));
              else wet = max(wet, k * 1.4);
            }
            col = mix(col, col * vec3(1.25, 1.05, 0.6) + vec3(0.06, 0.04, 0.0), drought * 0.7 * (1.0 - snow));
            col *= 1.0 - wet * 0.32;
            col = mix(col, vec3(0.04, 0.035, 0.03) + vec3(0.6, 0.18, 0.02) * step(0.85, n3) * burn, burn);
            col = mix(col, vec3(0.92, 0.94, 0.97) * (0.93 + 0.07 * n3), clamp(snow, 0.0, 1.0));
            roughOut = mix(0.93, 0.35, wet) * (1.0 - snow * 0.25);
            // kingdom territory & borders
            vec4 ow = texture2D(uOwner, uv);
            float tx = 1.0 / 128.0;
            vec4 o1 = texture2D(uOwner, uv + vec2(tx * 0.5, 0.0)), o2 = texture2D(uOwner, uv - vec2(tx * 0.5, 0.0));
            vec4 o3 = texture2D(uOwner, uv + vec2(0.0, tx * 0.5)), o4 = texture2D(uOwner, uv - vec2(0.0, tx * 0.5));
            float border = step(0.01, length(ow - o1) + length(ow - o2) + length(ow - o3) + length(ow - o4));
            vec3 bc = ow.a > 0.5 ? ow.rgb : max(max(o1.rgb, o2.rgb), max(o3.rgb, o4.rgb));
            col = mix(col, ow.rgb, ow.a * uOverlay * 0.38);
            col = mix(col, bc * 1.3 + 0.08, border * uBorders * 0.85);
            diffuseColor.rgb = col;
          }
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = roughOut;');
    };
    return mat;
  }

  buildGeometry(ch, S) {
    const w = this.world, step = CSIZE / S;
    const G = S + 3; // with border ring for seamless normals
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      hs[j * G + i] = w.heightAt(ch.x0 + (i - 1) * step, ch.z0 + (j - 1) * step);
    }
    const V = (S + 1) * (S + 1), E = S * 4;
    const pos = new Float32Array((V + E) * 3), nor = new Float32Array((V + E) * 3);
    let o = 0;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const gi = i + 1, gj = j + 1;
      pos[o] = ch.x0 + i * step; pos[o + 1] = hs[gj * G + gi]; pos[o + 2] = ch.z0 + j * step;
      const dx = hs[gj * G + gi - 1] - hs[gj * G + gi + 1], dz = hs[(gj - 1) * G + gi] - hs[(gj + 1) * G + gi];
      const L = Math.hypot(dx, 2 * step, dz);
      nor[o] = dx / L; nor[o + 1] = (2 * step) / L; nor[o + 2] = dz / L;
      o += 3;
    }
    const idx = [];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts hide cracks between neighbouring LODs
    const edge = [];
    for (let i = 0; i < S; i++) edge.push(i);
    for (let j = 0; j < S; j++) edge.push(j * (S + 1) + S);
    for (let i = S; i > 0; i--) edge.push(S * (S + 1) + i);
    for (let j = S; j > 0; j--) edge.push(j * (S + 1));
    const drop = 6 + step * 0.6;
    for (let k = 0; k < edge.length; k++) {
      const src = edge[k], dst = V + k;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - drop; pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length], c = V + k, d = V + ((k + 1) % edge.length);
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  // height of the terrain exactly as it is currently DRAWN (same triangles, same LOD), so feet touch the visible ground
  surfaceHeight(x, z) {
    const i = Math.floor((x + HALF) / CSIZE), j = Math.floor((z + HALF) / CSIZE);
    const ch = this.byIJ?.get(i + j * CHUNKS);
    if (!ch) return this.world.heightAt(x, z);
    const S = LODS[ch.lod], step = CSIZE / S;
    const pos = ch.mesh.geometry.attributes.position.array;
    let fx = (x - ch.x0) / step, fz = (z - ch.z0) / step;
    let gi = Math.min(S - 1, Math.max(0, Math.floor(fx))), gj = Math.min(S - 1, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - gi)), tz = Math.min(1, Math.max(0, fz - gj));
    const H = (ii, jj) => pos[((jj * (S + 1)) + ii) * 3 + 1];
    const ha = H(gi, gj), hb = H(gi + 1, gj), hc = H(gi, gj + 1), hd = H(gi + 1, gj + 1);
    return tx + tz <= 1 ? ha + (hb - ha) * tx + (hc - ha) * tz : hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
  }

  update(camera, budgetMs = 6) {
    const cp = camera.position;
    const t0 = performance.now();
    // decide desired LOD per chunk, refine nearest first
    const want = [];
    for (const ch of this.chunks) {
      const dy = Math.max(0, cp.y - 100);
      const d = Math.hypot(ch.cx - cp.x, ch.cz - cp.z, dy * 0.8) - CSIZE * 0.5;
      const lod = d < 550 ? 0 : d < 1500 ? 1 : d < 3400 ? 2 : 3;
      ch.dist = d;
      if (lod !== ch.lod) want.push([ch, lod]);
    }
    want.sort((a, b) => a[0].dist - b[0].dist);
    for (const [ch, lod] of want) {
      if (!ch.geos[lod]) {
        if (performance.now() - t0 > budgetMs) continue;
        ch.geos[lod] = this.buildGeometry(ch, LODS[lod]);
      }
      ch.mesh.geometry = ch.geos[lod]; ch.lod = lod;
      // free very detailed geometry when far away
      for (let l = 0; l < 2; l++) if (l < lod - 1 && ch.geos[l]) { ch.geos[l].dispose(); ch.geos[l] = null; }
    }
  }

  setEffects(storms, cal, time) {
    this.uniforms.uYear.value = cal.yearFrac;
    let n = 0;
    for (const s of storms) {
      if (n >= 16) break;
      const type = { snow: 1, blizzard: 1, drought: 2, heatwave: 2, rain: 3, thunderstorm: 3, hurricane: 3, wildfire: 4, flood: 5 }[s.type];
      if (!type) continue;
      this.uniforms.uFx.value[n].set(s.x, s.z, s.r * (type === 4 ? 1.15 : 1), type);
      this.uniforms.uFxI.value[n] = s.i * (type === 2 ? 0.9 : type === 1 ? 1 : 0.85);
      n++;
    }
    this.uniforms.uFxN.value = n;
  }
}
