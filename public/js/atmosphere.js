// Atmosphere: real sky (physical scattering) for outdoor chapters, dark smoky depth for indoor ones,
// an endless ground that continues past the edge of every scan, distant ruined-city silhouettes,
// and image-based lighting generated from the sky so the scans and characters are lit by it.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene; this.group = new THREE.Group(); scene.add(this.group);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky = new Sky(); this.sky.scale.setScalar(4500); this.sky.material.depthWrite = false;
    this.sun = new THREE.Vector3();
  }

  apply(def, bounds, minFloor) {
    const s = this.scene, g = this.group; g.clear();
    const outdoor = !def.dark;
    const fogCol = new THREE.Color(def.fog[0]);
    s.fog = new THREE.FogExp2(fogCol, def.fog[1]);
    // the sky
    if (outdoor) {
      const u = this.sky.material.uniforms;
      u.turbidity.value = def.turbidity ?? 9; u.rayleigh.value = def.rayleigh ?? 2.2; u.mieCoefficient.value = 0.008; u.mieDirectionalG.value = 0.86;
      const elev = def.sunElevation ?? 14, az = def.sunAzimuth ?? 200;   // low sun = long shadows, ruined-city mood
      this.sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
      u.sunPosition.value.copy(this.sun);
      g.add(this.sky);
      // light the world from the sky itself
      const tmp = new THREE.Scene(); tmp.add(this.sky.clone());
      this.env?.dispose(); this.env = this.pmrem.fromScene(tmp, 0.04).texture;
      s.environment = this.env; s.background = null;
      // horizon haze matches the fog so scan edges melt into distance
      s.fog.color.copy(new THREE.Color(def.fog[0]));
    } else {
      // indoors: no sky, a black-brown void swallowed by fog, faint cold bounce light
      s.background = fogCol.clone().multiplyScalar(0.6);
      const tmp = new THREE.Scene(); tmp.background = new THREE.Color(def.hemi[0]).multiplyScalar(0.25);
      this.env?.dispose(); this.env = this.pmrem.fromScene(tmp).texture; s.environment = this.env;
    }
    s.environmentIntensity = outdoor ? 0.55 : 0.25;
    // endless ground under and around the scan (no floating island)
    const b = bounds, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const groundY = Math.min(outdoor ? (minFloor ?? def.floorY ?? 0) - 0.35 : b.min.y - 0.5, (minFloor ?? 0) - 0.35);
    const tex = groundTexture(outdoor);
    tex.repeat.set(300, 300);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: tex, color: outdoor ? 0x8b8478 : 0x2a2622, roughness: 0.97 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, groundY, cz); ground.receiveShadow = true; g.add(ground);
    // distant ruined skyline for outdoor chapters
    if (outdoor) g.add(skyline(cx, cz, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 90, groundY, fogCol));
    // dust motes hanging in the air
    g.add(this.motes = motes(b, outdoor));
    return { outdoor, sunDir: this.sun.clone() };
  }
  update(dt, t) { if (this.motes) { this.motes.rotation.y = t * 0.01; this.motes.position.y = Math.sin(t * 0.2) * 0.2; } }
}

function groundTexture(outdoor) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = outdoor ? '#7d776c' : '#2b2724'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const v = Math.random(); x.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '255,250,240'},${Math.random() * 0.09})`; const r = Math.random() * 4 + 0.5; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, r, 0, 7); x.fill(); }
  for (let i = 0; i < 18; i++) { x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = Math.random() * 1.5; x.beginPath(); let px = Math.random() * S, py = Math.random() * S; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (Math.random() - 0.5) * 40; py += (Math.random() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function skyline(cx, cz, R, y0, fogCol) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 1, fog: true });
  const win = new THREE.MeshBasicMaterial({ color: 0x0c0c0e, fog: true });
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + Math.random() * 0.05, r = R + Math.random() * 160, h = 10 + Math.random() * 55 * (Math.random() < 0.15 ? 2 : 1), w = 8 + Math.random() * 18;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat); m.position.set(cx + Math.cos(a) * r, y0 + h / 2, cz + Math.sin(a) * r); m.rotation.y = Math.random();
    // broken tops: a few buildings are snapped off at an angle
    if (Math.random() < 0.3) { m.rotation.z = (Math.random() - 0.5) * 0.15; m.scale.y = 0.7; }
    grp.add(m);
    for (let k = 0; k < 4; k++) { const wm = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.6), win); wm.position.set(0, -h / 2 + 4 + k * (h / 5), w / 2 + 0.05); m.add(wm); }
  }
  // columns of smoke from fires across the city
  const smokeMat = new THREE.MeshBasicMaterial({ color: fogCol.clone().multiplyScalar(0.55), transparent: true, opacity: 0.35, depthWrite: false, fog: true });
  for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, r = R + 60 + Math.random() * 200; const col = new THREE.Mesh(new THREE.CylinderGeometry(14, 4, 160, 10, 1, true), smokeMat); col.position.set(cx + Math.cos(a) * r, y0 + 80, cz + Math.sin(a) * r); col.rotation.z = 0.12; grp.add(col); }
  return grp;
}

function motes(b, outdoor) {
  const N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = b.min.x + Math.random() * (b.max.x - b.min.x); pos[i * 3 + 1] = b.min.y + Math.random() * Math.min(8, b.max.y - b.min.y); pos[i * 3 + 2] = b.min.z + Math.random() * (b.max.z - b.min.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: outdoor ? 0xfff4e0 : 0xcfc6b8, size: 0.025, transparent: true, opacity: outdoor ? 0.35 : 0.5, depthWrite: false }));
}
