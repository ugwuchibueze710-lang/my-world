// Faces for the Grab3D characters. Their faces are painted textures with no jaw bone or blendshapes, so each model
// gets a hand-calibrated mouth (height above the Head bone and width, measured from a front ruler render) that
// opens with speech and changes shape with mood, and the head/neck carry the expression on top of the animation.
import * as THREE from 'three';

// [mouth height above Head bone (m), mouth width (m)]
const CAL = {
  king: [0.05, 0.03], queen: [0.048, 0.028], 'armored-knight': [0.006, 0.03], farmer: [0.018, 0.055], viking: [0.016, 0.035],
  man: [0.002, 0.032], woman: [-0.01, 0.03], 'elderly-man': [0.028, 0.035], 'elderly-woman': [0.055, 0.028],
  'teen-character': [0.012, 0.028], child: [0.027, 0.032], 'baby-character': [-0.004, 0.026],
};

export function findMouth(root, type) {
  root.updateMatrixWorld(true);
  let head = null; root.traverse((o) => { if (o.isBone && !head && /^(Head|DEF-head)$/.test(o.name)) head = o; });
  if (!head) return null;
  const hp = head.getWorldPosition(new THREE.Vector3());
  const [dy, w] = CAL[type] || [0.03, 0.03];
  const my = hp.y + dy;
  // front surface of the face at mouth height, on the centre line
  let fz = -Infinity; const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (Math.abs(v.y - my) < 0.008 && Math.abs(v.x - hp.x) < 0.01 && v.z > fz) fz = v.z; }
  });
  if (!isFinite(fz)) fz = hp.z + 0.1;
  return { pos: new THREE.Vector3(hp.x, my, fz + 0.002), width: w, head: head.name };
}

const geo = new THREE.CircleGeometry(0.5, 24);
const dark = new THREE.MeshBasicMaterial({ color: 0x2b0c0a, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const tongue = new THREE.MeshBasicMaterial({ color: 0x9a3a36, polygonOffset: true, polygonOffsetFactor: -5, depthWrite: false });
const teeth = new THREE.MeshBasicMaterial({ color: 0xeeeae0, polygonOffset: true, polygonOffsetFactor: -5, depthWrite: false });

// mood codes shared with the simulation: 0 neutral, 1 happy, 2 sad, 3 angry, 4 scared
const SHAPE = { // [width x, height x, teeth, head pitch (+down), head roll, lean]
  0: [1, 1, 0, 0, 0, 0], 1: [1.25, 0.9, 1, -0.08, 0.07, 0], 2: [0.75, 0.6, 0, 0.32, 0.04, 0.06],
  3: [1.15, 0.55, 1, 0.12, 0, 0.1], 4: [0.65, 1.35, 0, -0.18, 0, -0.08],
};

export function attachMouth(root, info) {
  if (!info) return null;
  const bones = {}; root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const head = bones[info.head]; if (!head) return null;
  const neck = bones.neck || bones.Neck, spine = bones.Spine;
  root.updateMatrixWorld(true);
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, dark), t = new THREE.Mesh(geo, tongue), th = new THREE.Mesh(geo, teeth);
  t.scale.set(0.6, 0.4, 1); t.position.set(0, -0.18, 0.0005); m.add(t);
  th.scale.set(0.8, 0.22, 1); th.position.set(0, 0.36, 0.0007); m.add(th);
  g.add(m); g.position.copy(info.pos); root.add(g); g.updateMatrixWorld(true); head.attach(g);
  m.visible = false; m.renderOrder = 3; t.renderOrder = 4; th.renderOrder = 4; // drawn after the face (they don't write depth)
  const st = { mood: 0, w: 1, h: 1, teeth: 0, pitch: 0, roll: 0, lean: 0 };
  return {
    set(open, mood = 0, dt = 0.016) {
      const S = SHAPE[mood] || SHAPE[0], k = Math.min(1, dt * 4);
      st.w += (S[0] - st.w) * k; st.h += (S[1] - st.h) * k; st.pitch += (S[3] - st.pitch) * k; st.roll += (S[4] - st.roll) * k; st.lean += (S[5] - st.lean) * k;
      // scared mouths hang a little open even when silent
      const o = Math.max(open, mood === 4 ? 0.25 : 0);
      m.visible = o > 0.04;
      m.scale.set(info.width * st.w * (1 - o * 0.2), info.width * st.h * (0.15 + o * 0.7), 1);
      th.visible = S[2] > 0 && o > 0.15;
      // expression carried by the head, neck and upper body on top of the animation
      head.rotateX(st.pitch * 0.6 + o * 0.05); head.rotateZ(st.roll);
      if (neck) neck.rotateX(st.pitch * 0.4);
      if (spine) spine.rotateX(st.lean);
    },
  };
}
