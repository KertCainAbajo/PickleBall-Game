// Realistic 3D renderer (Three.js, needs a hardware GPU). Draws the same scene
// model as the 2D renderer:
//   players: [{ id, team, color, char, x, z, vx, vz, swingAnim, swingKind, human }],
//   ball: { x, y, z, visible }, marker, serveBox, view: 'near' | 'far'
//
// Characters are rigged, animated humans (Adobe Mixamo rigs). Any Mixamo
// character can be added: see assets/characters/README.md.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as C from '../engine/constants.js';
import { charById } from './characters.js';

const CDN = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/';
// Built-in: an athletic mannequin shown in team kits. Its idle / walk / run clips
// drive every character, including custom Mixamo humans (retargeted per skeleton).
const BUILTIN = { xbot: CDN + 'Xbot.glb' };
const TEAM = ['#2f6fe0', '#f2652b', '#1fa971', '#8e5be8', '#e4b11a', '#e0457b'];
const FEET_PER_M = 3.28;

const U = new THREE.Vector3(0, 1, 0);
const F = new THREE.Vector3(0, 0, 1);
const R = new THREE.Vector3(-1, 0, 0);   // character's right in model space (models face +z)
const P = (u, f, r) => new THREE.Vector3().addScaledVector(U, u).addScaledVector(F, f).addScaledVector(R, r).normalize();
// [upper-arm direction, forearm direction] in model space
const READY = [P(-0.7, 0.45, 0.3), P(0.35, 0.9, 0.05)];
const SWINGS = {
  drive: [[P(-0.45, -0.45, 0.75), P(-0.1, -0.6, 0.8)], [P(-0.35, 0.75, 0.45), P(0.05, 0.95, 0.2)], [P(0.35, 0.6, -0.55), P(0.55, 0.2, -0.8)]],
  dink:  [[P(-0.8, 0.05, 0.55), P(-0.3, 0.6, 0.6)], [P(-0.7, 0.6, 0.3), P(-0.1, 0.95, 0.15)], [P(-0.45, 0.85, 0.1), P(0.35, 0.9, 0.05)]],
  lob:   [[P(-0.6, -0.4, 0.6), P(-0.5, -0.3, 0.6)], [P(-0.5, 0.75, 0.35), P(-0.05, 0.95, 0.2)], [P(0.75, 0.6, 0.15), P(0.95, 0.25, 0)]],
  smash: [[P(0.85, -0.3, 0.4), P(0.6, -0.75, 0.2)], [P(0.8, 0.5, 0.2), P(0.75, 0.65, 0)], [P(-0.3, 0.9, -0.35), P(-0.3, 0.6, -0.7)]],
};
const TWIST = [-0.55, 0.1, 0.6];
const ease = t => t * t * (3 - 2 * t);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _bw = new THREE.Quaternion(), _pw = new THREE.Quaternion(), _m1 = new THREE.Matrix4();

/** Is a real (hardware) GPU available for WebGL? */
export function probeGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { ok: false, gpu: 'none', software: true };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER));
    const software = /swiftshader|software|llvmpipe|basic render/i.test(gpu);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: !software, gpu, software };
  } catch { return { ok: false, gpu: 'error', software: true }; }
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let noiseTile = null;
/** Film grain by tiling a small noise canvas (a per-pixel pass over big textures froze startup). */
function grain(x, w, h, amt) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 128;
    const nx = noiseTile.getContext('2d'), img = nx.createImageData(128, 128), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 22; }
    nx.putImageData(img, 0, 0);
  }
  x.save();
  x.globalAlpha = Math.min(1, amt / 12);
  x.fillStyle = x.createPattern(noiseTile, 'repeat');
  x.fillRect(0, 0, w, h);
  x.restore();
}
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

// Geometry shared by every player (created once, never per player or per frame).
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const shape = new THREE.Shape(), w = 0.62, h = 0.9, r = 0.2;
  shape.moveTo(-w / 2 + r, 0); shape.lineTo(w / 2 - r, 0); shape.quadraticCurveTo(w / 2, 0, w / 2, r);
  shape.lineTo(w / 2, h - r); shape.quadraticCurveTo(w / 2, h, w / 2 - r, h); shape.lineTo(-w / 2 + r, h);
  shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r); shape.lineTo(-w / 2, r); shape.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  face.translate(0, 0.4, -0.018);
  SHARED = {
    grip: new THREE.CylinderGeometry(0.075, 0.07, 0.42, 10).translate(0, 0.21, 0),
    face,
    gripMat: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.8 }),
    ring: new THREE.RingGeometry(1.1, 1.32, 40).rotateX(-Math.PI / 2),
    blob: new THREE.CircleGeometry(0.95, 24).rotateX(-Math.PI / 2),
    blobMat: new THREE.MeshBasicMaterial({ color: 0x000814, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  return SHARED;
}
/**
 * Paint the mannequin as the chosen character. Regions come from the model's
 * bind-pose vertex positions (metres, T-pose): feet < 0.10, knees 0.53,
 * hips 1.04, neck 1.50, shoulders |x| 0.15, wrists |x| 0.71. One shared shader
 * program; each player only has its own colour uniforms.
 */
function paintCharacter(mat, look) {
  const col = c => new THREE.Color(c);
  const sleeve = look.top === 'hoodie' || look.top === 'jacket' ? 2 : look.top === 'tee' || look.top === 'polo' ? 1 : 0;
  const u = {
    uSkin: { value: col(look.skin) }, uTop: { value: col(look.topColor) }, uBottom: { value: col(look.bottomColor) },
    uShoes: { value: col(look.shoes) }, uInner: { value: col(look.inner || look.topColor) },
    uSleeve: { value: sleeve }, uCrop: { value: look.top === 'crop' ? 1 : 0 }, uJacket: { value: look.top === 'jacket' ? 1 : 0 },
    uFullLeg: { value: ['joggers', 'leggings', 'camo'].includes(look.bottom) ? 1 : 0 },
  };
  mat.color.set(0xffffff);
  mat.roughness = 0.62;
  mat.metalness = 0.02;
  mat.userData.look = u;
  mat.customProgramCacheKey = () => 'pickle-character-paint';
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uSkin, uTop, uBottom, uShoes, uInner;
uniform float uSleeve, uCrop, uJacket, uFullLeg;
vec3 regionColor(vec3 p) {
  float ax = abs(p.x);
  if (ax > 0.17 && p.y > 1.25) {                      // arms (T-pose)
    if (ax > 0.69) return uSkin;                      // hands
    if (uSleeve > 1.5) return uTop;                   // long sleeves
    if (uSleeve > 0.5 && ax < 0.30) return uTop;      // short sleeves
    return uSkin;
  }
  if (p.y > 1.47) return uSkin;                       // neck and head
  if (p.y > 0.98) {                                   // torso
    if (uCrop > 0.5 && p.y < 1.22) return uSkin;
    if (uJacket > 0.5 && ax < 0.055 && p.z > 0.0) return uInner;
    return uTop;
  }
  if (p.y > 0.60) return uBottom;                     // hips / shorts / skirt
  if (p.y > 0.10) return uFullLeg > 0.5 ? uBottom : uSkin;
  return uShoes;
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= regionColor(vBind);');
  };
  mat.needsUpdate = true;
}

/** Hair and headwear as simple meshes attached to the head bone (units: cm, bone space). */
function hairGroup(look, matFor) {
  const g = new THREE.Group(), hair = matFor(look.hairColor, 0.85), acc = matFor(look.accColor || '#ffffff', 0.6);
  const cap = (r, cut) => new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * cut);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx;
    m.castShadow = true; m.userData.shared = true; g.add(m); return m;
  };
  switch (look.hair) {
    case 'bald': break;
    case 'buzz': add(cap(11.3, 0.5), hair, 0, 9, 0.5); break;
    case 'curly': add(new THREE.IcosahedronGeometry(13, 1), hair, 0, 12, -0.5, 1, 0.82, 1); break;
    case 'swept': add(cap(11.8, 0.52), hair, 0, 9.5, 0); add(cap(9, 0.5), hair, 1.5, 16, 3, 1.1, 0.6, 1); break;
    default:
      add(cap(11.8, 0.55), hair, 0, 9, 0.5);
      if (look.hair === 'long') add(new THREE.BoxGeometry(21, 24, 5), hair, 0, -3, -8.5);
      if (look.hair === 'ponytail') add(new THREE.CylinderGeometry(2.6, 1.4, 16, 10), hair, 0, 4, -14, 1, 1, 1, 0.5);
      if (look.hair === 'bun') add(new THREE.SphereGeometry(5.5, 12, 10), hair, 0, 21, -5);
  }
  if (look.acc.includes('headband')) add(new THREE.CylinderGeometry(11.9, 11.9, 2.6, 24, 1, true), acc, 0, 13, 0.5);
  if (look.acc.includes('cap')) {
    add(cap(12.3, 0.5), acc, 0, 10, 0.5);
    add(new THREE.CylinderGeometry(9, 9, 0.8, 20, 1, false, -Math.PI / 2, Math.PI), acc, 0, 10.5, 6, 1, 1, 1.2);
  }
  if (look.acc.includes('beard')) add(cap(10.6, 0.35), matFor(look.accColor || look.hairColor, 0.9), 0, 6, 2.2, 1, 1, 1, Math.PI);
  return g;
}

// Scratch objects for the contact reach (no per-frame allocation).
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3(), _c4 = new THREE.Vector3();

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.aniso = r.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9cde0, 140, 520);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 1500);
    this.camera.position.set(0, 34, 52);
    this.look = new THREE.Vector3(0, 0, 0.5);
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;

    this.avatars = new Map();
    this._seen = new Set();
    this.matCache = new Map();
    this.quality = 'medium';
    this.progress = 0;
    this.gltf = {};
    this.manifest = {};
    this.time = 0;
    this.buildSky();
    this.buildLights();
    this.buildFloor();
    this.buildVenue();
    this.buildNet();
    this.buildBall();
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    document.fonts?.ready.then(() => { this.rebuildText?.(); });
    this.mergeStatic();
    // Static scenery never moves: skip its per-frame matrix updates.
    this.scene.traverse(o => { if (o !== this.scene && o !== this.ball && o !== this.marker && o !== this.serveBox) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this.modelsReady = this.loadModels();
  }

  /**
   * Merge static scenery meshes that share a material into one mesh each.
   * Same picture, far fewer draw calls (and shadow-pass draw calls).
   */
  mergeStatic() {
    const skip = new Set([this.ball, this.marker, this.serveBox]);
    const groups = new Map();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || skip.has(o) || Array.isArray(o.material) || o.material.transparent) return;
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map(o => {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.clearGroups();
        return g.applyMatrix4(o.matrixWorld);
      });
      if (!geos.every(g => g.attributes.uv) && geos.some(g => g.attributes.uv)) geos.forEach(g => g.deleteAttribute('uv'));
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      for (const o of list) { o.parent.remove(o); o.geometry.dispose(); }
      this.scene.add(mesh);
    }
  }

  /**
   * Finish loading and compile every shader before the 3D view is shown, so
   * nothing stalls later (the first skinned player, shadows, marker, serve box).
   */
  async prepare(onProgress) {
    const tick = setInterval(() => onProgress?.(0.85 * this.progress), 120);
    await this.modelsReady;
    clearInterval(tick);
    onProgress?.(0.9);
    const dummy = this.makeAvatar({ id: -1, team: 0, color: 0, char: 'ace' });
    this.marker.visible = this.serveBox.visible = true;
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
    else this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);   // uploads textures and shadow shaders now
    this.removeAvatar(dummy);
    this.marker.visible = this.serveBox.visible = false;
    onProgress?.(1);
  }

  /** 'high' | 'medium' | 'low' */
  setQuality(q) {
    this.quality = q;
    const hi = q === 'high', lo = q === 'low', r = this.renderer;
    const shadows = !lo, size = hi ? 2048 : 1024;
    if (r.shadowMap.enabled !== shadows || this.sun.shadow.mapSize.x !== size) {
      r.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
      this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    }
    this.scene.environment = lo ? null : this.envTex;
    if (this.crowd) for (const m of this.crowd) m.count = lo ? Math.floor(m.userData.full / 2) : m.userData.full;
    this.resize();
  }

  dispose() {
    removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  // -------------------------------------------------------------- models

  async loadModels() {
    const loader = new GLTFLoader();
    try {
      const res = await fetch('assets/characters/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = await res.json();
    } catch { /* no custom characters */ }
    const urls = { ...BUILTIN };
    for (const [id, file] of Object.entries(this.manifest)) urls['custom:' + id] = `assets/characters/${file}`;
    const prog = {};
    const total = Object.keys(urls).length;
    await Promise.all(Object.entries(urls).map(([key, url]) => new Promise(res => {
      loader.load(url, gltf => { this.gltf[key] = gltf; prog[key] = 1; res(); },
        e => { if (e.total) { prog[key] = e.loaded / e.total; this.progress = Object.values(prog).reduce((a, b) => a + b, 0) / total; } },
        err => { console.warn('Character model failed to load:', url, err); prog[key] = 1; res(); });
    })));
    this.progress = 1;
    // Locomotion clips come from the mannequin and drive every Mixamo rig.
    const src = this.gltf.xbot?.animations || [];
    this.clips = { idle: src.find(c => c.name === 'idle'), walk: src.find(c => c.name === 'walk'), run: src.find(c => c.name === 'run') };
    this.retargeted = new Map();
    for (const [id, a] of this.avatars) { this.removeAvatar(a); this.avatars.delete(id); }
  }

  /**
   * The mannequin's clip, converted for another Mixamo skeleton. Skeletons can
   * sit under differently rotated root nodes, so the hips' rotation and
   * position keys are re-expressed in the target's parent space.
   */
  clipFor(gltf, name) {
    const base = this.clips?.[name];
    if (!base || !this.gltf.xbot) return null;
    if (gltf === this.gltf.xbot) return base;
    const key = gltf.scene.uuid + name;
    if (this.retargeted.has(key)) return this.retargeted.get(key);
    const hipsOf = root => root.getObjectByName('mixamorigHips') || root.getObjectByName('mixamorig:Hips');
    const parentQuat = root => {
      root.updateMatrixWorld(true);
      const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      return rootInv.multiply(hipsOf(root).parent.getWorldQuaternion(new THREE.Quaternion()));
    };
    const qSrc = parentQuat(this.gltf.xbot.scene), qDst = parentQuat(gltf.scene);
    const conv = qDst.clone().invert().multiply(qSrc);   // source parent space -> target parent space
    const clip = base.clone();
    const tq = new THREE.Quaternion(), tv = new THREE.Vector3();
    for (const track of clip.tracks) {
      if (!/Hips\.(quaternion|position)$/.test(track.name)) continue;
      const v = track.values;
      if (track.name.endsWith('quaternion')) {
        for (let i = 0; i < v.length; i += 4) { tq.fromArray(v, i).premultiply(conv).toArray(v, i); }
      } else {
        for (let i = 0; i < v.length; i += 3) { tv.fromArray(v, i).applyQuaternion(conv).toArray(v, i); }
      }
    }
    this.retargeted.set(key, clip);
    return clip;
  }

  modelFor(charId) {
    if (this.gltf['custom:' + charId]) return this.gltf['custom:' + charId];
    return this.gltf.xbot;
  }

  // -------------------------------------------------------------- environment

  resize() {
    const w = innerWidth, h = innerHeight;
    const cap = this.quality === 'high' ? 2 : this.quality === 'low' ? 0.8 : 1.25;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.2 ? 62 : w / h < 1.5 ? 48 : 40;
    this.camera.updateProjectionMatrix();
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      uniforms: { top: { value: new THREE.Color('#2f6fb8') }, horizon: { value: new THREE.Color('#dfe9f1') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, horizon; varying vec3 vP; void main(){ float h = max(normalize(vP).y, 0.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.5)), 1.0); }',
    });
    for (const k of ['top', 'horizon']) mat.uniforms[k].value.convertLinearToSRGB();
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat));
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x30466b, 0.6));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1de, 2.4);
    sun.position.set(-36, 70, -30);   // back-left, so shadows fall toward the camera like TV coverage
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 42, bottom: -42, near: 30, far: 180 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    this.scene.add(sun);
  }

  /** Venue floor with the court, painted logos and lines in one crisp texture. */
  buildFloor() {
    const X0 = -40, X1 = 40, Z0 = -34, Z1 = 44, S = 26;   // area in feet, pixels per foot
    const W = (X1 - X0) * S, H = (Z1 - Z0) * S;
    const tex = canvasTex(W, H, (x) => {
      const px = v => (v - X0) * S, pz = v => (v - Z0) * S;
      x.fillStyle = '#2758a3'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#2d64b4'; x.fillRect(px(-10), pz(-22), 20 * S, 44 * S);
      x.fillStyle = '#4a86d2'; x.fillRect(px(-10), pz(-7), 20 * S, 14 * S);
      grain(x, W, H, 10);
      const text = (t, cx, cz, size, color, rot, weight = 900) => {
        x.save(); x.translate(px(cx), pz(cz)); x.rotate(rot);
        x.fillStyle = color; x.font = `${weight} ${size * S}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(t, 0, 0); x.restore();
      };
      text('PICKLE RALLY', 0, 3.6, 2.1, 'rgba(22,52,110,0.75)', 0);
      text('PICKLE RALLY', 0, -3.6, 2.1, 'rgba(22,52,110,0.75)', Math.PI);
      text('PICKLE RALLY', 0, 28, 2.6, 'rgba(255,255,255,0.92)', 0);
      text('WORLD TOUR', 0, 30.6, 1.1, 'rgba(255,255,255,0.9)', 0, 700);
      text('PICKLE RALLY', 0, -27, 2.2, 'rgba(255,255,255,0.85)', Math.PI);
      text('PICKLE RALLY', -13.4, 12, 1.5, 'rgba(255,255,255,0.88)', -Math.PI / 2);
      text('RALLY TOUR', -13.4, -12, 1.2, 'rgba(255,255,255,0.8)', -Math.PI / 2, 800);
      text('PICKLE RALLY', 13.4, 12, 1.5, 'rgba(255,255,255,0.88)', Math.PI / 2);
      text('RALLY TOUR', 13.4, -12, 1.2, 'rgba(255,255,255,0.8)', Math.PI / 2, 800);
      x.fillStyle = '#f5f7f9';
      const L = 2 / 12, line = (a, b, c, d) => x.fillRect(px(a), pz(b), Math.max(2, (c - a) * S), Math.max(2, (d - b) * S));
      line(-10, -22, -10 + L, 22); line(10 - L, -22, 10, 22);
      line(-10, -22, 10, -22 + L); line(-10, 22 - L, 10, 22);
      line(-10, -7, 10, -7 + L); line(-10, 7 - L, 10, 7);
      line(-L / 2, -22, L / 2, -7); line(-L / 2, 7, L / 2, 22);
    });
    tex.anisotropy = this.aniso;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0, envMapIntensity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: 0x47703f }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.3;
    this.scene.add(outer);

    const serveBox = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe6ff6a, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    serveBox.rotation.x = -Math.PI / 2; serveBox.position.y = 0.03; serveBox.visible = false;
    this.serveBox = serveBox;
    this.scene.add(serveBox);
  }

  buildVenue() {
    const s = this.scene;
    const mats = new Map();
    const std = (color, rough = 0.6, metal = 0) => {
      const key = `${color}|${rough}|${metal}`;
      if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
      return mats.get(key);
    };
    const box = (w, h, d, mat, x, y, z, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; s.add(m); return m;
    };
    const label = (w, h, bg, lines) => {
      const t = canvasTex(1024, Math.round(1024 * h / w), (x, W, H) => {
        x.fillStyle = bg; x.fillRect(0, 0, W, H); grain(x, W, H, 8);
        for (const [text, y, size, color, weight] of lines) {
          x.fillStyle = color; x.font = `${weight || 800} ${size * H}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(text, W / 2, y * H);
        }
      });
      t.anisotropy = this.aniso;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
    };

    // Back wall with the event branding.
    const wall = label(80, 9.5, '#102446', [['PICKLE RALLY', 0.35, 0.3, '#ffffff', 800], ['WORLD TOUR', 0.62, 0.15, '#c8f03c', 700], ['PICKLE RALLY  ·  OFFICIAL BALL', 0.86, 0.09, 'rgba(255,255,255,0.75)', 600]]);
    box(80, 9.5, 0.6, [std(0x102446), std(0x102446), std(0x1b335c), std(0x102446), wall, std(0x102446)], 0, 4.75, -34.3);

    // Barrier boards (magenta) on three sides.
    const boardMat = label(12, 2.6, '#d02a9c', [['PICKLE RALLY  ·  RALLY TOUR', 0.52, 0.5, '#ffffff', 800]]);
    const edge = std(0xe24fb1, 0.5);
    const board = (len, x, z, rotY) => {
      const n = Math.max(1, Math.round(len / 12));
      for (let i = 0; i < n; i++) {
        const seg = len / n, off = -len / 2 + seg * (i + 0.5);
        const m = new THREE.Mesh(new THREE.BoxGeometry(seg - 0.15, 2.6, 0.35), [edge, edge, edge, edge, boardMat, edge]);
        m.position.set(x + Math.cos(rotY) * off, 1.3, z - Math.sin(rotY) * off);
        m.rotation.y = rotY; m.castShadow = m.receiveShadow = true; s.add(m);
      }
    };
    board(28, 0, -31, 0);
    board(26, -17, -17, Math.PI / 2); board(22, -17, 15, Math.PI / 2);
    board(26, 17, -17, -Math.PI / 2); board(22, 17, 15, -Math.PI / 2);

    // Flower planters.
    const pot = std(0x1c1f24, 0.7), leaf = std(0x3f7d3a, 0.8), bloom = std(0xe65fa8, 0.6);
    for (const x of [-15, -12.5, 12.5, 15]) {
      box(1.1, 3, 1.1, pot, x, 1.5, -32.8);
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), i % 2 ? bloom : leaf);
        b.position.set(x + (Math.random() - 0.5) * 0.8, 3.2 + Math.random() * 0.4, -32.8 + (Math.random() - 0.5) * 0.8);
        s.add(b);
      }
    }

    // TV cameras on tripods.
    const black = std(0x1b1e22, 0.45, 0.3), lens = std(0x0d0f12, 0.2, 0.6);
    for (const [x, z] of [[22, -12], [22.5, 10]]) {
      for (const [dx, dz] of [[-0.9, 0.6], [0.9, 0.6], [0, -1]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.3, 6), black);
        leg.position.set(x + dx / 2, 2.6, z + dz / 2);
        leg.lookAt(x + dx, 0, z + dz); leg.rotateX(Math.PI / 2);
        leg.castShadow = true; s.add(leg);
      }
      const cam = box(1.6, 0.9, 0.8, black, x, 5.3, z);
      cam.lookAt(0, 4, z * 0.3);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 16), lens);
      l.rotation.x = Math.PI / 2; l.position.set(0, 0, 0.8); cam.add(l);
    }

    // Courtside lounge sofa.
    const white = std(0xf2f2f0, 0.8);
    box(2.8, 1.4, 6.4, white, -24, 0.7, -24);
    box(0.8, 1.6, 6.4, white, -25.0, 2.0, -24);
    box(2.8, 1.0, 0.6, white, -24, 1.7, -27.1);
    box(2.8, 1.0, 0.6, white, -24, 1.7, -20.9);

    // Grandstand with an instanced crowd.
    const rows = 5, depth = 2.8, rise = 1.4, seatsPer = 26;
    const concrete = std(0xd3d5d0, 0.9);
    for (let r = 0; r < rows; r++) box(depth, 1.6 + r * rise, 62, concrete, -27 - r * depth, (1.6 + r * rise) / 2, 0, false);
    const total = rows * seatsPer;
    // Low-poly spectators: they are small and distant, so detail would be wasted.
    const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.5, 1.2, 2, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), total);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), total);
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.4, 1.5), std(0x16305e, 0.6), total);
    const shirts = ['#d94141', '#3a7bd5', '#f2f2f2', '#2fa66b', '#f0b429', '#7b4bc4', '#222831', '#e86f2d', '#9aa3ad'];
    const skins = ['#f1c7a5', '#d9a27c', '#b07a52', '#8a5a3b', '#5e3b26'];
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (let r = 0; r < rows; r++) for (let i = 0; i < seatsPer; i++, n++) {
      const x = -27 - r * depth, y = 1.6 + r * rise, z = -28.5 + i * 2.3;
      m4.makeTranslation(x - 0.6, y + 0.7, z); seats.setMatrixAt(n, m4);
      const sit = Math.random() < 0.65;
      m4.makeTranslation(x, sit ? y + 1.1 : -50, z); bodies.setMatrixAt(n, m4);
      bodies.setColorAt(n, col.set(shirts[n % shirts.length]));
      m4.makeTranslation(x + 0.05, sit ? y + 2.45 : -50, z); heads.setMatrixAt(n, m4);
      heads.setColorAt(n, col.set(skins[(n * 7) % skins.length]));
    }
    bodies.userData.full = heads.userData.full = total;
    this.crowd = [bodies, heads];
    s.add(bodies, heads, seats);

    // Light towers.
    for (const x of [-21, 21]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 34, 10), std(0x3a3f45, 0.5, 0.5));
      pole.position.set(x, 17, -38); s.add(pole);
      const lamp = box(4, 1.6, 1.2, new THREE.MeshStandardMaterial({ color: 0x2a2e33, emissive: 0x4a4636 }), x * 0.95, 34, -37.5, false);
      lamp.lookAt(0, 0, 0);
    }
  }

  buildNet() {
    const s = this.scene;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.35, metalness: 0.75 });
    const panelTex = canvasTex(128, 192, (x, w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#c8f03c'; x.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.28);
      x.fillStyle = '#d02a9c'; x.fillRect(w * 0.15, h * 0.56, w * 0.7, h * 0.22);
    });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.1, 16), metal);
      post.position.set(sx * C.NET_HALF_SPAN, 1.55, 0); post.castShadow = true; s.add(post);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.85, 0.12), new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.5 }));
      panel.position.set(sx * C.NET_HALF_SPAN, 1.85, 0.12); panel.castShadow = true; s.add(panel);
    }
    const mesh = canvasTex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = 'rgba(16,18,22,0.95)'; x.lineWidth = 5; x.strokeRect(0, 0, w, h); });
    mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
    mesh.repeat.set(22 / 0.4, 3 / 0.4);
    mesh.anisotropy = this.aniso;
    const geo = new THREE.PlaneGeometry(2 * C.NET_HALF_SPAN, 1, 44, 1), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) > 0 ? C.netHeightAt(pos.getX(i)) - 0.08 : 0.12);
    geo.computeVertexNormals();
    const net = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: mesh, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 1 }));
    net.castShadow = true; s.add(net);
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0d1016, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
    const pts = [];
    for (let i = 0; i <= 30; i++) { const x = -C.NET_HALF_SPAN + (i / 30) * 2 * C.NET_HALF_SPAN; pts.push(new THREE.Vector3(x, C.netHeightAt(x) - 0.04, 0)); }
    const tape = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.075, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }));
    tape.castShadow = true; s.add(tape);
  }

  buildBall() {
    const tex = canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = '#dff23c'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#93a817';
      for (let i = 0; i < 40; i++) { x.beginPath(); x.arc((i * 53) % w, (i * 29) % h, 6, 0, 7); x.fill(); }
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * 1.6, 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0x2a3300 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0xf4ff8a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  // -------------------------------------------------------------- players

  /** Paddle using shared geometry and a material cached per team color. */
  makePaddle(color) {
    const sh = shared(), key = color.getHex();
    let mat = this.matCache.get(key);
    if (!mat) { mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 }); this.matCache.set(key, mat); }
    const g = new THREE.Group();
    const grip = new THREE.Mesh(sh.grip, sh.gripMat), face = new THREE.Mesh(sh.face, mat);
    grip.castShadow = face.castShadow = true;
    g.add(grip, face);
    return g;
  }

  makeAvatar(p) {
    const team = new THREE.Color(TEAM[p.color % TEAM.length]);
    const a = { yaw: p.team === 0 ? Math.PI : 0, arm: READY.map(v => v.clone()), twist: 0, team };
    const gltf = this.modelFor(p.char);
    const root = new THREE.Group();
    if (gltf) {
      const model = SkeletonUtils.clone(gltf.scene);
      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material = o.material.clone();
        // The mannequin is painted as the chosen character (skin, clothes, shoes).
        if (gltf === this.gltf.xbot) paintCharacter(o.material, charById(p.char));
      });
      model.scale.setScalar(FEET_PER_M);
      root.add(model);
      const mixer = new THREE.AnimationMixer(model);
      a.actions = {};
      for (const k of ['idle', 'walk', 'run']) {
        const clip = this.clipFor(gltf, k);
        if (!clip) continue;
        const act = mixer.clipAction(clip); act.play(); act.setEffectiveWeight(k === 'idle' ? 1 : 0); a.actions[k] = act;
      }
      a.mixer = mixer;
      const bone = n => model.getObjectByName(`mixamorig${n}`) || model.getObjectByName(`mixamorig:${n}`);
      a.bones = { arm: bone('RightArm'), fore: bone('RightForeArm'), hand: bone('RightHand'), spine: bone('Spine1') };
      const head = bone('Head');
      if (head && gltf === this.gltf.xbot) {
        const matFor = (color, rough) => {
          const key = `hair${color}|${rough}`;
          if (!this.matCache.has(key)) this.matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
          return this.matCache.get(key);
        };
        a.hair = hairGroup(charById(p.char), matFor);
        head.add(a.hair);
      }
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 3.6, 6, 12), new THREE.MeshStandardMaterial({ color: team, roughness: 0.6 }));
      body.position.y = 2.9; body.castShadow = true; body.userData.own = true; root.add(body);
    }
    a.root = root;
    a.paddle = this.makePaddle(team.clone().offsetHSL(0, -0.05, 0.08));
    const sh = shared(), rk = 'ring' + team.getHex();
    if (!this.matCache.has(rk)) this.matCache.set(rk, new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    a.ring = new THREE.Mesh(sh.ring, this.matCache.get(rk));
    a.blob = new THREE.Mesh(sh.blob, sh.blobMat);   // soft contact shadow, also used when real shadows are off
    a.goal = [new THREE.Vector3(), new THREE.Vector3()];
    this.scene.add(root, a.paddle, a.ring, a.blob);
    return a;
  }

  /** Remove a player and free everything it owns (cloned materials, mixer caches). */
  removeAvatar(a) {
    this.scene.remove(a.root, a.paddle, a.ring, a.blob);
    if (a.mixer) { a.mixer.stopAllAction(); a.mixer.uncacheRoot(a.mixer.getRoot()); }
    a.root.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData.shared) { o.geometry.dispose(); return; }   // hair: own geometry, cached material
      [].concat(o.material).forEach(m => m.dispose());   // materials were cloned per player
      if (o.isSkinnedMesh) o.skeleton.dispose();         // each cloned skeleton owns a bone texture
      if (o.userData.own) o.geometry.dispose();          // model geometry is shared with the loaded file
    });
  }

  updateAvatar(a, p, ball, dt) {
    const speed = Math.hypot(p.vx, p.vz);
    const netYaw = p.team === 0 ? Math.PI : 0;
    const ballNear = ball.visible && Math.hypot(ball.x - p.x, ball.z - p.z) < 12;
    const target = speed > 3.5 && !ballNear && p.swingAnim <= 0 ? Math.atan2(p.vx, p.vz) : netYaw;
    let d = target - a.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    a.yaw += d * Math.min(1, dt * 10);
    a.root.position.set(p.x, 0, p.z);
    a.root.rotation.y = a.yaw;
    a.ring.visible = !!p.human;
    a.ring.position.set(p.x, 0.05, p.z);
    a.blob.position.set(p.x, 0.04, p.z);

    if (!a.mixer) {
      a.paddle.position.set(p.x + 0.9, 3.2, p.z);
      return;
    }
    const wIdle = Math.max(0, 1 - speed / 3), wWalk = speed < 3 ? speed / 3 : Math.max(0, (8 - speed) / 5), wRun = Math.min(1, Math.max(0, (speed - 3) / 5));
    a.actions.idle?.setEffectiveWeight(wIdle);
    a.actions.walk?.setEffectiveWeight(wWalk);
    a.actions.run?.setEffectiveWeight(wRun);
    if (a.actions.walk) a.actions.walk.timeScale = Math.min(1.6, Math.max(0.6, speed / 4.6));
    if (a.actions.run) a.actions.run.timeScale = Math.min(1.35, Math.max(0.75, speed / 12));
    a.mixer.update(dt);
    a.root.updateMatrixWorld(true);

    let goal = READY, twist = 0;
    if (p.swingAnim > 0) {
      const t0 = 1 - p.swingAnim / C.SWING_ANIM, k = SWINGS[p.swingKind] || SWINGS.drive;
      const seg = t0 < 0.35 ? [READY, k[0], t0 / 0.35, 0, TWIST[0]] : t0 < 0.55 ? [k[0], k[1], (t0 - 0.35) / 0.2, TWIST[0], TWIST[1]] : [k[1], k[2], (t0 - 0.55) / 0.45, TWIST[1], TWIST[2]];
      const t = ease(seg[2]);
      a.goal[0].copy(seg[0][0]).lerp(seg[1][0], t).normalize();
      a.goal[1].copy(seg[0][1]).lerp(seg[1][1], t).normalize();
      goal = a.goal;
      twist = seg[3] + (seg[4] - seg[3]) * t;
    } else if (speed > 3) {
      // while running, let the run animation swing the arm (blend the paddle arm only lightly)
      goal = null;
    }
    const k = p.swingAnim > 0 ? 1 : Math.min(1, dt * 8);
    a.twist += (twist - a.twist) * k;
    const { arm, fore, hand, spine } = a.bones;
    if (spine) rotateBoneWorld(spine, _q1.setFromAxisAngle(U, a.twist));
    if (goal) {
      a.arm.forEach((v, i) => v.lerp(goal[i], k).normalize());
      const twistQ = _q2.setFromAxisAngle(U, a.yaw + a.twist);
      if (arm && fore) pointBone(arm, fore, _v1.copy(a.arm[0]).applyQuaternion(twistQ));
      if (fore && hand) pointBone(fore, hand, _v1.copy(a.arm[1]).applyQuaternion(twistQ));
    }
    // Around the moment of contact, reach the arm and paddle to the ball's real position.
    if (p.swingAnim > 0 && p.contact && arm && fore && hand) {
      const t = 1 - p.swingAnim / C.SWING_ANIM, w = Math.max(0, 1 - Math.abs(t - 0.45) / 0.22);
      if (w > 0) {
        const target = _c1.set(p.x + p.contact.x, p.contact.y, p.z + p.contact.z), e = ease(w);
        const sh = arm.getWorldPosition(_c2);
        const cur = fore.getWorldPosition(_c3).sub(sh).normalize();
        pointBone(arm, fore, cur.lerp(_c4.copy(target).sub(sh).normalize(), e).normalize());
        const el = fore.getWorldPosition(_c2);
        const cur2 = hand.getWorldPosition(_c3).sub(el).normalize();
        pointBone(fore, hand, cur2.lerp(_c4.copy(target).sub(el).normalize(), e).normalize());
      }
    }
    if (hand && fore) {
      const hp = hand.getWorldPosition(_v1);
      const dir = fore.getWorldPosition(_v2).sub(hp).negate().normalize();
      const front = _v3.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      const nrm = front.addScaledVector(dir, -front.dot(dir)).normalize();
      a.paddle.quaternion.setFromRotationMatrix(_m1.makeBasis(_v4.crossVectors(dir, nrm), dir, nrm));
      a.paddle.position.copy(hp).addScaledVector(dir, 0.1);
    }
  }

  // -------------------------------------------------------------- frame

  update(model, dt) {
    this.time += dt;
    const flip = model.view === 'far' ? -1 : 1;
    const seen = this._seen;
    seen.clear();
    const ready = !!this.clips;
    for (const p of model.players) {
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a || a.char !== p.char || a.color !== p.color || a.ready !== ready) {
        if (a) this.removeAvatar(a);
        a = this.makeAvatar(p);
        a.char = p.char; a.color = p.color; a.ready = ready;
        this.avatars.set(p.id, a);
      }
      this.updateAvatar(a, p, model.ball, Math.min(dt, 0.05));
    }
    for (const [id, a] of this.avatars) if (!seen.has(id)) { this.removeAvatar(a); this.avatars.delete(id); }

    const b = model.ball;
    this.ball.visible = !!b.visible;
    if (b.visible) { this.ball.position.set(b.x, b.y + C.BALL_R * 0.6, b.z); this.ball.rotation.x += dt * 9; }
    this.marker.visible = !!model.marker;
    if (model.marker) { this.marker.position.set(model.marker.x, 0.06, model.marker.z); this.marker.scale.setScalar(1 + 0.12 * Math.sin(this.time * 9)); }
    this.serveBox.visible = !!model.serveBox;
    if (model.serveBox) { const sb = model.serveBox; this.serveBox.position.set(sb.x, 0.04, sb.z); this.serveBox.scale.set(sb.w, sb.d, 1); }

    // Broadcast camera behind the near baseline (mirrored for the online guest).
    const human = model.players.find(p => p.human);
    const fx = human ? human.x : 0;
    _v1.set(fx * 0.25, 34, flip * 52);   // high broadcast angle
    _v2.set(fx * 0.2, 0, flip * 0.5);
    const kk = 1 - Math.exp(-dt * 5);
    this.camera.position.lerp(_v1, kk);
    this.look.lerp(_v2, kk);
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  }
}

function pointBone(bone, child, dirWorld) {
  const bp = bone.getWorldPosition(_v3);
  const cur = child.getWorldPosition(_v4).sub(bp).normalize();
  rotateBoneWorld(bone, _bq.setFromUnitVectors(cur, dirWorld.normalize()));
}

function rotateBoneWorld(bone, qWorld) {
  const boneWorld = bone.getWorldQuaternion(_bw);
  const parentWorld = bone.parent.getWorldQuaternion(_pw);
  bone.quaternion.copy(parentWorld.invert().multiply(qWorld).multiply(boneWorld));
  bone.updateMatrixWorld(true);
}
