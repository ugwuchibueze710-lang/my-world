// Character rendering layer: maps live simulation agents to rigged, skeletally-animated GLB humans.
// Closest agents get a full skinned character (LOD 0); the rest stay as instanced figures / dots (people.js).
// Everything shown is driven by real agent state: position, heading, action, mood, speech, age, sex, role.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { STATE } from '/shared/constants.js';

const ROLE = { COMMONER: 0, SOLDIER: 1, RULER: 2, CONSORT: 3, ROYAL: 4, GENERAL: 5 };
const hash = (n, k = 1) => { const x = Math.sin(n * 12.9898 * k + k * 78.233) * 43758.5453; return x - Math.floor(x); };

const SKIN = [[0.96, 0.8, 0.67], [0.9, 0.7, 0.55], [0.78, 0.57, 0.42], [0.6, 0.42, 0.3], [0.45, 0.3, 0.2], [0.32, 0.21, 0.14]];
const HAIR = [[0.08, 0.06, 0.05], [0.22, 0.13, 0.07], [0.45, 0.28, 0.12], [0.7, 0.5, 0.25], [0.55, 0.18, 0.08], [0.12, 0.1, 0.1]];
const CLOTH = [[0.45, 0.34, 0.22], [0.36, 0.4, 0.28], [0.55, 0.5, 0.42], [0.3, 0.32, 0.4], [0.5, 0.25, 0.2], [0.62, 0.58, 0.48], [0.25, 0.3, 0.22]];

// The painted-on clothing and face (bind-pose coordinates of the Universal Animation Library mannequin, T-pose, +Z forward)
const PAINT_GLSL = `
  uniform vec3 uSkin; uniform vec3 uHair; uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uShoes; uniform vec3 uAccent;
  uniform float uDress; uniform float uLongSleeve; uniform float uMood; uniform float uMouth; uniform float uBlink; uniform float uHairStyle;
  uniform vec3 uHead; uniform float uHeadR; uniform float uRoyal; uniform float uArmor;
  varying vec3 vBind;
  float ell(vec2 p, vec2 c, vec2 r){ vec2 d = (p - c) / r; return dot(d, d); }
  vec3 paintFace(vec3 col, vec3 d){
    vec2 f = d.xy / uHeadR;
    float happy = step(0.5, uMood) * step(uMood, 1.5), sad = step(1.5, uMood) * step(uMood, 2.5);
    float angry = step(2.5, uMood) * step(uMood, 3.5), scared = step(3.5, uMood);
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 ec = vec2(0.33 * sx, 0.12);
      vec2 er = vec2(0.17, 0.2 * (1.0 - uBlink * 0.9)) * (1.0 + scared * 0.15);
      float e = ell(f, ec, er);
      if (e < 1.0) {
        col = vec3(0.96);
        vec2 pc = ec + vec2(-0.03 * sx, -0.01 + scared * 0.03);
        if (uBlink < 0.5 && length(f - pc) < (scared > 0.5 ? 0.06 : 0.085)) col = vec3(0.05, 0.04, 0.03);
        if (uBlink < 0.5 && length(f - pc - vec2(0.025, 0.03)) < 0.02) col = vec3(1.0);
        float lid = sad * (f.y - (ec.y + 0.08 - 0.15 * sx * (f.x - ec.x))) + angry * (f.y - (ec.y + 0.07 + 0.55 * sx * (f.x - ec.x)));
        if (lid > 0.0) col = uSkin * 0.82;
      }
      if (e > 1.0 && e < 1.35) col = mix(col, uSkin * 0.55, 0.5);
      float tilt = angry * -0.5 + sad * 0.45 + scared * 0.25;
      float by = ec.y + 0.27 + scared * 0.08 + tilt * sx * (ec.x - f.x);
      if (abs(f.x - ec.x) < 0.17 && abs(f.y - by) < 0.03) col = uHair * 0.7;
    }
    // nose shading
    if (ell(f, vec2(0.0, -0.08), vec2(0.07, 0.12)) < 1.0) col *= 0.93;
    vec2 m = f - vec2(0.0, -0.4);
    float curve = (happy * 0.8 - sad * 0.6 - angry * 0.35) * m.x * m.x;
    if (uMouth > 0.05 || scared > 0.5) {
      float h = max(uMouth * 0.14, scared * 0.07) + 0.015;
      if (ell(m, vec2(0.0, curve * 0.5 - h * 0.3), vec2(0.15 + happy * 0.04, h)) < 1.0) col = vec3(0.28, 0.04, 0.05);
      if (uMouth > 0.3 && ell(m, vec2(0.0, curve * 0.5 - h * 0.85), vec2(0.08, h * 0.35)) < 1.0) col = vec3(0.78, 0.32, 0.33);
      if (uMouth > 0.2 && ell(m, vec2(0.0, curve * 0.5 + h * 0.45), vec2(0.11, h * 0.25)) < 1.0) col = vec3(0.95);
    } else if (abs(m.y - curve) < 0.022 && abs(m.x) < 0.16 + happy * 0.04) col = mix(uSkin, vec3(0.4, 0.08, 0.07), 0.75);
    if (happy > 0.5 && (ell(f, vec2(0.42, -0.2), vec2(0.1, 0.07)) < 1.0 || ell(f, vec2(-0.42, -0.2), vec2(0.1, 0.07)) < 1.0)) col = mix(col, vec3(0.95, 0.45, 0.45), 0.3);
    return col;
  }
  vec3 paint(){
    vec3 p = vBind;
    float ax = abs(p.x);
    vec3 d = p - uHead;
    // head & neck
    if (p.y > 1.5 && ax < 0.16) {
      vec3 col = uSkin;
      bool hair = (uHairStyle > 0.5) && (d.y > uHeadR * (0.45 - step(1.5, uHairStyle) * 0.2) || (d.z < -uHeadR * 0.15 && d.y > -uHeadR * (uHairStyle > 1.5 ? 1.6 : 0.5)));
      if (hair) return uHair * (0.85 + 0.15 * sin(p.x * 220.0 + p.y * 60.0));
      if (d.z > 0.0 && length(d) < uHeadR * 1.25 && d.y > -uHeadR * 0.9) return paintFace(col, d);
      if (p.y < uHead.y - uHeadR * 0.95 && uArmor > 0.5) return vec3(0.55, 0.56, 0.58);
      return col;
    }
    // arms (T-pose along X)
    if (ax > 0.21 && p.y > 1.2) {
      float sleeve = uLongSleeve > 0.5 ? 0.66 : 0.42;
      if (uArmor > 0.5) sleeve = 0.62;
      if (ax < sleeve) return uArmor > 0.5 ? mix(vec3(0.5, 0.52, 0.55), uShirt, 0.25) * (0.9 + 0.1 * sin(p.x * 120.0)) : uShirt * (0.92 + 0.08 * sin(p.x * 90.0));
      if (ax > 0.78) return uSkin * 0.97;
      return uRoyal > 0.5 && ax < sleeve + 0.03 ? uAccent : uSkin;
    }
    // torso
    if (p.y > 1.0) {
      if (p.y > 1.47 && p.z > 0.04 && ax < 0.06 + (p.y - 1.47) * 1.2) return uSkin; // neckline
      if (uArmor > 0.5) { float plate = 0.85 + 0.15 * step(0.5, fract(p.y * 18.0)); return mix(vec3(0.56, 0.58, 0.6), uShirt, 0.3) * plate; }
      vec3 c = uShirt * (0.9 + 0.1 * sin(p.y * 70.0 + p.x * 30.0));
      if (uRoyal > 0.5 && (abs(p.x) < 0.025 || p.y > 1.42)) c = uAccent;
      if (p.y < 1.06) c = uDress > 0.5 ? uShirt * 0.8 : vec3(0.18, 0.12, 0.08); // belt
      return c;
    }
    // legs & dress
    if (uDress > 0.5 && p.y > 0.32) return uShirt * (0.82 + 0.1 * sin(p.y * 40.0)) * (p.y < 0.4 ? 0.8 : 1.0);
    if (p.y < 0.1) return uShoes;
    if (uDress > 0.5) return uSkin;
    return uPants * (0.92 + 0.08 * sin(p.y * 60.0));
  }`;

export class Characters {
  constructor(scene, world, people, onReady) {
    this.scene = scene; this.world = world; this.people = people;
    this.ready = false; this.max = 44; this.slots = []; this.byAgent = new Map();
    this.hidden = new Set();
    this.fpsAvg = 60;
    const loader = new GLTFLoader();
    loader.load('/assets/characters/human.glb', (gltf) => { this.setup(gltf); onReady?.(); }, undefined, (e) => console.warn('character model failed to load', e));
  }

  setup(gltf) {
    this.template = gltf.scene;
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    // head centre in bind pose (for the painted face)
    let headMin = new THREE.Vector3(1e9, 1e9, 1e9), headMax = new THREE.Vector3(-1e9, -1e9, -1e9);
    this.template.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y > 1.6 && Math.abs(x) < 0.16) { headMin.min(new THREE.Vector3(x, y, z)); headMax.max(new THREE.Vector3(x, y, z)); }
      }
    });
    this.head = headMin.clone().add(headMax).multiplyScalar(0.5);
    this.headR = Math.max(headMax.x - headMin.x, headMax.y - headMin.y) * 0.5;
    this.head.y -= this.headR * 0.08;
    // shared accessory geometry
    this.geo = {
      cap: new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      bun: new THREE.SphereGeometry(1, 10, 8),
      long: new THREE.CylinderGeometry(0.95, 1.2, 1, 14, 1, true, Math.PI * 0.38, Math.PI * 1.24),
      beard: new THREE.SphereGeometry(1, 10, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55),
      crown: (() => { const g = [new THREE.CylinderGeometry(1, 0.95, 0.55, 14, 1, true)]; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.push(new THREE.ConeGeometry(0.18, 0.55, 5).translate(Math.cos(a) * 0.95, 0.5, Math.sin(a) * 0.95)); } return g; })(),
      helmet: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hat: new THREE.ConeGeometry(1, 0.6, 16), brim: new THREE.CylinderGeometry(1.7, 1.7, 0.06, 18),
      skirt: new THREE.CylinderGeometry(0.17, 0.3, 0.62, 16, 1, true),
      blade: new THREE.BoxGeometry(0.05, 0.85, 0.012), guard: new THREE.BoxGeometry(0.2, 0.03, 0.04), grip: new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6),
      shield: new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), handle: new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6),
      hoe: new THREE.BoxGeometry(0.18, 0.03, 0.12), pick: new THREE.TorusGeometry(0.16, 0.025, 4, 10, Math.PI), hammer: new THREE.BoxGeometry(0.14, 0.08, 0.08),
      cape: new THREE.PlaneGeometry(0.5, 0.95, 1, 4),
    };
    this.mat = {
      gold: new THREE.MeshStandardMaterial({ color: 0xffcc55, metalness: 0.95, roughness: 0.25, emissive: 0x2a1a00 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.9, roughness: 0.3 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }),
      straw: new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1 }),
    };
    this.ready = true;
  }

  makeSlot() {
    const root = SkeletonUtils.clone(this.template);
    const uniforms = {
      uSkin: { value: new THREE.Color() }, uHair: { value: new THREE.Color() }, uShirt: { value: new THREE.Color() }, uPants: { value: new THREE.Color() },
      uShoes: { value: new THREE.Color(0.2, 0.13, 0.08) }, uAccent: { value: new THREE.Color(0.9, 0.75, 0.3) },
      uDress: { value: 0 }, uLongSleeve: { value: 0 }, uMood: { value: 0 }, uMouth: { value: 0 }, uBlink: { value: 0 }, uHairStyle: { value: 1 },
      uHead: { value: this.head }, uHeadR: { value: this.headR }, uRoyal: { value: 0 }, uArmor: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PAINT_GLSL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = paint();');
    };
    mat.customProgramCacheKey = () => 'mw-human';
    root.traverse((o) => { if (o.isSkinnedMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const bones = {};
    root.traverse((o) => { if (o.isBone) { bones[o.name] = o; bones[o.name.replace(/[.\[\]:/]/g, '')] = o; } });
    const bone = (n) => bones[n] || bones[n.replace(/[.\[\]:/]/g, '')];
    root.updateMatrixWorld(true);
    const attach = (boneName, mesh, pos, rot = [0, 0, 0], scale = [1, 1, 1]) => {
      mesh.position.set(...pos); mesh.rotation.set(...rot); mesh.scale.set(...scale);
      mesh.castShadow = true;
      root.add(mesh); mesh.updateMatrixWorld(true);
      bone(boneName).attach(mesh);
      return mesh;
    };
    const H = this.head, R = this.headR;
    const wp = (bone_, dx, dy, dz) => { const v = bone(bone_).getWorldPosition(new THREE.Vector3()); return [v.x + dx, v.y + dy, v.z + dz]; };
    const hairMat = new THREE.MeshStandardMaterial({ roughness: 0.65, color: 0x332211 });
    const clothMat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    const accentMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    const a = {
      cap: attach('DEF-head', new THREE.Mesh(this.geo.cap, hairMat), [H.x, H.y + R * 0.08, H.z - R * 0.08], [-0.25, 0, 0], [R * 1.12, R * 1.08, R * 1.15]),
      long: attach('DEF-head', new THREE.Mesh(this.geo.long, hairMat), [H.x, H.y - R * 0.45, H.z - R * 0.2], [0.12, 0, 0], [R * 1.08, R * 1.35, R * 1.0]),
      bun: attach('DEF-head', new THREE.Mesh(this.geo.bun, hairMat), [H.x, H.y + R * 0.75, H.z - R * 0.75], [0, 0, 0], [R * 0.45, R * 0.45, R * 0.45]),
      beard: attach('DEF-head', new THREE.Mesh(this.geo.beard, hairMat), [H.x, H.y - R * 0.55, H.z + R * 0.35], [0.2, 0, 0], [R * 0.75, R * 0.6, R * 0.6]),
      crown: attach('DEF-head', new THREE.Group().add(...this.geo.crown.map((g) => new THREE.Mesh(g, this.mat.gold))), [H.x, H.y + R * 0.72, H.z - R * 0.08], [-0.15, 0, 0], [R * 0.86, R * 0.86, R * 0.86]),
      helmet: attach('DEF-head', new THREE.Mesh(this.geo.helmet, this.mat.steel), [H.x, H.y + R * 0.3, H.z - R * 0.05], [-0.2, 0, 0], [R * 1.18, R * 1.1, R * 1.22]),
      hat: attach('DEF-head', new THREE.Group().add(new THREE.Mesh(this.geo.hat, this.mat.straw), new THREE.Mesh(this.geo.brim, this.mat.straw)), [H.x, H.y + R * 0.95, H.z], [-0.12, 0, 0], [R * 1.05, R * 1.05, R * 1.05]),
      skirt: attach('DEF-hips', new THREE.Mesh(this.geo.skirt, clothMat), [0, 0.67, 0.01], [0, 0, 0], [1.05, 1, 1.1]),
      cape: attach('DEF-spine.003', new THREE.Mesh(this.geo.cape, accentMat), [0, 1.0, -0.14], [0.12, Math.PI, 0], [1, 1, 1]),
      sword: attach('DEF-hand.R', new THREE.Group().add(
        new THREE.Mesh(this.geo.blade, this.mat.steel).rotateX(Math.PI / 2).translateY(0.52),
        new THREE.Mesh(this.geo.guard, this.mat.gold).translateZ(0.08),
        new THREE.Mesh(this.geo.grip, this.mat.wood).rotateX(Math.PI / 2)), wp('DEF-hand.R', -0.06, -0.02, 0.02)),
      shield: attach('DEF-forearm.L', new THREE.Mesh(this.geo.shield, accentMat), wp('DEF-forearm.L', 0.12, 0, 0.09), [Math.PI / 2, 0, 0]),
      tool: attach('DEF-hand.R', new THREE.Group(), wp('DEF-hand.R', -0.06, -0.02, 0.02)),
    };
    const handle = new THREE.Mesh(this.geo.handle, this.mat.wood); handle.rotation.x = Math.PI / 2; handle.position.z = 0.25; a.tool.add(handle);
    a.hoeHead = new THREE.Mesh(this.geo.hoe, this.mat.steel); a.hoeHead.position.set(0, -0.06, 0.52); a.tool.add(a.hoeHead);
    a.pickHead = new THREE.Mesh(this.geo.pick, this.mat.steel); a.pickHead.position.set(0, 0, 0.5); a.pickHead.rotation.y = Math.PI / 2; a.tool.add(a.pickHead);
    a.hammerHead = new THREE.Mesh(this.geo.hammer, this.mat.steel); a.hammerHead.position.set(0, 0, 0.5); a.tool.add(a.hammerHead);
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const [name, clip] of this.clips) {
      const act = mixer.clipAction(clip);
      if (!/Loop/.test(name) && name !== 'Sword_Attack' && name !== 'Fixing_Kneeling' && name !== 'Interact' && name !== 'Punch_Cross' && name !== 'Sword_Idle') { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      actions[name] = act;
    }
    root.visible = false;
    this.scene.add(root);
    return { root, mixer, actions, uniforms, hairMat, clothMat, accentMat, a, agent: 0, current: null, blinkT: 0 };
  }

  // a stable, unique look for each simulated person
  dress(slot, ag) {
    const u = slot.uniforms, id = ag.id;
    const female = ag.fl & 1, ageG = (ag.fl >> 1) & 3, role = (ag.fl >> 3) & 7;
    const kc = this.people.kColors.get(ag.k) || new THREE.Color(0.6, 0.6, 0.6);
    const skin = SKIN[Math.floor(hash(ag.k * 7.1 + 3) * 3 + hash(id, 2) * 3.2) % SKIN.length];
    u.uSkin.value.setRGB(...skin);
    const hc = ageG === 3 ? [0.78, 0.78, 0.76] : HAIR[Math.floor(hash(id, 3) * HAIR.length)];
    u.uHair.value.setRGB(...hc); slot.hairMat.color.setRGB(...hc);
    const cloth = CLOTH[Math.floor(hash(id, 4) * CLOTH.length)];
    const royal = role === ROLE.RULER || role === ROLE.CONSORT || role === ROLE.ROYAL;
    const soldier = role === ROLE.SOLDIER || role === ROLE.GENERAL;
    if (royal) u.uShirt.value.copy(kc).multiplyScalar(0.75); else u.uShirt.value.setRGB(...cloth).lerp(kc, 0.3);
    u.uPants.value.setRGB(...CLOTH[Math.floor(hash(id, 5) * CLOTH.length)]).multiplyScalar(0.7);
    u.uAccent.value.copy(royal ? new THREE.Color(0.95, 0.78, 0.3) : kc);
    slot.accentMat.color.copy(royal ? kc : kc);
    u.uDress.value = female && hash(id, 6) < 0.8 && !soldier ? 1 : 0;
    u.uLongSleeve.value = hash(id, 7) < 0.5 || royal ? 1 : 0;
    u.uRoyal.value = royal ? 1 : 0; u.uArmor.value = soldier ? 1 : 0;
    const style = ageG === 0 ? 1 : female ? (hash(id, 8) < 0.6 ? 2 : 3) : (hash(id, 8) < 0.12 ? 0 : 1);
    u.uHairStyle.value = style;
    const A = slot.a;
    A.cap.visible = style >= 1 && !soldier;
    A.long.visible = style === 2 && !soldier;
    A.bun.visible = style === 3 && !soldier;
    A.beard.visible = !female && ageG >= 2 && hash(id, 9) < 0.35;
    A.crown.visible = role === ROLE.RULER || role === ROLE.CONSORT;
    A.helmet.visible = soldier;
    A.hat.visible = !royal && !soldier && ageG >= 2 && hash(id, 10) < 0.18;
    A.skirt.visible = !!u.uDress.value;
    slot.clothMat.color.copy(u.uShirt.value).multiplyScalar(0.85);
    A.cape.visible = role === ROLE.RULER || role === ROLE.GENERAL;
    A.sword.visible = soldier; A.shield.visible = soldier;
    // body type
    const tall = ageG === 0 ? 0.36 : ageG === 1 ? 0.55 + Math.min(1, ag.age / 15) * 0.35 : (female ? 0.94 : 1.0) * (0.95 + hash(id, 11) * 0.1);
    const wide = 0.92 + hash(id, 12) * 0.2 + (ageG === 3 ? 0.05 : 0);
    slot.scale = [tall * wide, tall, tall * wide];
    slot.dressKey = `${ag.k}|${ag.fl}|${Math.floor(ag.age)}`;
  }

  animFor(ag, speed) {
    const st = ag.st, role = (ag.fl >> 3) & 7, soldier = role === 1 || role === 5;
    const talking = ag.ex & 32;
    if (((ag.fl >> 1) & 3) === 0) return ['Idle_Loop', 1];
    if ((ag.ex & 64) && st === STATE.REST) return ['Idle_Loop', 0.25]; // asleep in bed
    if ((ag.ex & 1) && !ag.mv) return ['Death01', 1]; // sick: lying down
    if (st === STATE.FIGHT) return ag.mv && speed > 1.5 ? ['Sprint_Loop', 1] : [soldier ? 'Sword_Attack' : (ag.id % 2 ? 'Punch_Cross' : 'Punch_Jab'), 1.1];
    if (ag.mv && speed > 0.25) {
      if (st === STATE.FLEE || speed > 4.2) return ['Sprint_Loop', speed / 6];
      if (st === STATE.MARCH && speed < 3.6) return ['Walk_Formal_Loop', speed / 1.5];
      if (speed > 2.9) return ['Jog_Fwd_Loop', speed / 3.4];
      if (st === STATE.PLAY) return ['Jog_Fwd_Loop', speed / 3.2];
      return ['Walk_Loop', speed / 1.45];
    }
    if (talking || st === STATE.COURT) return ['Idle_Talking_Loop', 1];
    switch (st) {
      case STATE.FARM: return ['Fixing_Kneeling', 1];
      case STATE.MINE: return ['Sword_Attack', 0.7];
      case STATE.BUILD: return ['Interact', 0.9];
      case STATE.EAT: return ['Sitting_Talking_Loop', 1];
      case STATE.DRINK: return ['PickUp_Table', 1];
      case STATE.REST: return ['Sitting_Idle_Loop', 1];
      case STATE.PLAY: return ['Dance_Loop', 1];
      case STATE.DEFEND: case STATE.MARCH: return [soldier ? 'Sword_Idle' : 'Idle_Loop', 1];
      default: return ['Idle_Loop', 1];
    }
  }

  // called every frame after people.update has interpolated agent positions
  update(dt, now, time, camera, focus) {
    if (!this.ready) return this.hidden;
    this.fpsAvg = this.fpsAvg * 0.97 + (1 / Math.max(dt, 1e-3)) * 0.03;
    if (this.fpsAvg < 34 && this.max > 12) this.max -= 1; else if (this.fpsAvg > 55 && this.max < 70) this.max += 0.25;
    const cp = camera.position;
    const camH = cp.y - focus.y;
    const R = 110;
    // candidates: nearest agents to the camera
    const cand = [];
    if (camH < 260) {
      for (const ag of this.people.list) {
        const dx = ag.x - cp.x, dz = ag.z - cp.z;
        if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
        const d2 = dx * dx + dz * dz + (ag.y - cp.y) ** 2;
        if (d2 < R * R) cand.push([d2, ag]);
      }
      cand.sort((a, b) => a[0] - b[0]);
    }
    const want = new Set(cand.slice(0, Math.floor(this.max)).map((c) => c[1].id));
    // release slots
    for (const s of this.slots) if (s.agent && !want.has(s.agent)) { this.byAgent.delete(s.agent); s.agent = 0; s.root.visible = false; s.current = null; s.mixer.stopAllAction(); }
    // assign
    for (const id of want) {
      if (this.byAgent.has(id)) continue;
      let s = this.slots.find((x) => !x.agent);
      if (!s) { if (this.slots.length >= 80) break; s = this.makeSlot(); this.slots.push(s); }
      s.agent = id; this.byAgent.set(id, s); s.dressKey = null; s.root.visible = true;
      const ag = this.people.agents.get(id); s.px = ag.x; s.pz = ag.z; s.speed = 0;
    }
    this.hidden.clear();
    for (const s of this.slots) {
      if (!s.agent) continue;
      const ag = this.people.agents.get(s.agent);
      if (!ag) { this.byAgent.delete(s.agent); s.agent = 0; s.root.visible = false; continue; }
      this.hidden.add(ag.id);
      const key = `${ag.k}|${ag.fl}|${Math.floor(ag.age)}`;
      if (s.dressKey !== key) this.dress(s, ag);
      // real speed from the interpolated motion (prevents foot sliding)
      const sp = Math.hypot(ag.x - s.px, ag.z - s.pz) / Math.max(dt, 1e-3);
      s.speed = s.speed * 0.85 + Math.min(sp, 9) * 0.15; s.px = ag.x; s.pz = ag.z;
      const [name, ts] = this.animFor(ag, s.speed);
      const act = s.actions[name] || s.actions.Idle_Loop;
      if (s.current !== act) {
        act.reset(); act.enabled = true; act.setEffectiveWeight(1); act.play();
        if (s.current) s.current.crossFadeTo(act, 0.3, false);
        s.current = act;
      }
      act.setEffectiveTimeScale(THREE.MathUtils.clamp(ts, 0.5, 2.2));
      s.mixer.update(dt);
      // transform
      const inBed = (ag.ex & 64) && ag.st === STATE.REST;
      const lying = s.current === s.actions.Death01 || inBed;
      s.root.position.set(ag.x, ag.y, ag.z);
      if (inBed) { // lie down on the bed, head on the pillow, breathing slowly
        const ax = Math.cos(ag.sh), az = -Math.sin(ag.sh); // bed runs along the house's x axis
        s.root.position.set(ag.x + ax * 0.85 * s.scale[1], ag.y + 0.5, ag.z + az * 0.85 * s.scale[1]);
        s.root.rotation.set(-Math.PI / 2, ag.sh + Math.PI / 2, 0, 'YXZ');
        s.root.scale.set(...s.scale);
      } else {
      if (((ag.fl >> 1) & 3) === 0) { s.root.position.x += Math.cos(ag.hd) * 0.25; s.root.position.y += 0.7; }
      s.root.rotation.set(0, ag.hd, 0, 'XYZ');
      s.root.scale.set(...s.scale);
      }
      // face: mood, blink, lip sync (same signals as the instanced figures)
      const u = s.uniforms;
      u.uMood.value = (ag.ex >> 2) & 7;
      s.blinkT -= dt; if (s.blinkT < -0.14) s.blinkT = 2 + hash(ag.id + time) * 4;
      u.uBlink.value = s.blinkT < 0 ? 1 : 0;
      let mouth = 0;
      if (ag.mouthUntil > now) mouth = ag.voiced ? Math.max(ag.mouthPulse || 0, 0.2 + 0.25 * Math.sin(time * 17 + ag.ph)) : 0.45 + 0.45 * Math.sin(time * 15 + ag.ph) * Math.sin(time * 6.3);
      u.uMouth.value = lying ? 0 : Math.max(0, mouth);
      // tools follow the job
      const A = s.a, st = ag.st, soldier = A.sword.visible;
      A.tool.visible = !soldier && (st === STATE.FARM || st === STATE.MINE || st === STATE.BUILD) && !ag.mv;
      A.hoeHead.visible = st === STATE.FARM; A.pickHead.visible = st === STATE.MINE; A.hammerHead.visible = st === STATE.BUILD;
    }
    return this.hidden;
  }

  // world position of a character's head (for the movie camera)
  headOf(id) {
    const s = this.byAgent.get(id); if (!s) return null;
    const b = s.root.getObjectByName('DEF-head'); if (!b) return null;
    return b.getWorldPosition(new THREE.Vector3());
  }
}
