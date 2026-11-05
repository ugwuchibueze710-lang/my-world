// Reactive set dressing: explosive barrels, breakable crates, the scanned burnt-out car (alarm + fuel-tank
// explosion), shootable/flickering lights. Every prop is solid (box collider) and reacts to bullets.
import * as THREE from 'three';
import { loader } from '/js/rig.js';

const rand = (a, b) => a + Math.random() * (b - a);
function canvasTex(w, h, paint) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const barrelTex = canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#7a1a12'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,20,10' : '160,90,60'},${Math.random() * 0.25})`; x.fillRect(Math.random() * w, Math.random() * h, rand(1, 6), rand(1, 4)); }
  x.fillStyle = 'rgba(30,15,8,0.7)'; for (const y of [40, 128, 216]) x.fillRect(0, y - 5, w, 10);
  x.fillStyle = '#e8c21a'; x.fillRect(70, 80, 116, 34); x.fillStyle = '#111'; x.font = 'bold 22px Arial'; x.fillText('FLAMMABLE', 72, 104);
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(90,50,20,${Math.random() * 0.5})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, rand(3, 18), 0, 7); x.fill(); }
});
const woodTex = canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#7b5b39'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#6c4f31' : '#86653f'; x.fillRect(0, i * (h / 6), w, h / 6 - 3); }
  for (let i = 0; i < 260; i++) { x.strokeStyle = `rgba(40,25,10,${Math.random() * 0.35})`; x.beginPath(); const y = Math.random() * h; x.moveTo(0, y); x.bezierCurveTo(w / 3, y + rand(-4, 4), (2 * w) / 3, y + rand(-4, 4), w, y + rand(-3, 3)); x.stroke(); }
  x.strokeStyle = '#3a2814'; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10); x.beginPath(); x.moveTo(5, 5); x.lineTo(w - 5, h - 5); x.stroke();
});

export class Props {
  constructor(ctx) { this.ctx = ctx; this.list = []; this.group = new THREE.Group(); ctx.scene.add(this.group); this.seq = 1; }
  clear() { this.group.clear(); this.list.length = 0; this.ctx.world.colliders.length = 0; }
  async build(def) {
    this.clear();
    for (const p of def.props || []) await this.add(p.kind, new THREE.Vector3(...p.at), p);
  }
  async add(kind, at, opt = {}) {
    const W = this.ctx.world, fy = W.floorAt(at.x, at.z, at.y + 2, 6); if (isFinite(fy)) at.y = fy;
    const p = { id: this.seq++, kind, alive: true, hp: 0, pos: at.clone(), obj: new THREE.Group() };
    p.obj.position.copy(at); this.group.add(p.obj);
    if (kind === 'barrel') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 24), new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.55, metalness: 0.6 }));
      m.position.y = 0.44; m.castShadow = true; p.obj.add(m); p.hp = 25;
      p.box = new THREE.Box3(new THREE.Vector3(at.x - 0.3, at.y, at.z - 0.3), new THREE.Vector3(at.x + 0.3, at.y + 0.88, at.z + 0.3));
    } else if (kind === 'crate') {
      const s = opt.size || 0.9, m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }));
      m.position.y = s / 2; m.rotation.y = Math.random(); m.castShadow = true; p.obj.add(m); p.hp = 45; p.walkable = true;
      p.box = new THREE.Box3(new THREE.Vector3(at.x - s * 0.55, at.y, at.z - s * 0.55), new THREE.Vector3(at.x + s * 0.55, at.y + s, at.z + s * 0.55));
    } else if (kind === 'car' || kind === 'wreck') {
      const g = await loader.loadAsync('/assets/env/car_wreck.glb'); const car = g.scene;
      // the scan includes some ground; drop it so the car sits on our floor
      const b = new THREE.Box3().setFromObject(car); const k = 4.6 / Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      car.scale.setScalar(k); car.position.set(-(b.min.x + b.max.x) / 2 * k, -b.min.y * k - 0.05, -(b.min.z + b.max.z) / 2 * k); car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const spin = new THREE.Group(); spin.rotation.y = opt.rot ?? Math.random() * Math.PI; spin.add(car); p.obj.add(spin);
      p.hp = kind === 'car' ? 160 : 220; p.alarm = kind === 'car'; p.walkable = false;
      const bb = new THREE.Box3().setFromObject(p.obj); bb.min.y = at.y; bb.max.y = Math.min(bb.max.y, at.y + 1.45); bb.expandByScalar(-0.25); p.box = bb;
      // hazard lights for the alarm
      p.lights = [new THREE.PointLight(0xffa020, 0, 7, 2), new THREE.PointLight(0xffa020, 0, 7, 2)]; p.lights.forEach((l, i) => { l.position.set((i ? 1 : -1) * 1.2, 0.8, 0); spin.add(l); });
    } else if (kind === 'light') {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
      shade.position.y = 0.09; const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1.2), new THREE.MeshBasicMaterial({ color: 0x111111 })); cord.position.y = 0.75;
      p.obj.position.y = opt.at[1]; p.pos.y = opt.at[1];
      const L = new THREE.PointLight(0xffd9a0, 14, 14, 1.8); L.castShadow = false;
      p.obj.add(bulb, shade, cord, L); p.light = L; p.bulb = bulb; p.hp = 1; p.flicker = !!opt.flicker; p.base = 14; p.hitR = 0.18;
    }
    if (p.box) { p.box.walkable = p.walkable; W.colliders.push(Object.assign(p, { alive: true })); }
    this.list.push(p); return p;
  }
  // bullet ray vs props (lights are small spheres; the rest are their boxes)
  raycast(origin, dir, max) {
    let best = null; const ray = new THREE.Ray(origin, dir), hp = new THREE.Vector3();
    for (const p of this.list) {
      if (!p.alive) continue;
      if (p.kind === 'light') { const c = p.obj.getWorldPosition(new THREE.Vector3()); if (ray.distanceSqToPoint(c) < p.hitR * p.hitR) { const d = c.distanceTo(origin); if (d < max && (!best || d < best.dist)) best = { p, dist: d, point: c }; } continue; }
      if (p.box && ray.intersectBox(p.box, hp)) { const d = hp.distanceTo(origin); if (d < max && (!best || d < best.dist)) best = { p, dist: d, point: hp.clone() }; }
    }
    return best;
  }
  hit(p, dmg, point, dir, remote) {
    if (!p.alive) return;
    const fx = this.ctx.fx, sfx = this.ctx.sfx;
    if (p.kind === 'light') { p.alive = false; p.light.intensity = 0; p.bulb.material.color.set(0x222222); fx.sparks(point, new THREE.Vector3(0, -1, 0), 40, 4); sfx.glass(point); if (!remote) this.ctx.net?.send('fx', { k: 'prop', id: p.id, dmg }); return; }
    p.hp -= dmg; fx.sparks(point, dir.clone().negate(), 8, 3);
    if (p.alarm && !p.alarmT) { p.alarmT = 14; sfx.alarm(p.pos, 14); this.ctx.onAlarm?.(p.pos); }
    if (p.kind === 'crate') fx.splinters(point, dir, 6);
    if (p.kind === 'barrel' && p.hp > 0 && p.hp < 18 && !p.leak) { p.leak = 2.2; } // punctured: it burns, then goes up
    if (p.hp <= 0) this.destroy(p, dir);
    if (!remote) this.ctx.net?.send('fx', { k: 'prop', id: p.id, dmg });
  }
  destroy(p, dir) {
    if (!p.alive) return; p.alive = false;
    const fx = this.ctx.fx, c = p.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
    if (p.kind === 'barrel' || p.kind === 'car' || p.kind === 'wreck') {
      const big = p.kind !== 'barrel';
      this.ctx.explode(c, big ? 7 : 5, big ? 260 : 160);
      if (p.kind === 'barrel') { this.group.remove(p.obj); fx.scorch(p.pos, 1.8); }
      else { p.obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); } }); p.burn = 25; fx.scorch(p.pos, 3.5); p.alive = false; p.lights?.forEach((l) => (l.intensity = 0)); }
      if (p.kind === 'barrel') p.box = null;
    } else if (p.kind === 'crate') { fx.splinters(c, dir || new THREE.Vector3(0, 1, 0), 40); this.ctx.sfx.wood(c); this.group.remove(p.obj); p.box = null; }
  }
  update(dt, t) {
    for (const p of this.list) {
      if (p.kind === 'light' && p.alive && p.flicker) { const f = Math.sin(t * 17 + p.id) * Math.sin(t * 3.1 + p.id * 2); p.light.intensity = f > 0.85 ? 0 : p.base * (0.75 + 0.25 * Math.random()); p.bulb.visible = p.light.intensity > 0; }
      if (p.alarmT > 0) { p.alarmT -= dt; const on = Math.floor(t * 2.5) % 2 === 0 && p.alarmT > 0; p.lights?.forEach((l) => (l.intensity = on ? 10 : 0)); }
      if (p.leak > 0) { p.leak -= dt; this.ctx.fx.fire(p.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), 2); if (p.leak <= 0) this.destroy(p, new THREE.Vector3(0, 1, 0)); }
      if (p.burn > 0) { p.burn -= dt; if (Math.random() < dt * 20) this.ctx.fx.fire(p.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0.8, rand(-1, 1))), 3); }
    }
  }
  byId(id) { return this.list.find((p) => p.id === id); }
}
