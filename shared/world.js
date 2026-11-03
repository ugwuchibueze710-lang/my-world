// Procedural continent shared by the simulation server and the browser renderer.
// Everything here is deterministic from the seed so both sides build the identical world.
import { mulberry32, createNoise2D } from './noise.js';

export const WORLD_SIZE = 8000;            // metres, east-west and north-south
export const HALF = WORLD_SIZE / 2;
export const GRID = 256;                   // simulation grid (31.25 m cells)
export const CELL = WORLD_SIZE / GRID;
export const FINE = 1024;                  // river-carving grid (7.8 m cells)
export const FCELL = WORLD_SIZE / FINE;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

class MinHeap {
  constructor(n) { this.idx = new Int32Array(n); this.key = new Float32Array(n); this.size = 0; }
  push(i, k) {
    let p = this.size++;
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (this.key[parent] <= k) break;
      this.idx[p] = this.idx[parent]; this.key[p] = this.key[parent]; p = parent;
    }
    this.idx[p] = i; this.key[p] = k;
  }
  pop() {
    const top = this.idx[0];
    const li = this.idx[--this.size], lk = this.key[this.size];
    let p = 0;
    for (;;) {
      let c = p * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lk) break;
      this.idx[p] = this.idx[c]; this.key[p] = this.key[c]; p = c;
    }
    this.idx[p] = li; this.key[p] = lk;
    return top;
  }
}

export function createWorld(seed = 20261103) {
  const rand = mulberry32(seed);
  const nWarp = createNoise2D(rand), nCont = createNoise2D(rand), nDet = createNoise2D(rand);
  const nRidge = createNoise2D(rand), nMtn = createNoise2D(rand), nMoist = createNoise2D(rand);
  const nMin = createNoise2D(rand), nBias = createNoise2D(rand), nForest = createNoise2D(rand);
  const nJit = createNoise2D(rand);

  function fbm(fn, x, z, oct) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * fn(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function ridged(fn, x, z, oct) {
    let s = 0, a = 1, f = 1, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(fn(x * f, z * f));
      v *= v; v *= w; w = clamp(v * 1.7, 0, 1);
      s += a * v; n += a; a *= 0.5; f *= 2.1;
    }
    return s / n;
  }

  // continental elevation before rivers
  function rawHeight(x, z) {
    const nx = x / HALF, nz = z / HALF;
    const wx = nx + 0.28 * fbm(nWarp, nx * 1.2 + 1.7, nz * 1.2 + 9.2, 3);
    const wz = nz + 0.28 * fbm(nWarp, nx * 1.2 - 4.1, nz * 1.2 + 2.8, 3);
    const d = Math.sqrt(wx * wx * 0.85 + wz * wz);
    const e = 0.6 - d * 0.88 + fbm(nCont, wx * 1.7, wz * 1.7, 4) * 0.55;
    const mz = smoothstep(0.02, 0.42, fbm(nMtn, nx * 1.35 + 3.3, nz * 1.35 - 7.7, 3) + 0.1);
    const r = ridged(nRidge, nx * 2.7 + 0.5, nz * 2.7 - 1.5, 6);
    let h;
    if (e > 0) {
      const land = smoothstep(0, 0.28, e);
      h = e * 95 + land * mz * r * r * 640 + land * r * 30 + 1.2;
    } else {
      h = e * 240 + 1.2;
    }
    const det = fbm(nDet, nx * 44, nz * 44, 3);
    h += det * (h > 0 ? 2.5 + Math.min(h * 0.04, 9) : 1.5);
    return h;
  }

  // ---------- simulation grid ----------
  const N = GRID * GRID;
  const gh = new Float32Array(N);
  const cx = (i) => -HALF + (i + 0.5) * CELL;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) gh[j * GRID + i] = rawHeight(cx(i), cx(j));

  // priority-flood: gives pit-free flow directions toward the sea
  const filled = new Float32Array(N), recv = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N), order = new Int32Array(N);
  const heap = new MinHeap(N);
  for (let c = 0; c < N; c++) {
    const i = c % GRID, j = (c / GRID) | 0;
    if (gh[c] <= 0 || i === 0 || j === 0 || i === GRID - 1 || j === GRID - 1) {
      visited[c] = 1; filled[c] = gh[c]; heap.push(c, gh[c]);
    }
  }
  let oc = 0;
  const NB = [-1, 1, -GRID, GRID, -GRID - 1, -GRID + 1, GRID - 1, GRID + 1];
  while (heap.size) {
    const c = heap.pop(); order[oc++] = c;
    const i = c % GRID;
    for (let k = 0; k < 8; k++) {
      const nb = c + NB[k];
      if (nb < 0 || nb >= N) continue;
      const ni = nb % GRID; if (Math.abs(ni - i) > 1) continue;
      if (visited[nb]) continue;
      visited[nb] = 1;
      filled[nb] = Math.max(gh[nb], filled[c] + 0.02);
      recv[nb] = c;
      heap.push(nb, filled[nb]);
    }
  }

  // moisture (before rivers) drives rainfall
  const moist = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const i = c % GRID, j = (c / GRID) | 0;
    const nx = cx(i) / HALF, nz = cx(j) / HALF;
    moist[c] = clamp(0.5 + 0.75 * fbm(nMoist, nx * 2.1 + 4, nz * 2.1 - 2, 4), 0, 1);
  }
  const acc = new Float32Array(N);
  for (let c = 0; c < N; c++) acc[c] = gh[c] > 0 ? 0.4 + moist[c] + Math.min(gh[c] / 300, 1) : 0;
  for (let k = oc - 1; k >= 0; k--) { const c = order[k]; if (recv[c] >= 0 && gh[c] > 0) acc[recv[c]] += acc[c]; }

  const RIVER_T = 150;
  const river = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (gh[c] > 0 && acc[c] > RIVER_T) river[c] = 1;

  // trace river polylines
  const upCount = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (river[c] && recv[c] >= 0 && river[recv[c]]) upCount[recv[c]]++;
  const jit = (c, o) => nJit((c % GRID) * 0.71 + o, ((c / GRID) | 0) * 0.71 - o) * CELL * 0.42;
  const traced = new Uint8Array(N);
  const rivers = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (!river[c0] || upCount[c0] !== 0) continue;
    const pts = [];
    let c = c0;
    for (let guard = 0; guard < 4000; guard++) {
      const i = c % GRID, j = (c / GRID) | 0;
      pts.push({ x: cx(i) + jit(c, 3.1), z: cx(j) + jit(c, 7.7), a: acc[c], s: Math.max(filled[c], 0) });
      if (gh[c] <= 0 || traced[c]) break;
      traced[c] = 1;
      if (recv[c] < 0) break;
      c = recv[c];
    }
    if (pts.length >= 4) rivers.push(pts);
  }
  // smooth (Chaikin), keep endpoints, enforce downhill surface
  for (let r = 0; r < rivers.length; r++) {
    let pts = rivers[r];
    for (let it = 0; it < 3; it++) {
      const out = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, a: a.a * 0.75 + b.a * 0.25, s: a.s * 0.75 + b.s * 0.25 });
        out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, a: a.a * 0.25 + b.a * 0.75, s: a.s * 0.25 + b.s * 0.75 });
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    for (let k = 1; k < pts.length; k++) pts[k].s = Math.min(pts[k].s, pts[k - 1].s);
    for (const p of pts) { p.w = 2.5 + Math.sqrt(p.a) * 0.32; p.d = 1.2 + Math.sqrt(p.a) * 0.045; }
    rivers[r] = pts;
  }

  // rasterise river carving into the fine grid
  const FN = FINE * FINE;
  const fW = new Float32Array(FN), fT = new Float32Array(FN), fHas = new Uint8Array(FN);
  const fx = (i) => -HALF + (i + 0.5) * FCELL;
  for (const pts of rivers) {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const wmax = Math.max(a.w, b.w);
      const R = wmax * 3 + FCELL * 2.5;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R + HALF) / FCELL));
      const i1 = Math.min(FINE - 1, Math.floor((Math.max(a.x, b.x) + R + HALF) / FCELL));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R + HALF) / FCELL));
      const j1 = Math.min(FINE - 1, Math.floor((Math.max(a.z, b.z) + R + HALF) / FCELL));
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = fx(i), pz = fx(j);
        const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / L2, 0, 1);
        const qx = a.x + dx * t - px, qz = a.z + dz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        const w = lerp(a.w, b.w, t), S = lerp(a.s, b.s, t), dep = lerp(a.d, b.d, t);
        if (d > w * 3 + FCELL * 2.5) continue;
        const W = 1 - smoothstep(w * 1.3, w * 3, d);
        const T = d < w ? S - dep * (1 - (d / w) * (d / w)) : S + Math.min((d - w) * 0.35, 4);
        const c = j * FINE + i;
        if (!fHas[c] || W > fW[c] || (W === fW[c] && T < fT[c])) { fW[c] = W; fT[c] = T; fHas[c] = 1; }
      }
    }
  }

  function sampleFine(arr, x, z) {
    const gx = (x + HALF) / FCELL - 0.5, gz = (z + HALF) / FCELL - 0.5;
    let i = Math.floor(gx), j = Math.floor(gz);
    const tx = gx - i, tz = gz - j;
    if (i < 0) i = 0; if (j < 0) j = 0; if (i > FINE - 2) i = FINE - 2; if (j > FINE - 2) j = FINE - 2;
    const c = j * FINE + i;
    return lerp(lerp(arr[c], arr[c + 1], tx), lerp(arr[c + FINE], arr[c + FINE + 1], tx), tz);
  }
  function riverBlend(x, z) {
    const W = sampleFine(fW, x, z);
    if (W <= 0.0001) return null;
    return [W, sampleFine(fT, x, z)];
  }
  function heightAt(x, z) {
    const h = rawHeight(x, z);
    const rb = riverBlend(x, z);
    return rb ? h + rb[0] * (rb[1] - h) : h;
  }
  // cheap bilinear height from the sim grid (for far objects)
  function gridHeight(x, z) {
    const gx = (x + HALF) / CELL - 0.5, gz = (z + HALF) / CELL - 0.5;
    let i = Math.floor(gx), j = Math.floor(gz);
    const tx = gx - i, tz = gz - j;
    if (i < 0) i = 0; if (j < 0) j = 0; if (i > GRID - 2) i = GRID - 2; if (j > GRID - 2) j = GRID - 2;
    const c = j * GRID + i;
    let h = lerp(lerp(gh[c], gh[c + 1], tx), lerp(gh[c + GRID], gh[c + GRID + 1], tx), tz);
    const rb = riverBlend(x, z);
    return rb ? h + rb[0] * (rb[1] - h) : h;
  }

  // ---------- biomes ----------
  // distance to river (cells) via BFS; also nearest river cell (fresh water source)
  const rdist = new Float32Array(N).fill(1e9), waterSrc = new Int32Array(N).fill(-1);
  for (const pts of rivers) for (const p of pts) {
    const c = cellIndex(p.x, p.z);
    if (c >= 0 && gh[c] > 0) { river[c] = 1; }
  }
  let queue = [];
  for (let c = 0; c < N; c++) if (river[c]) { rdist[c] = 0; waterSrc[c] = c; queue.push(c); }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi], i = c % GRID;
    for (let k = 0; k < 4; k++) {
      const nb = c + NB[k]; if (nb < 0 || nb >= N) continue;
      if (Math.abs((nb % GRID) - i) > 1) continue;
      if (rdist[nb] <= rdist[c] + 1) continue;
      rdist[nb] = rdist[c] + 1; waterSrc[nb] = waterSrc[c]; queue.push(nb);
    }
  }
  queue = null;

  const temp = new Float32Array(N), slope = new Float32Array(N), fert = new Float32Array(N);
  const minerals = new Float32Array(N), forest = new Float32Array(N), bias = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const i = c % GRID, j = (c / GRID) | 0;
    const x = cx(i), z = cx(j), nx = x / HALF, nz = z / HALF, h = gh[c];
    const hx = gh[j * GRID + Math.min(i + 1, GRID - 1)] - gh[j * GRID + Math.max(i - 1, 0)];
    const hz = gh[Math.min(j + 1, GRID - 1) * GRID + i] - gh[Math.max(j - 1, 0) * GRID + i];
    slope[c] = Math.sqrt(hx * hx + hz * hz) / (2 * CELL);
    const lat = (z + HALF) / WORLD_SIZE;             // 0 = far north (cold), 1 = far south (warm)
    temp[c] = -3 + lat * 26 - Math.max(h, 0) * 0.011;
    const riverWet = Math.exp(-rdist[c] / 4) * 0.45;
    moist[c] = clamp(moist[c] + riverWet, 0, 1);
    bias[c] = clamp(0.45 + 1.1 * (fbm(nBias, nx * 1.6 - 2, nz * 1.6 + 5, 2) * 0.5 + 0.5), 0.3, 1.6);
    if (h <= 0.4) { fert[c] = 0; minerals[c] = 0; forest[c] = 0; continue; }
    const tSuit = smoothstep(-1, 9, temp[c]) * (1 - smoothstep(27, 34, temp[c]));
    fert[c] = clamp(moist[c] * 1.15 - 0.12, 0, 1) * tSuit * (1 - smoothstep(0.18, 0.5, slope[c])) *
      (1 - smoothstep(160, 300, h)) * bias[c];
    const rg = ridged(nRidge, nx * 2.7 + 0.5, nz * 2.7 - 1.5, 3);
    minerals[c] = clamp(smoothstep(60, 260, h) * rg * 1.6 + Math.max(0, fbm(nMin, nx * 7, nz * 7, 2) - 0.3) * 2.2, 0, 1.5) *
      (0.6 + 0.6 * (1.6 - bias[c]));
    const fd = fbm(nForest, nx * 9, nz * 9, 3);
    forest[c] = h < 2.5 ? 0 : clamp(smoothstep(0.38, 0.7, moist[c]) * smoothstep(-0.25, 0.25, fd) *
      (1 - smoothstep(380, 520, h)) * (1 - smoothstep(0.35, 0.8, slope[c])) * smoothstep(-6, 2, temp[c]) * (river[c] ? 0.2 : 1), 0, 1);
  }

  function cellIndex(x, z) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return -1;
    return j * GRID + i;
  }
  function isLand(x, z) { const c = cellIndex(x, z); return c >= 0 && gh[c] > 0.6; }

  return {
    seed, size: WORLD_SIZE, half: HALF, grid: GRID, cell: CELL,
    gh, filled, acc, river, rivers, moist, temp, slope, fert, minerals, forest, bias, waterSrc, rdist,
    rawHeight, heightAt, gridHeight, cellIndex, isLand, cellX: cx,
    noise: { fbm, nBias, nMoist },
  };
}
