// Visual weather: clouds, storm cells, hurricanes, tornadoes, rain, snow, lightning, wildfire, plague haze.
import * as THREE from 'three';
import { cloudTexture, softDot, spiralTexture } from './textures.js';

class Billboards {
  constructor(scene, max, tex, additive = false) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.off = new Float32Array(max * 3); this.sr = new Float32Array(max * 2); this.col = new Float32Array(max * 4);
    g.setAttribute('iOff', new THREE.InstancedBufferAttribute(this.off, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSR', new THREE.InstancedBufferAttribute(this.sr, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `attribute vec3 iOff; attribute vec2 iSR; attribute vec4 iCol; varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){ vec4 mv = modelViewMatrix * vec4(iOff, 1.0); float c = cos(iSR.y), s = sin(iSR.y);
          mv.xy += mat2(c, -s, s, c) * position.xy * iSR.x; vDepth = -mv.z; vUv = uv; vCol = iCol; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity; varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){ vec4 t = texture2D(map, vUv); float f = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.35);
          gl_FragColor = vec4(mix(vCol.rgb, fogColor, ${additive ? '0.0' : 'f'}), t.a * vCol.a * ${additive ? '(1.0 - f)' : '1.0'}); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 4 : 3;
    scene.add(this.mesh);
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, s, rot, r, g, b, a) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.off[i * 3] = x; this.off[i * 3 + 1] = y; this.off[i * 3 + 2] = z;
    this.sr[i * 2] = s; this.sr[i * 2 + 1] = rot;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
  }
  end(fog) {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    g.attributes.iOff.needsUpdate = g.attributes.iSR.needsUpdate = g.attributes.iCol.needsUpdate = true;
    this.mat.uniforms.fogColor.value.copy(fog.color); this.mat.uniforms.fogDensity.value = fog.density;
  }
}

const hsh = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class WeatherFX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.clouds = new Billboards(scene, 3500, cloudTexture(128));
    this.fire = new Billboards(scene, 900, softDot(64), true);
    this.storms = []; this.stormT = 0;
    // background cloud field
    this.bg = [];
    for (let c = 0; c < 70; c++) {
      const cx = (hsh(c) - 0.5) * 11000, cz = (hsh(c + 50) - 0.5) * 11000, cy = 950 + hsh(c + 99) * 450;
      const n = 5 + Math.floor(hsh(c + 7) * 7);
      for (let k = 0; k < n; k++) this.bg.push({ x: cx + (hsh(c * 13 + k) - 0.5) * 420, y: cy + (hsh(c * 7 + k) - 0.5) * 90, z: cz + (hsh(c * 3 + k) - 0.5) * 260, s: 240 + hsh(c + k * 9) * 260, r: hsh(k + c) * 6 });
    }
    this.drift = new THREE.Vector2();

    // rain
    const RN = 9000, rp = new Float32Array(RN * 6), rt = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) { const x = (Math.random() - 0.5) * 320, y = Math.random() * 220, z = (Math.random() - 0.5) * 320; rp.set([x, y, z, x, y, z], i * 6); rt[i * 2 + 1] = 1; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aT', new THREE.BufferAttribute(rt, 1));
    this.rainU = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uI: { value: 0 }, uLight: { value: 1 } };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; attribute float aT; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime * 38.0, 220.0) + aT * 2.6;
          p.xz += uWind * (p.y / 220.0) * 18.0 - uWind * aT * 0.6;
          vec3 wp = uCenter + vec3(p.x, p.y - 30.0, p.z); vA = 1.0 - smoothstep(120.0, 160.0, length(p.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uI; uniform float uLight; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.62, 0.68, 0.76) * (0.4 + 0.6 * uLight), 0.38 * uI * vA); }`,
    }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);

    // snow
    const SN = 9000, sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) sp.set([(Math.random() - 0.5) * 300, Math.random() * 160, (Math.random() - 0.5) * 300], i * 3);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowU = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uI: { value: 0 }, uMap: { value: softDot(32) }, uLight: { value: 1 } };
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.snowU, transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime * 3.2, 160.0);
          p.x += sin(uTime * 0.8 + position.z) * 2.0 + uWind.x * mod(uTime * 6.0 + position.y, 160.0) * 0.5;
          p.z += cos(uTime * 0.7 + position.x) * 2.0 + uWind.y * mod(uTime * 6.0 + position.y, 160.0) * 0.5;
          p.xz = mod(p.xz + 150.0, 300.0) - 150.0;
          vec4 mv = viewMatrix * vec4(uCenter + vec3(p.x, p.y - 20.0, p.z), 1.0);
          vA = 1.0 - smoothstep(110.0, 150.0, length(p.xz));
          gl_PointSize = clamp(220.0 / -mv.z, 1.0, 9.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uI; uniform float uLight; varying float vA;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vec3(0.95) * (0.35 + 0.65 * uLight), a * uI * vA * 0.9); }`,
    }));
    this.snow.frustumCulled = false; this.snow.visible = false; scene.add(this.snow);

    // hurricanes & tornadoes
    this.spiralTex = spiralTexture(512);
    this.hurricanes = new Map(); this.tornadoes = new Map();
    this.funnelMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLight: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uLight; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){ float s = n(vec2(vUv.x * 14.0 + uTime * 3.0 + vUv.y * 6.0, vUv.y * 9.0 - uTime * 1.5));
          float a = (0.45 + 0.4 * s) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(0.35, 0.33, 0.31) * (0.5 + 0.5 * s) * (0.4 + 0.6 * uLight), a); }`,
    });
    const prof = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push(new THREE.Vector2(6 + Math.pow(t, 2.2) * 110, t * 650)); }
    this.funnelGeo = new THREE.LatheGeometry(prof, 32);

    // lightning
    this.bolts = [];
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 1, fog: false });
    this.flash = 0;
  }

  setStorms(storms) { this.storms = storms; this.stormT = performance.now(); }

  strike(x, z, focus) {
    const pts = [];
    let px = x, pz = z;
    const top = 900 + Math.random() * 200;
    const ground = this.world.gridHeight(x, z);
    for (let y = top; y > ground; y -= 30 + Math.random() * 40) {
      pts.push(new THREE.Vector3(px, y, pz)); px += (Math.random() - 0.5) * 50; pz += (Math.random() - 0.5) * 50;
    }
    pts.push(new THREE.Vector3(x, ground, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone());
    line.frustumCulled = false; line.userData.life = 0.28;
    this.scene.add(line); this.bolts.push(line);
    const d = Math.hypot(x - focus.x, z - focus.z);
    if (d < 2500) this.flash = Math.max(this.flash, 0.55 * (1 - d / 2500) + 0.1);
  }

  // intensity of each precipitation type at a point
  sample(x, z) {
    const out = { rain: 0, snow: 0, cloud: 0, fog: 0, flood: 0, wind: 0 };
    const dt = (performance.now() - this.stormT) / 1000;
    for (const s of this.storms) {
      const sx = s.x + s.vx * dt, sz = s.z + s.vz * dt;
      const d = Math.hypot(x - sx, z - sz);
      if (d > s.r * 1.2) continue;
      const k = Math.min(1, (1 - d / (s.r * 1.2)) * 1.6) * s.i;
      switch (s.type) {
        case 'rain': out.rain = Math.max(out.rain, k * 0.8); out.cloud = Math.max(out.cloud, k * 0.7); out.fog = Math.max(out.fog, k * 0.00008); break;
        case 'thunderstorm': out.rain = Math.max(out.rain, k); out.cloud = Math.max(out.cloud, k * 0.95); out.fog = Math.max(out.fog, k * 0.0001); break;
        case 'hurricane': out.rain = Math.max(out.rain, k); out.cloud = Math.max(out.cloud, k); out.fog = Math.max(out.fog, k * 0.00018); out.wind = Math.max(out.wind, k); break;
        case 'snow': out.snow = Math.max(out.snow, k * 0.7); out.cloud = Math.max(out.cloud, k * 0.6); out.fog = Math.max(out.fog, k * 0.00008); break;
        case 'blizzard': out.snow = Math.max(out.snow, k); out.cloud = Math.max(out.cloud, k); out.fog = Math.max(out.fog, k * 0.00035); out.wind = Math.max(out.wind, k); break;
        case 'flood': out.flood = Math.max(out.flood, k); break;
        case 'windstorm': out.wind = Math.max(out.wind, k); out.fog = Math.max(out.fog, k * 0.00005); break;
      }
    }
    // snowfall instead of rain in freezing air
    return out;
  }

  update(dt, time, camera, focus, wind, light, sunColor, fog, kingdoms) {
    const cp = camera.position;
    this.drift.x += wind.x * dt * 4; this.drift.y += wind.z * dt * 4;
    const sdt = (performance.now() - this.stormT) / 1000;
    const cl = this.clouds, fi = this.fire;
    cl.begin(); fi.begin();
    const lit = new THREE.Color().copy(sunColor).multiplyScalar(0.45 + 0.6 * light).addScalar(0.06 + 0.06 * (1 - light));
    // background clouds (wrap around the camera)
    const W = 11000;
    for (const p of this.bg) {
      let x = p.x + this.drift.x, z = p.z + this.drift.y;
      x = ((x - cp.x + W / 2) % W + W) % W - W / 2 + cp.x; z = ((z - cp.z + W / 2) % W + W) % W - W / 2 + cp.z;
      cl.add(x, p.y, z, p.s, p.r, lit.r, lit.g, lit.b, 0.55);
    }
    // storm cells
    for (const s of this.storms) {
      const sx = s.x + s.vx * sdt, sz = s.z + s.vz * sdt, id = s.id;
      let n = 0, dark = 0.6, h0 = 750, spread = s.r, size = 300, alpha = 0.75;
      switch (s.type) {
        case 'rain': n = 34; dark = 0.62; break;
        case 'thunderstorm': n = 46; dark = 0.38; h0 = 650; size = 340; break;
        case 'snow': n = 30; dark = 0.8; break;
        case 'blizzard': n = 50; dark = 0.72; h0 = 500; size = 320; break;
        case 'hurricane': n = 0; break;
        case 'windstorm': n = 16; dark = 0.75; h0 = 800; alpha = 0.4; break;
        case 'heatwave': case 'drought': n = 0; break;
        case 'wildfire': n = 0; break;
        case 'flood': n = 12; dark = 0.55; break;
        case 'plague': n = 0; break;
        case 'tornado': n = 18; dark = 0.35; spread = 260; h0 = 650; break;
      }
      for (let k = 0; k < n; k++) {
        const a = hsh(id * 31 + k) * 6.283, d = Math.sqrt(hsh(id * 17 + k)) * spread * 0.85;
        const stack = s.type === 'thunderstorm' && k % 3 === 0 ? hsh(k + id) * 500 : 0;
        const c = dark * (0.55 + 0.45 * light);
        cl.add(sx + Math.cos(a) * d, h0 + hsh(id + k * 3) * 120 + stack, sz + Math.sin(a) * d, size * (0.7 + hsh(k * 5 + id) * 0.8) * (0.6 + 0.4 * s.i), hsh(k) * 6,
          c * sunColor.r, c * sunColor.g, c * sunColor.b, alpha * Math.min(1, s.i * 1.5));
      }
      if (s.type === 'wildfire') {
        const fl = Math.floor(14 + s.r / 6);
        for (let k = 0; k < fl; k++) {
          const a = hsh(id * 11 + k) * 6.283, d = Math.sqrt(hsh(id * 29 + k)) * s.r;
          const x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d, y = this.world.gridHeight(x, z);
          const flick = 0.6 + 0.4 * Math.sin(time * (7 + k % 5) + k);
          fi.add(x, y + 4 + flick * 3, z, (10 + hsh(k) * 16) * flick, 0, 1.0, 0.45 + 0.2 * flick, 0.12, 0.85 * s.i);
          if (k % 2 === 0) { const rise = (time * 18 + k * 37) % 260; cl.add(x + wind.x * rise * 0.6, y + 20 + rise, z + wind.z * rise * 0.6, 40 + rise * 0.5, k, 0.16, 0.15, 0.14, 0.55 * (1 - rise / 260) * s.i); }
        }
      }
      if (s.type === 'plague') {
        for (let k = 0; k < 14; k++) {
          const a = hsh(id * 7 + k) * 6.283 + time * 0.03, d = Math.sqrt(hsh(id * 5 + k)) * s.r * 0.8;
          const x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
          cl.add(x, this.world.gridHeight(x, z) + 25, z, 110, k, 0.45, 0.55, 0.25, 0.22 * s.i);
        }
      }
      if (s.type === 'tornado') {
        for (let k = 0; k < 40; k++) {
          const a = time * 4 + hsh(k + id) * 6.283, r = 10 + hsh(k * 3) * 40, y = hsh(k * 7) * 120;
          const gx = sx + Math.cos(a + y * 0.02) * r, gz = sz + Math.sin(a + y * 0.02) * r;
          cl.add(gx, this.world.gridHeight(sx, sz) + y, gz, 6 + hsh(k) * 10, k, 0.3, 0.26, 0.22, 0.7 * s.i);
        }
      }
    }
    cl.end(fog); fi.end(fog);

    // hurricanes: rotating spiral discs
    const seenH = new Set();
    for (const s of this.storms) {
      if (s.type !== 'hurricane') continue;
      seenH.add(s.id);
      let m = this.hurricanes.get(s.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.spiralTex, transparent: true, depthWrite: false, color: 0xffffff, fog: true }));
        m.renderOrder = 3; this.scene.add(m); this.hurricanes.set(s.id, m);
      }
      m.position.set(s.x + s.vx * sdt, 950, s.z + s.vz * sdt);
      m.scale.setScalar(s.r * 2.4);
      m.rotation.y = -time * 0.12;
      m.material.opacity = Math.min(1, s.i * 1.3);
      m.material.color.copy(lit);
    }
    for (const [id, m] of this.hurricanes) if (!seenH.has(id)) { this.scene.remove(m); this.hurricanes.delete(id); }
    // tornado funnels
    const seenT = new Set();
    this.funnelMat.uniforms.uTime.value = time; this.funnelMat.uniforms.uLight.value = light;
    for (const s of this.storms) {
      if (s.type !== 'tornado') continue;
      seenT.add(s.id);
      let m = this.tornadoes.get(s.id);
      if (!m) { m = new THREE.Mesh(this.funnelGeo, this.funnelMat); m.renderOrder = 3; this.scene.add(m); this.tornadoes.set(s.id, m); }
      const x = s.x + s.vx * sdt, z = s.z + s.vz * sdt;
      m.position.set(x, this.world.gridHeight(x, z), z);
      m.rotation.z = Math.sin(time * 0.7 + s.id) * 0.08; m.rotation.x = Math.cos(time * 0.5) * 0.06;
      m.scale.set(0.5 + s.i * 0.6, 0.6 + s.i * 0.5, 0.5 + s.i * 0.6);
    }
    for (const [id, m] of this.tornadoes) if (!seenT.has(id)) { this.scene.remove(m); this.tornadoes.delete(id); }

    // precipitation around the viewer
    const here = this.sample(focus.x, focus.z);
    const camH = cp.y - focus.y;
    const near = camH < 900 ? 1 : 0;
    const tempCold = this.coldAt ? this.coldAt(focus.x, focus.z) : false;
    let rainI = here.rain, snowI = here.snow;
    if (tempCold) { snowI = Math.max(snowI, rainI); rainI = 0; }
    this.rainU.uI.value += ((rainI * near) - this.rainU.uI.value) * Math.min(1, dt * 2);
    this.snowU.uI.value += ((snowI * near) - this.snowU.uI.value) * Math.min(1, dt * 2);
    this.rain.visible = this.rainU.uI.value > 0.01; this.snow.visible = this.snowU.uI.value > 0.01;
    for (const u of [this.rainU, this.snowU]) { u.uTime.value = time; u.uCenter.value.set(cp.x, Math.max(focus.y, cp.y - 80), cp.z); u.uWind.value.set(wind.x * (1 + here.wind * 3), wind.z * (1 + here.wind * 3)); u.uLight.value = light; }

    // lightning decay
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.userData.life -= dt;
      b.material.opacity = Math.max(0, b.userData.life / 0.28) * (Math.random() < 0.3 ? 0.3 : 1);
      if (b.userData.life <= 0) { this.scene.remove(b); b.geometry.dispose(); this.bolts.splice(i, 1); }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    return here;
  }
}
