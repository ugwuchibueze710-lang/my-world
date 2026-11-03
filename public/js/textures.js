// Procedurally generated textures (no external image files needed).
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Tileable water normal map from a sum of integer-frequency waves.
export function waterNormals(size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const waves = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rnd() - 0.5) * 20), kz = Math.round((rnd() - 0.5) * 20);
    if (!kx && !kz) continue;
    waves.push({ kx, kz, a: 1 / Math.hypot(kx, kz) ** 1.15, p: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dz = 0;
    for (const w of waves) {
      const ph = ((w.kx * x + w.kz * y) / size) * Math.PI * 2 + w.p;
      const c2 = Math.cos(ph) * w.a;
      dx += c2 * w.kx; dz += c2 * w.kz;
    }
    const nx = -dx * 0.06, nz = -dz * 0.06, ny = 1;
    const L = Math.hypot(nx, ny, nz);
    const o = (y * size + x) * 4;
    img.data[o] = ((nx / L) * 0.5 + 0.5) * 255; img.data[o + 1] = ((nz / L) * 0.5 + 0.5) * 255; img.data[o + 2] = ((ny / L) * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Soft cumulus puff
export function cloudTexture(size = 128) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const r = size * (0.12 + rnd() * 0.18);
    const x = size / 2 + (rnd() - 0.5) * size * 0.45, y = size / 2 + (rnd() - 0.5) * size * 0.32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softDot(size = 64, inner = 'rgba(255,255,255,1)') {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Hurricane spiral seen from above
export function spiralTexture(size = 512) {
  const c = canvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2);
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    let v = 0;
    if (r < 1) {
      const arm = Math.sin(a * 3 + Math.log(r + 0.02) * 7) * 0.5 + 0.5;
      const fine = Math.sin(a * 11 + Math.log(r + 0.02) * 19) * 0.5 + 0.5;
      const eye = r < 0.07 ? 0 : Math.min(1, (r - 0.07) / 0.05);
      v = (0.55 * arm + 0.25 * fine + 0.35) * eye * Math.pow(1 - r, 0.6);
    }
    const o = (y * size + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 235; img.data[o + 3] = Math.min(255, v * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stone blocks for castles
export function stoneTexture(size = 256, base = [138, 132, 120]) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base.join(',')})`; ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rows = 8, bh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -bh * 0.7 : 0;
    while (x < size) {
      const w = bh * (1.2 + rnd() * 1.2), v = (rnd() - 0.5) * 34;
      ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v * 0.9})`;
      ctx.fillRect(x + 1.5, r * bh + 1.5, w - 3, bh - 3);
      x += w;
    }
  }
  for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; ctx.fillRect(rnd() * size, rnd() * size, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function plasterTexture(size = 128) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8ddc6'; ctx.fillRect(0, 0, size, size);
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(90,70,40,${rnd() * 0.08})`; ctx.fillRect(rnd() * size, rnd() * size, 3, 3); }
  // timber frame
  ctx.fillStyle = '#4a3322';
  ctx.fillRect(0, 0, size, 8); ctx.fillRect(0, size - 10, size, 10); ctx.fillRect(0, 0, 8, size); ctx.fillRect(size - 8, 0, 8, size);
  ctx.fillRect(size / 2 - 4, 0, 8, size);
  ctx.save(); ctx.translate(size / 4, size / 2); ctx.rotate(0.9); ctx.fillRect(-40, -3, 80, 6); ctx.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function roofTexture(size = 128) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#6b3426'; ctx.fillRect(0, 0, size, size);
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < 12; r++) for (let x = 0; x < 10; x++) {
    const v = (rnd() - 0.5) * 30;
    ctx.fillStyle = `rgb(${107 + v},${52 + v * 0.6},${38 + v * 0.4})`;
    ctx.fillRect(x * 13 + (r % 2) * 6, r * 11, 12, 10);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
