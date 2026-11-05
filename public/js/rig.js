// Shared loader for Mixamo-rigged characters + animation clips (all share the mixamorig skeleton).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const norm = (n) => n.replace(/^.*?mixamorig\d*[:_]?/i, '').replace(/_\d+$/, '').replace(/[^A-Za-z0-9]/g, '');
const charCache = new Map(), clipCache = new Map(), CACHE = new WeakMap();

export async function loadClip(name) {
  if (!clipCache.has(name)) clipCache.set(name, loader.loadAsync(`/assets/anims/${name}.glb`).then((g) => {
    const c = g.animations[0]; c.name = name;
    c.tracks = c.tracks.filter((t) => !/\.scale$/.test(t.name)); // Mixamo scale tracks fight our per-char scaling
    return c;
  }));
  return clipCache.get(name);
}

export async function loadCharTemplate(name) {
  if (!charCache.has(name)) charCache.set(name, loader.loadAsync(`/assets/chars/${name}.glb`).then((g) => {
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    return g.scene;
  }));
  return charCache.get(name);
}

// Rebind a shared clip onto a specific character's bone names (handles mixamorig: / mixamorig1: / mixamorig prefixes).
export function bindClip(clip, root, opts = {}) {
  let cache = CACHE.get(root); if (!cache) CACHE.set(root, (cache = { clips: {}, map: (() => { const m = {}; root.traverse((o) => { if (o.isBone || o.type === 'Object3D') m[norm(o.name)] = o.name; }); return m; })() }));
  const map = cache.map;
  const key = clip.name + '|' + (opts.inPlace ? 1 : 0);
  if (cache.clips[key]) return cache.clips[key];
  const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.'); const bone = norm(t.name.slice(0, dot)), prop = t.name.slice(dot);
    if (!map[bone]) continue;
    const nt = t.clone(); nt.name = map[bone] + prop;
    if (prop === '.position') {
      if (bone !== 'Hips') continue;               // only the hips translate; other bones keep the target's proportions
      const v = nt.values, rest = root.getObjectByName(map[bone]).position;
      const k = rest.length() / (Math.hypot(v[0], v[1], v[2]) || 1);   // clip units (cm/m) -> this rig's units
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = (opts.inPlace ? x0 : v[i]) * k; v[i + 1] *= k; v[i + 2] = (opts.inPlace ? z0 : v[i + 2]) * k; }
    }
    tracks.push(nt);
  }
  return (cache.clips[key] = new THREE.AnimationClip(clip.name, clip.duration, tracks));
}

// Instantiate a character normalized to `height` metres, feet on y=0.
export async function spawnChar(name, height = 1.8) {
  const tpl = await loadCharTemplate(name);
  const inner = SkeletonUtils.clone(tpl);
  inner.updateMatrixWorld(true); inner.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox?.(); } });
  const box = new THREE.Box3().setFromObject(inner, true); const h = box.max.y - box.min.y;
  inner.scale.setScalar(height / h); inner.position.y = -box.min.y * (height / h);
  const root = new THREE.Group(); root.add(inner); root.userData.inner = inner;
  inner.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return root;
}
