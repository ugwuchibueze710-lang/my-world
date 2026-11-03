// Physically based sky, sun/moon lighting, stars and environment reflections, driven by the world clock.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera; sc.near = 10; sc.far = 4000;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3326, 0.8);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x30405a, 0.15);
    scene.add(this.ambient);

    // stars
    const n = 2500, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * 30000; sp[i * 3 + 1] = Math.cos(ph) * 30000; sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 30000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envRT = null; this.lastEnvElev = -99; this.envT = 0;

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.fogColor = new THREE.Color(0.7, 0.78, 0.86);
    this.daylight = 1;
    scene.fog = new THREE.FogExp2(0xb5c7d8, 0.00011);
  }

  // hours: world time in hours; yearFrac: 0..1; cloud: 0..1 overcast near camera
  update(dt, hours, yearFrac, focus, camDist, cloud, extraFog) {
    const h = hours % 24;
    // seasonal day length: ~15h in summer, ~9h in winter
    const dayLen = 12 + 3 * Math.cos(2 * Math.PI * (yearFrac - 0.375));
    const rise = 12 - dayLen / 2;
    const t = (h - rise) / dayLen; // 0 sunrise .. 1 sunset
    const maxElev = 30 + 22 * Math.cos(2 * Math.PI * (yearFrac - 0.375));
    let elev, az;
    if (t >= 0 && t <= 1) { elev = Math.sin(t * Math.PI) * maxElev; az = 90 + t * 180; }
    else { const nt = t < 0 ? (t + (24 / dayLen)) : t - 1; elev = -Math.sin(Math.min(1, nt / ((24 - dayLen) / dayLen)) * Math.PI) * 25; az = 270 + nt * 90; }
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(az);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 4 + cloud * 14; u.rayleigh.value = 1.2 + cloud * 2.2;

    const day = THREE.MathUtils.smoothstep(elev, -6, 8);
    const golden = THREE.MathUtils.smoothstep(elev, -4, 3) * (1 - THREE.MathUtils.smoothstep(elev, 6, 22));
    this.daylight = day;
    this.sunColor.setRGB(1, 0.93 - golden * 0.3, 0.84 - golden * 0.5);
    const overcast = 1 - cloud * 0.65;
    this.sun.intensity = day * 3.2 * overcast;
    this.sun.color.copy(this.sunColor);
    // moonlight
    const moon = (1 - day) * 0.12;
    this.hemi.intensity = 0.06 + day * 0.95 * (0.7 + 0.3 * overcast) + moon;
    this.hemi.color.setRGB(0.55 + day * 0.2, 0.65 + day * 0.18, 0.95);
    this.hemi.groundColor.setRGB(0.18 + day * 0.12, 0.16 + day * 0.1, 0.12 + day * 0.06);
    this.ambient.intensity = 0.05 + (1 - day) * 0.1;
    this.starMat.opacity = (1 - day) * (1 - cloud) * 0.95;
    this.renderer.toneMappingExposure = 0.45 + day * 0.15 + (1 - day) * 0.12;

    // light follows the camera focus; shadow frustum scales with zoom
    const lightDir = elev > 2 ? this.sunDir : new THREE.Vector3(0.3, 0.8, 0.2).normalize();
    const S = THREE.MathUtils.clamp(camDist * 0.9, 60, 1600);
    this.sun.position.set(focus.x + lightDir.x * 2000, focus.y + lightDir.y * 2000, focus.z + lightDir.z * 2000);
    this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - S) > S * 0.1) { sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.updateProjectionMatrix(); }
    this.sun.castShadow = day > 0.05 && camDist < 2600;

    // fog colour approximates the horizon
    const dayFog = new THREE.Color().setRGB(0.66 + golden * 0.25, 0.74 + golden * 0.05, 0.84 - golden * 0.2);
    const nightFog = new THREE.Color(0.035, 0.045, 0.07);
    this.fogColor.copy(nightFog).lerp(dayFog, day).lerp(new THREE.Color(0.48, 0.5, 0.53).multiplyScalar(0.3 + 0.7 * day), cloud * 0.7);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = 0.000075 + cloud * 0.00012 + extraFog;
    this.stars.position.set(focus.x, 0, focus.z);
    this.sky.position.set(focus.x, 0, focus.z);

    // refresh reflections when the sun moves noticeably
    this.envT -= dt;
    if (this.envT <= 0 && Math.abs(elev - this.lastEnvElev) > 1.5) {
      this.envT = 0.75; this.lastEnvElev = elev;
      const eu = this.envSky.material.uniforms;
      eu.sunPosition.value.copy(this.sunDir); eu.turbidity.value = u.turbidity.value; eu.rayleigh.value = u.rayleigh.value;
      eu.mieCoefficient.value = 0.004; eu.mieDirectionalG.value = 0.8;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.25 + day * 0.55;
    }
    return elev;
  }
}
