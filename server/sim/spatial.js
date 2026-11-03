// Uniform spatial hash for fast neighbour queries (combat, courting, disease).
export class SpatialHash {
  constructor(worldSize, cell = 32) {
    this.cell = cell; this.half = worldSize / 2;
    this.n = Math.ceil(worldSize / cell);
    this.heads = new Int32Array(this.n * this.n);
    this.next = new Int32Array(1024);
    this.items = [];
  }
  key(x, z) {
    let i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    if (i < 0) i = 0; if (j < 0) j = 0; if (i >= this.n) i = this.n - 1; if (j >= this.n) j = this.n - 1;
    return j * this.n + i;
  }
  rebuild(items) {
    this.heads.fill(-1);
    if (this.next.length < items.length) this.next = new Int32Array(items.length * 2);
    this.items = items;
    for (let k = 0; k < items.length; k++) {
      const it = items[k]; if (!it.alive) continue;
      const h = this.key(it.x, it.z);
      this.next[k] = this.heads[h]; this.heads[h] = k;
    }
  }
  query(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((x - r + this.half) / c)), i1 = Math.min(this.n - 1, Math.floor((x + r + this.half) / c));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / c)), j1 = Math.min(this.n - 1, Math.floor((z + r + this.half) / c));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let k = this.heads[j * this.n + i]; k !== -1; k = this.next[k]) {
        const it = this.items[k];
        const dx = it.x - x, dz = it.z - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2 && it.alive) { if (fn(it, d2) === false) return; }
      }
    }
  }
}
