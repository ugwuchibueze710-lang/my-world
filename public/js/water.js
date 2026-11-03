// Ocean (planar reflections) and flowing rivers.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormals } from './textures.js';

export class Waters {
  constructor(scene, world, sunDir) {
    this.normals = waterNormals(256);
    const geo = new THREE.PlaneGeometry(60000, 60000);
    this.ocean = new Water(geo, {
      textureWidth: 1024, textureHeight: 1024, waterNormals: this.normals, sunDirection: sunDir.clone(),
      sunColor: 0xfff4e0, waterColor: 0x0b2e3f, distortionScale: 3.2, fog: true, alpha: 0.96,
    });
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = 0.05;
    this.ocean.material.uniforms.size.value = 4.5;
    this.ocean.receiveShadow = false;
    scene.add(this.ocean);

    // rivers as ribbon meshes that follow the carved valleys
    const rn = this.normals.clone(); rn.wrapS = rn.wrapT = THREE.RepeatWrapping; rn.needsUpdate = true;
    this.riverNormals = rn;
    this.riverMat = new THREE.MeshStandardMaterial({
      color: 0x24525a, roughness: 0.06, metalness: 0.15, normalMap: rn, normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true, opacity: 0.9, envMapIntensity: 1.2, side: THREE.DoubleSide,
    });
    const pos = [], uv = [], idx = [];
    let base = 0;
    for (const pts of world.rivers) {
      let along = 0;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[Math.min(k + 1, pts.length - 1)], r0 = pts[Math.max(k - 1, 0)];
        let dx = q.x - r0.x, dz = q.z - r0.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const w = p.w * 1.05;
        const y = p.s + 0.12;
        pos.push(p.x - dz * w, y, p.z + dx * w, p.x + dz * w, y, p.z - dx * w);
        if (k > 0) along += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
        uv.push(0, along / 18, w / 9, along / 18);
        if (k < pts.length - 1) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      base += pts.length * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    this.rivers = new THREE.Mesh(g, this.riverMat);
    this.rivers.renderOrder = 1;
    this.rivers.receiveShadow = true;
    scene.add(this.rivers);
  }

  update(dt, sunDir, sunColor, flood) {
    const u = this.ocean.material.uniforms;
    u.time.value += dt * 0.6;
    u.sunDirection.value.copy(sunDir);
    u.sunColor.value.copy(sunColor);
    this.riverNormals.offset.y -= dt * 0.45;
    this.riverMat.color.setRGB(0.14 + flood * 0.25, 0.32 + flood * 0.08, 0.35 - flood * 0.15);
  }
}
