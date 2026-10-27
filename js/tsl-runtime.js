// TSL (Three.js Shading Language) runtime for the IRMF editor.
//
// A TSL body is JavaScript that builds a node graph. This module evaluates the
// body with the names exported by `three/tsl` injected as lexical bindings,
// builds a MeshBasicNodeMaterial that samples all material values at
// `positionWorld`, and renders one instanced plane per slice with a modern
// three.js WebGPURenderer (which falls back to WebGL2 when WebGPU is absent).
//
// It coexists with the editor's legacy three.js r110 renderer, which keeps
// drawing the HUD and axes on its own canvas.

import {
  WebGPURenderer,
  MeshBasicNodeMaterial,
  Scene,
  Object3D,
  InstancedMesh,
  PlaneGeometry,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  Vector4,
  LinearSRGBColorSpace,
  NoToneMapping,
  DoubleSide,
  NormalBlending,
} from 'three/webgpu';
import * as TSL from 'three/tsl';

import { evaluateTSL, callEntry } from './vendor/irmf-tsl/eval.mjs';

export const TSL_THREE_VERSION = '0.180.0';

const ENTRY_BY_MATERIALS = (n) => {
  if (n >= 1 && n <= 4) return 'mainModel4';
  if (n >= 5 && n <= 9) return 'mainModel9';
  if (n >= 10 && n <= 16) return 'mainModel16';
  return null;
};

const nd = (x) => (typeof x === 'number' ? TSL.float(x) : x);

function hsvNode(h, s, v) {
  h = nd(h); s = nd(s); v = nd(v);
  const k = (offset) => TSL.mod(h.mul(6).add(offset), 6);
  const f = (kk) =>
    v.sub(
      v.mul(s).mul(
        TSL.max(TSL.min(kk, TSL.min(TSL.float(4).sub(kk), TSL.float(1))), TSL.float(0))
      )
    );
  const k5 = k(5), k3 = k(3), k1 = k(1);
  const f5 = f(k5), f3 = f(k3), f1 = f(k1);
  return TSL.vec4(f5, f3, f1, TSL.max(f5, TSL.max(f3, f1)));
}

function hslNode(h, s, l) {
  h = nd(h); s = nd(s); l = nd(l);
  const a = s.mul(TSL.min(l, TSL.float(1).sub(l)));
  const k = (offset) => TSL.mod(h.mul(12).add(offset), 12);
  const f = (kk) =>
    l.sub(
      a.mul(
        TSL.max(
          TSL.min(kk.sub(3), TSL.min(TSL.float(9).sub(kk), TSL.float(1))),
          TSL.float(-1)
        )
      )
    );
  const k0 = k(0), k8 = k(8), k4 = k(4);
  const f0 = f(k0), f8 = f(k8), f4 = f(k4);
  return TSL.vec4(f0, f8, f4, TSL.max(f0, TSL.max(f8, f4)));
}

/** Return the material values as an array of scalar nodes. */
function materialValues(raw, count) {
  if (Array.isArray(raw)) return raw;
  if (!raw || !raw.isNode) {
    throw new Error('entry point must return an array of nodes or a vector/matrix node');
  }
  if (count <= 4) {
    return ['x', 'y', 'z', 'w'].slice(0, count).map((k) => raw[k]);
  }
  // mat3/mat4: column-major, matching the slicer footers.
  const dim = count <= 9 ? 3 : 4;
  const out = [];
  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / dim);
    const row = i % dim;
    const c = raw.element ? raw.element(col) : raw[col];
    out.push(c && c.element ? c.element(row) : c[row]);
  }
  return out;
}

export async function createRuntime(opts = {}) {
  const {
    canvas,
    log = () => {},
    forceWebGL = false,
    getUniforms,
    getRangeValues,
    getResolution,
    getModelTransform,
  } = opts;

  const state = {
    status: 'idle',
    material: null,
    geometry: null,
    mesh: null,
    scene: null,
    root: null,
    resolution: 0,
    rangeKey: '',
    valuesCount: 0,
    entry: null,
    disposed: false,
  };

  const uniforms = {
    u_ll: TSL.uniform(new Vector3(-1, -1, -1)),
    u_ur: TSL.uniform(new Vector3(1, 1, 1)),
    u_diag: TSL.uniform(2),
    u_minD: TSL.uniform(-1),
    u_step: TSL.uniform(0.01),
    colors: Array.from({ length: 16 }, () => TSL.uniform(new Vector4(1, 1, 1, 1))),
  };

  let renderer = null;
  // Mirror the legacy camera by copying its parameters and letting three
  // recompute the matrices. Copying matrixWorld/matrixWorldInverse directly is
  // fragile: the renderer may recompute them, and r110 builds differ in which
  // inverse matrices they provide.
  let perspCamera = null;
  let orthoCamera = null;
  let activeCamera = null;

  async function init() {
    renderer = new WebGPURenderer({ canvas, alpha: true, forceWebGL });
    await renderer.init();
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.setSize(canvas.width, canvas.height, false);

    perspCamera = new PerspectiveCamera(75, canvas.width / Math.max(1, canvas.height), 0.1, 1e6);
    orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1e6);
    activeCamera = perspCamera;

    state.scene = new Scene();
    state.root = new Object3D();
    state.scene.add(state.root);
    state.status = 'ready';
    log(`TSL: three.js ${TSL_THREE_VERSION} renderer ready (${renderer.backend ? renderer.backend.constructor.name : 'backend'}).`);
  }

  function disposeModel() {
    if (state.mesh && state.root) state.root.remove(state.mesh);
    if (state.mesh) {
      state.mesh.dispose?.();
    }
    if (state.geometry) state.geometry.dispose();
    if (state.material) state.material.dispose();
    state.mesh = null;
    state.geometry = null;
    state.material = null;
  }

  function buildColorTerms(colorModel, values) {
    const terms = [];
    const valueAt = (n) => values[n - 1];

    for (const [h, s, v] of colorModel.hsv || []) terms.push(hsvNode(valueAt(h), valueAt(s), valueAt(v)));
    for (const [h, s, l] of colorModel.hsl || []) terms.push(hslNode(valueAt(h), valueAt(s), valueAt(l)));
    for (const [r, g, b] of colorModel.rgb || []) {
      const rr = valueAt(r), gg = valueAt(g), bb = valueAt(b);
      terms.push(TSL.vec4(rr, gg, bb, TSL.max(rr, TSL.max(gg, bb))));
    }
    for (const plain of colorModel.plain || []) {
      terms.push(uniforms.colors[plain.color - 1].mul(valueAt(plain.index)));
    }

    let sum = TSL.vec4(0, 0, 0, 0);
    for (const t of terms) sum = sum.add(t);
    return sum;
  }

  function computeRange() {
    const rv = getRangeValues ? getRangeValues() : null;
    const ll = new Vector3(rv ? rv.llx : -1, rv ? rv.lly : -1, rv ? rv.llz : -1);
    const ur = new Vector3(rv ? rv.urx : 1, rv ? rv.ury : 1, rv ? rv.urz : 1);
    const center = ll.clone().add(ur).multiplyScalar(0.5);
    const halfDiag = center.distanceTo(ll) || 1;
    return { ll, ur, center, halfDiag, diagonal: 2 * halfDiag };
  }

  function rebuildGeometry() {
    if (!state.material) return;
    const { ll, ur, center, halfDiag, diagonal } = computeRange();
    const res = Math.max(1, Math.round(getResolution ? getResolution() : 64));

    uniforms.u_ll.value.set(ll.x, ll.y, ll.z);
    uniforms.u_ur.value.set(ur.x, ur.y, ur.z);
    uniforms.u_diag.value = diagonal;
    uniforms.u_minD.value = -halfDiag;
    uniforms.u_step.value = diagonal / Math.max(1, res - 1);

    if (state.mesh) state.root.remove(state.mesh);
    state.mesh?.dispose?.();
    if (state.geometry) state.geometry.dispose();

    state.geometry = new PlaneGeometry(1, 1);
    state.mesh = new InstancedMesh(state.geometry, state.material, res);
    state.mesh.frustumCulled = false;
    const identity = new Matrix4();
    for (let i = 0; i < res; i++) state.mesh.setMatrixAt(i, identity);
    state.mesh.instanceMatrix.needsUpdate = true;
    state.root.add(state.mesh);

    state.resolution = res;
    const rv = getRangeValues ? getRangeValues() : {};
    state.rangeKey = `${rv.llx},${rv.lly},${rv.llz},${rv.urx},${rv.ury},${rv.urz}`;

    if (getModelTransform) {
      const t = getModelTransform();
      if (t) {
        state.root.position.copy(t.position);
        state.root.quaternion.copy(t.quaternion);
      }
    }
  }

  async function load(source, colorModel) {
    if (state.disposed) throw new Error('runtime disposed');
    if (!renderer) await init();

    const cm = typeof colorModel === 'string' ? JSON.parse(colorModel || '{}') : colorModel || {};
    const count = Array.isArray(cm.materials) ? cm.materials.length : 1;
    const entryName = ENTRY_BY_MATERIALS(count);
    if (!entryName) throw new Error(`unsupported material count: ${count}`);

    const ev = evaluateTSL(source, TSL);
    if (ev.diagnostics.length) {
      const d = ev.diagnostics[0];
      const err = new Error(d.message);
      err.line = d.line;
      err.col = d.col;
      throw err;
    }
    const entryFn = ev.entries[entryName];
    if (typeof entryFn !== 'function') {
      const err = new Error(`missing entry point \`${entryName}\` (materials=${count})`);
      err.line = 1;
      throw err;
    }
    for (const w of ev.warnings) log('TSL: ' + w);

    disposeModel();

    // The world-space sample point, computed in the vertex stage.
    const localPos = TSL.vec3(
      TSL.positionGeometry.x.mul(uniforms.u_diag),
      TSL.positionGeometry.y.mul(uniforms.u_diag),
      uniforms.u_minD.add(TSL.float(TSL.instanceIndex).mul(uniforms.u_step))
    );
    const xyz = TSL.modelWorldMatrix.mul(localPos).xyz.toVarying('tsl_v_xyz');
    // Normalized slice position i/(N-1), matching the GLSL renderer's u_d.
    const sliceD = TSL.float(TSL.instanceIndex)
      .mul(uniforms.u_step)
      .div(uniforms.u_diag)
      .toVarying('tsl_v_d');

    const raw = callEntry(entryFn, xyz);
    const values = materialValues(raw, count);
    if (values.length !== count) {
      throw new Error(`entry point \`${entryName}\` returned ${values.length} values but ${count} materials are declared`);
    }
    state.valuesCount = count;

    const mixed = buildColorTerms(cm, values);
    const inBounds = TSL.all(xyz.greaterThanEqual(uniforms.u_ll)).and(
      TSL.all(xyz.lessThanEqual(uniforms.u_ur))
    );
    const outColor = TSL.select(inBounds, mixed.mul(sliceD), TSL.vec4(0, 0, 0, 0));

    const material = new MeshBasicNodeMaterial({
      transparent: true,
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      blending: NormalBlending,
    });
    material.positionNode = localPos;
    material.fragmentNode = outColor;
    state.material = material;
    state.entry = entryName;

    rebuildGeometry();
    state.status = 'loaded';
    log(`TSL: loaded ${entryName} for ${count} material${count === 1 ? '' : 's'}.`);
  }

  function mirrorCamera(src) {
    if (!src) return;
    const cam = src.isOrthographicCamera ? orthoCamera : perspCamera;
    cam.position.copy(src.position);
    cam.quaternion.copy(src.quaternion);
    if (cam.up && src.up) cam.up.copy(src.up);
    cam.near = src.near;
    cam.far = src.far;
    if (src.zoom !== undefined) cam.zoom = src.zoom;

    if (src.isOrthographicCamera) {
      cam.left = src.left;
      cam.right = src.right;
      cam.top = src.top;
      cam.bottom = src.bottom;
    } else {
      cam.fov = src.fov;
      cam.aspect = src.aspect;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    activeCamera = cam;
  }

  function syncUniforms() {
    const rv = getRangeValues ? getRangeValues() : null;
    if (rv) {
      uniforms.u_ll.value.set(rv.llx, rv.lly, rv.llz);
      uniforms.u_ur.value.set(rv.urx, rv.ury, rv.urz);
    }
    const u = getUniforms ? getUniforms() : null;
    if (u) {
      for (let i = 1; i <= 16; i++) {
        const src = u[`u_color${i}`] && u[`u_color${i}`].value;
        if (src) uniforms.colors[i - 1].value.set(src.x, src.y, src.z, src.w);
      }
    }
  }

  function render(srcCamera) {
    if (!renderer || !state.scene) return;
    const res = Math.max(1, Math.round(getResolution ? getResolution() : state.resolution));
    const rv = getRangeValues ? getRangeValues() : {};
    const rangeKey = `${rv.llx},${rv.lly},${rv.llz},${rv.urx},${rv.ury},${rv.urz}`;
    if (res !== state.resolution || rangeKey !== state.rangeKey) rebuildGeometry();

    if (getModelTransform) {
      const t = getModelTransform();
      if (t) {
        state.root.position.copy(t.position);
        state.root.quaternion.copy(t.quaternion);
      }
    }
    syncUniforms();
    mirrorCamera(srcCamera);
    renderer.clear();
    renderer.render(state.scene, activeCamera);
  }

  function resize() {
    if (!renderer) return;
    renderer.setSize(canvas.width, canvas.height, false);
    if (perspCamera) perspCamera.aspect = canvas.width / Math.max(1, canvas.height);
  }

  function unload() {
    disposeModel();
    state.entry = null;
    state.status = 'idle';
  }

  function dispose() {
    state.disposed = true;
    disposeModel();
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    state.status = 'disposed';
  }

  const api = {
    get status() {
      return state.status;
    },
    get entry() {
      return state.entry;
    },
    // Test/diagnostic hook: the camera actually used for the last frame.
    get debug() {
      return {
        status: state.status,
        camera: activeCamera
          ? {
              position: activeCamera.position.toArray(),
              quaternion: activeCamera.quaternion.toArray(),
            }
          : null,
      };
    },
    init,
    load,
    unload,
    render,
    resize,
    dispose,
  };

  return api;
}
