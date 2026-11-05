// World: loads a scanned location, builds a BVH collision mesh from it, an automatic walkable grid
// (a "nav grid": floor cells with head-room, linked if the step between them is climbable), and a flow field
// toward the survivors so zombies find their way through doorways and around rubble.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from '/vendor/bvh/index.module.js';
import { loader } from '/js/rig.js';

const _tri = new THREE.Triangle(), _seg = new THREE.Line3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _box = new THREE.Box3(), _ray = new THREE.Ray();

export class World {
  constructor(scene) { this.scene = scene; this.root = new THREE.Group(); scene.add(this.root); this.colliders = []; }

  async load(def, onProgress) {
    this.clear(); this.def = def;
    const g = await loader.loadAsync(`/assets/env/${def.file}.glb`, onProgress);
    const m = g.scene; m.scale.setScalar(def.scale || 1); if (def.rot) m.rotation.y = def.rot; if (def.offset) m.position.fromArray(def.offset);
    this.root.add(m);
    // one-sided scans (a single alley wall): mirror the scan across the street to close it in
    if (def.mirrorZ !== undefined) { const c = m.clone(); c.scale.z = -m.scale.z; c.position.z = 2 * def.mirrorZ - m.position.z; c.position.y -= 0.012; this.root.add(c); }
    this.root.updateMatrixWorld(true);
    const geos = [];
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true; o.castShadow = !!def.shadows;
      for (const mt of [].concat(o.material)) { mt.side = THREE.DoubleSide; if (mt.isMeshBasicMaterial && def.lit) o.material = new THREE.MeshStandardMaterial({ map: mt.map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }); }
      if (def.noCollide?.test?.(o.name)) return;
      // meshopt/quantized positions are normalized int16: rebuild as float32 before baking the world transform
      const src = o.geometry.attributes.position, f = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { f[i * 3] = src.getX(i); f[i * 3 + 1] = src.getY(i); f[i * 3 + 2] = src.getZ(i); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
      if (o.geometry.index) geo.setIndex(Array.from(o.geometry.index.array));
      geo.applyMatrix4(o.matrixWorld);
      geos.push(geo.index ? geo : geo.setIndex([...Array(geo.attributes.position.count).keys()]));
    });
    this.envAnim = g.animations.length ? new THREE.AnimationMixer(m) : null;
    if (this.envAnim) for (const c of g.animations) this.envAnim.clipAction(c).play();
    const merged = mergeGeometries(geos, false); geos.forEach((x) => x.dispose());
    this.colGeo = merged; this.bvh = new MeshBVH(merged, { maxLeafTris: 10 });
    this.bounds = def.bounds ? new THREE.Box3(new THREE.Vector3(...def.bounds[0]), new THREE.Vector3(...def.bounds[1])) : new THREE.Box3().setFromObject(m);
    this.buildNav();
    return m;
  }

  clear() { for (const c of [...this.root.children]) { this.root.remove(c); c.traverse((o) => { o.geometry?.dispose?.(); }); } this.colGeo?.dispose(); this.bvh = null; this.colliders.length = 0; }

  // first hit along a ray (bullets, line of sight). Returns {point, normal, distance} or null.
  raycast(origin, dir, max = 200) {
    if (!this.bvh) return null;
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide);
    let best = hit && hit.distance <= max ? { point: hit.point.clone(), normal: hit.face.normal.clone(), distance: hit.distance, obj: null } : null;
    for (const c of this.colliders) { // dynamic props (cars, barrels, doors, crates)
      if (!c.alive || !c.box) continue;
      const p = _ray.intersectBox(c.box, _p1);
      if (p) { const d = p.distanceTo(origin); if (d <= max && (!best || d < best.distance)) best = { point: p.clone(), normal: boxNormal(c.box, p), distance: d, obj: c }; }
    }
    if (best && best.normal.dot(dir) > 0) best.normal.negate();
    return best;
  }
  visible(a, b) { const d = b.clone().sub(a), L = d.length(); const h = this.raycast(a, d.divideScalar(L), L); return !h || h.distance > L - 0.15; }

  // floor height under a point (searches from `fromY` downward)
  floorAt(x, z, fromY, reach = 3) {
    if (!this.bvh) return 0;
    _ray.origin.set(x, fromY, z); _ray.direction.set(0, -1, 0);
    const h = this.bvh.raycastFirst(_ray, THREE.DoubleSide);
    let y = h && h.distance < reach ? h.point.y : -Infinity;
    for (const c of this.colliders) if (c.alive && c.walkable && c.box && x > c.box.min.x && x < c.box.max.x && z > c.box.min.z && z < c.box.max.z && c.box.max.y <= fromY && c.box.max.y > y) y = c.box.max.y;
    return y;
  }

  // capsule (feet at pos, radius r, height h) pushed out of the geometry. Returns true when standing on something.
  collideCapsule(pos, r, h, vel) {
    if (!this.bvh) return false;
    const seg = _seg; seg.start.set(pos.x, pos.y + r, pos.z); seg.end.set(pos.x, pos.y + h - r, pos.z);
    _box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end); _box.min.addScalar(-r); _box.max.addScalar(r);
    let grounded = false;
    for (let pass = 0; pass < 2; pass++) {
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(seg, _p1, _p2);
          if (d < r) {
            const n = _p2.clone().sub(_p1).normalize(), depth = r - d;
            if (n.y < -0.3) { if (vel && vel.y > 0) vel.y = 0; return; }   // ceilings/beams: stop rising, never push down through the floor
            if (n.y > 0.6) { grounded = true; n.set(0, 1, 0); }          // floor-like: stand on slopes and rubble without sliding
            else { n.y = 0; if (n.lengthSq() < 1e-8) return; n.normalize(); }
            seg.start.addScaledVector(n, depth); seg.end.addScaledVector(n, depth);
            if (vel) { const vn = vel.dot(n); if (vn < 0) vel.addScaledVector(n, -vn); }
          }
        },
      });
    }
    // dynamic props are axis-aligned boxes
    for (const c of this.colliders) {
      if (!c.alive || !c.box) continue; const b = c.box;
      if (seg.start.y - r > b.max.y || seg.end.y + r < b.min.y) continue;
      const cx = THREE.MathUtils.clamp(seg.start.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(seg.start.z, b.min.z, b.max.z);
      const dx = seg.start.x - cx, dz = seg.start.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        const top = b.max.y - (seg.start.y - r);
        if (top < 0.45 && c.walkable) { seg.start.y += top; seg.end.y += top; grounded = true; if (vel && vel.y < 0) vel.y = 0; continue; }
        if (d > 1e-4) { seg.start.x += (dx / d) * (r - d); seg.start.z += (dz / d) * (r - d); }
        else { seg.start.x += r; }
        seg.end.x = seg.start.x; seg.end.z = seg.start.z;
      }
    }
    pos.set(seg.start.x, seg.start.y - r, seg.start.z);
    return grounded;
  }

  // ------------------------------------------------------------------ nav grid + flow field
  buildNav() {
    const def = this.def, S = def.cell || 0.6, b = this.bounds;
    const nx = Math.ceil((b.max.x - b.min.x) / S), nz = Math.ceil((b.max.z - b.min.z) / S);
    const H = new Float32Array(nx * nz).fill(NaN);
    const top = b.max.y + 0.5;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = b.min.x + (i + 0.5) * S, z = b.min.z + (k + 0.5) * S;
      // scan down for a floor that has head-room above it (multi-storey safe: take the floor closest to def.floorY)
      let y0 = top, floor = NaN, guard = 0;
      while (guard++ < 6) {
        _ray.origin.set(x, y0, z); _ray.direction.set(0, -1, 0);
        const h = this.bvh.raycastFirst(_ray, THREE.DoubleSide); if (!h) break;
        const fy = h.point.y, ny = Math.abs(h.face.normal.y);
        if (ny > 0.7 && fy < b.max.y) {
          _ray.origin.set(x, fy + 0.05, z); _ray.direction.set(0, 1, 0);
          const up = this.bvh.raycastFirst(_ray, THREE.DoubleSide);
          if (!up || up.distance > 1.75) { if (isNaN(floor) || Math.abs(fy - (def.floorY ?? 0)) < Math.abs(floor - (def.floorY ?? 0))) floor = fy; }
        }
        y0 = fy - 0.05; if (y0 < b.min.y) break;
      }
      // keep cells that aren't hugging a wall
      if (!isNaN(floor)) {
        let clear = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { _ray.origin.set(x, floor + 0.9, z); _ray.direction.set(dx, 0, dz); const w = this.bvh.raycastFirst(_ray, THREE.DoubleSide); if (w && w.distance < S * 0.32) clear = false; }
        if (clear) H[i * nz + k] = floor;
      }
    }
    // scans have holes and speckle: fill a cell that is mostly surrounded by floor
    for (let pass = 0; pass < (def.fill ?? 2); pass++) {
      const H2 = H.slice();
      for (let i = 1; i < nx - 1; i++) for (let k = 1; k < nz - 1; k++) {
        const c = i * nz + k; if (!isNaN(H[c])) continue; let n = 0, sum = 0;
        for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) { const v = H[(i + a) * nz + k + bb]; if ((a || bb) && !isNaN(v)) { n++; sum += v; } }
        const W = (a, bb) => H[(i + a) * nz + k + bb];
        const pair = [[1, 0], [0, 1], [1, 1], [1, -1]].find(([a, bb]) => !isNaN(W(a, bb)) && !isNaN(W(-a, -bb)));
        if (n >= 5) H2[c] = sum / n; else if (pair) H2[c] = (W(pair[0], pair[1]) + W(-pair[0], -pair[1])) / 2;
      }
      H.set(H2);
    }
    this.nav = { S, nx, nz, H, ox: b.min.x, oz: b.min.z, flow: new Int32Array(nx * nz).fill(-1), dist: new Float32Array(nx * nz), step: def.step ?? 0.55 };
    // only keep the region connected to the start
    const s = this.cellOf(new THREE.Vector3(...def.start));
    if (s >= 0 && !def.keepAll) { const seen = new Uint8Array(nx * nz), q = [s]; seen[s] = 1; while (q.length) { const c = q.pop(); for (const n of this.neigh(c)) if (!seen[n]) { seen[n] = 1; q.push(n); } } for (let c = 0; c < H.length; c++) if (!seen[c]) H[c] = NaN; }
  }
  cellOf(p) { const n = this.nav; if (!n) return -1; const i = Math.floor((p.x - n.ox) / n.S), k = Math.floor((p.z - n.oz) / n.S); if (i < 0 || k < 0 || i >= n.nx || k >= n.nz) return -1; const c = i * n.nz + k; if (!isNaN(n.H[c])) return c; // nearest walkable around
    let best = -1, bd = 9; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const ii = i + a, kk = k + b; if (ii < 0 || kk < 0 || ii >= n.nx || kk >= n.nz) continue; const cc = ii * n.nz + kk; if (!isNaN(n.H[cc]) && a * a + b * b < bd) { bd = a * a + b * b; best = cc; } } return best; }
  // floor height from the nav grid at p (filled over scan holes); NaN if not walkable
  navFloor(p) { const n = this.nav; if (!n) return NaN; const i = Math.floor((p.x - n.ox) / n.S), k = Math.floor((p.z - n.oz) / n.S); if (i < 0 || k < 0 || i >= n.nx || k >= n.nz) return NaN; return n.H[i * n.nz + k]; }
  // is p on (or right next to) walkable ground? keeps survivors inside the playable part of a scan
  onNav(p, slack = 1.2) {
    const n = this.nav; if (!n) return true; const r = Math.ceil(slack / n.S), i0 = Math.floor((p.x - n.ox) / n.S), k0 = Math.floor((p.z - n.oz) / n.S);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const i = i0 + a, k = k0 + b; if (i < 0 || k < 0 || i >= n.nx || k >= n.nz) continue; const h = n.H[i * n.nz + k]; if (!isNaN(h) && Math.abs(h - p.y) < 2.2) return true; }
    return false;
  }
  cellPos(c, out = new THREE.Vector3()) { const n = this.nav, i = Math.floor(c / n.nz), k = c % n.nz; return out.set(n.ox + (i + 0.5) * n.S, n.H[c], n.oz + (k + 0.5) * n.S); }
  *neigh(c) {
    const n = this.nav, i = Math.floor(c / n.nz), k = c % n.nz, h = n.H[c];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue; const ii = i + a, kk = k + b; if (ii < 0 || kk < 0 || ii >= n.nx || kk >= n.nz) continue;
      const cc = ii * n.nz + kk; const hh = n.H[cc]; if (isNaN(hh) || Math.abs(hh - h) > n.step) continue;
      if (a && b && (isNaN(n.H[ii * n.nz + k]) || isNaN(n.H[i * n.nz + kk]))) continue; // no corner cutting
      yield cc;
    }
  }
  // Dijkstra-ish BFS from every survivor; each cell then points at its downhill neighbour
  updateFlow(targets) {
    const n = this.nav; if (!n) return; n.dist.fill(1e9); n.flow.fill(-1);
    const q = []; for (const t of targets) { const c = this.cellOf(t); if (c >= 0) { n.dist[c] = 0; q.push(c); } }
    for (let h = 0; h < q.length; h++) { const c = q[h], d = n.dist[c]; for (const nb of this.neigh(c)) { const ii = Math.floor(nb / n.nz) - Math.floor(c / n.nz), kk = (nb % n.nz) - (c % n.nz); const nd = d + (ii && kk ? 1.414 : 1); if (nd < n.dist[nb]) { n.dist[nb] = nd; n.flow[nb] = c; q.push(nb); } } }
  }
  // where should something at p walk next?
  steer(p, out) { const c = this.cellOf(p); if (c < 0) return null; let nx = this.nav.flow[c]; if (nx < 0) return null; const nn = this.nav.flow[nx]; if (nn >= 0) nx = nn; return this.cellPos(nx, out); }
  randomCell(near, minD, maxD) {
    const n = this.nav; for (let tries = 0; tries < 200; tries++) {
      const c = Math.floor(Math.random() * n.H.length); if (isNaN(n.H[c])) continue; const p = this.cellPos(c);
      const d = near ? p.distanceTo(near) : minD; if (d >= minD && d <= maxD) return p;
    } return null;
  }
}

function boxNormal(b, p) {
  const c = b.getCenter(_p2), s = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const dx = (p.x - c.x) / s.x, dy = (p.y - c.y) / s.y, dz = (p.z - c.z) / s.z, ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  return ax > ay && ax > az ? new THREE.Vector3(Math.sign(dx), 0, 0) : ay > az ? new THREE.Vector3(0, Math.sign(dy), 0) : new THREE.Vector3(0, 0, Math.sign(dz));
}
