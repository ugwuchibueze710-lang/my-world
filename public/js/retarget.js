// Animation retargeting: bakes clips from the Universal Animation Library rig (source) onto a different humanoid
// skeleton (Grab3D / Mixamo-style names) by transferring world-space rotation deltas, with per-bone direction
// correction so differing rest poses (T-pose vs A-pose) and proportions still line up.
import * as THREE from 'three';

// target bone -> [source bone, target child used for direction, source child used for direction]
export const UAL_TO_MIXAMO = {
  Hips: ['DEF-hips', 'Spine02', 'DEF-spine001'],
  Spine02: ['DEF-spine001', 'Spine01', 'DEF-spine002'],
  Spine01: ['DEF-spine002', 'Spine', 'DEF-spine003'],
  Spine: ['DEF-spine003', 'neck', 'DEF-neck'],
  neck: ['DEF-neck', 'Head', 'DEF-head'],
  Head: ['DEF-head', null, null],
  LeftShoulder: ['DEF-shoulderL', 'LeftArm', 'DEF-upper_armL'],
  LeftArm: ['DEF-upper_armL', 'LeftForeArm', 'DEF-forearmL'],
  LeftForeArm: ['DEF-forearmL', 'LeftHand', 'DEF-handL'],
  LeftHand: ['DEF-handL', null, null],
  RightShoulder: ['DEF-shoulderR', 'RightArm', 'DEF-upper_armR'],
  RightArm: ['DEF-upper_armR', 'RightForeArm', 'DEF-forearmR'],
  RightForeArm: ['DEF-forearmR', 'RightHand', 'DEF-handR'],
  RightHand: ['DEF-handR', null, null],
  LeftUpLeg: ['DEF-thighL', 'LeftLeg', 'DEF-shinL'],
  LeftLeg: ['DEF-shinL', 'LeftFoot', 'DEF-footL'],
  LeftFoot: ['DEF-footL', 'LeftToeBase', 'DEF-toeL'],
  LeftToeBase: ['DEF-toeL', null, null],
  RightUpLeg: ['DEF-thighR', 'RightLeg', 'DEF-shinR'],
  RightLeg: ['DEF-shinR', 'RightFoot', 'DEF-footR'],
  RightFoot: ['DEF-footR', 'RightToeBase', 'DEF-toeR'],
  RightToeBase: ['DEF-toeR', null, null],
};

const bonesOf = (root) => { const m = {}; root.traverse((o) => { if (o.isBone) m[o.name] = o; }); return m; };
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

export function retargetClips(sourceRoot, clips, targetRoot, fps = 30) {
  const S = bonesOf(sourceRoot), T = bonesOf(targetRoot);
  const map = Object.entries(UAL_TO_MIXAMO).filter(([t, [s]]) => T[t] && S[s]);
  // bind-pose data
  sourceRoot.updateMatrixWorld(true); targetRoot.updateMatrixWorld(true);
  const sMixer = new THREE.AnimationMixer(sourceRoot);
  sMixer.stopAllAction(); sourceRoot.updateMatrixWorld(true);
  const bind = {};
  for (const [t, [s, tc, sc]] of map) {
    const tB = T[t], sB = S[s];
    let corr = new THREE.Quaternion();
    if (tc && sc && T[tc] && S[sc]) {
      const dt = wp(T[tc]).sub(wp(tB)).normalize(), ds = wp(S[sc]).sub(wp(sB)).normalize();
      corr.setFromUnitVectors(dt, ds); // rotate the target's rest direction onto the source's
    }
    bind[t] = { sInv: wq(sB).invert(), tW: wq(tB), corr };
  }
  // the parent chain of each target bone, in world space at bind
  const tParentBindW = {};
  for (const [t] of map) tParentBindW[t] = wq(T[t].parent);
  const hipsS = S['DEF-hips'], hipsT = T.Hips;
  const sHipBind = wp(hipsS), tHipBind = wp(hipsT);
  const scale = tHipBind.y / Math.max(0.01, sHipBind.y);
  const tHipParentInv = hipsT.parent.matrixWorld.clone().invert();
  const order = []; // parents before children
  targetRoot.traverse((o) => { if (o.isBone && UAL_TO_MIXAMO[o.name] && S[UAL_TO_MIXAMO[o.name][0]]) order.push(o.name); });
  const out = [];
  for (const clip of clips) {
    const action = sMixer.clipAction(clip); action.reset().play();
    const frames = Math.max(2, Math.ceil(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const qv = {}; for (const t of order) qv[t] = new Float32Array(frames * 4);
    const pv = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const time = Math.min(clip.duration, f / fps); times[f] = time;
      sMixer.setTime(time); sourceRoot.updateMatrixWorld(true);
      const tWorld = {};
      for (const t of order) {
        const [s] = UAL_TO_MIXAMO[t];
        const b = bind[t];
        // world rotation the target bone should have now
        const delta = wq(S[s]).multiply(b.sInv);
        const w = delta.multiply(b.corr).multiply(b.tW.clone());
        tWorld[t] = w;
        const parentName = T[t].parent?.name;
        const parentW = tWorld[parentName] || tParentBindW[t];
        const local = parentW.clone().invert().multiply(w);
        local.toArray(qv[t], f * 4);
      }
      const hp = wp(hipsS).sub(sHipBind).multiplyScalar(scale).add(tHipBind).applyMatrix4(tHipParentInv);
      hp.toArray(pv, f * 3);
    }
    action.stop();
    const tracks = order.map((t) => new THREE.QuaternionKeyframeTrack(`${t}.quaternion`, times, qv[t]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, pv));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  sMixer.stopAllAction(); sourceRoot.updateMatrixWorld(true);
  return out;
}
