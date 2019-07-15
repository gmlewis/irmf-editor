'use strict';
/* global THREE */

// Split panels...

Split(['#one', '#two']);
const twoDiv = document.getElementById('two');

// Get A WebGL context
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl2');
if (!gl) {
  console.log('Browser does not support WebGL2!');
}

// Set up Monaco editor...

require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.17.1/min/vs' } });

// Before loading vs/editor/editor.main, define a global MonacoEnvironment that overwrites
// the default worker url location (used when creating WebWorkers). The problem here is that
// HTML5 does not allow cross-domain web workers, so we need to proxy the instantiation of
// a web worker through a same-domain script
window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
    self.MonacoEnvironment = {
      baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.17.1/min/'
    };
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.17.1/min/vs/base/worker/workerMain.js');`
    )}`;
  }
};

let goCompileCallback = null;
let decorations = [];
let compileShader = function () {
  if (goCompileCallback == null) {
    console.log('TODO: Compile shader.');
  } else {
    // Clear decorations.
    decorations = editor.deltaDecorations(decorations, []);
    goCompileCallback();
  }
};
function installCompileShader(cb) {
  goCompileCallback = cb;
}
let goSliceCallback = null;
function installSliceShader(cb) {
  goSliceCallback = cb;
}

let editor = null;
function highlightShaderError(line) {
  decorations = editor.deltaDecorations([], [
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'contentErrorClass',
        glyphMarginClassName: 'glyphMarginErrorClass'
      }
    }
  ]);
}
function getEditor() { return editor; }
require(["vs/editor/editor.main"], function () {
  monaco.editor.defineTheme('myCustomTheme', {
    base: 'vs-dark', // can also be vs or hc-black
    inherit: true, // can also be false to completely replace the builtin rules
    rules: [
      { token: 'comment', foreground: 'ffa500', fontStyle: 'italic underline' },
      { token: 'comment.js', foreground: '008800', fontStyle: 'bold' },
      { token: 'comment.css', foreground: '0000ff' } // will inherit fontStyle from `comment` above
    ]
  });
  editor = monaco.editor.create(document.getElementById('one'), {
    value: '',
    language: 'javascript',
    scrollBeyondLastLine: false,
    theme: "myCustomTheme",
    minimap: {
      enabled: false
    },
    glyphMargin: true
  });
  editor.updateOptions({ wordWrap: "on" });

  // Add Ctrl/Cmd-Enter to render updated model:
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, compileShader);
  // Also support Ctrl/Cmd-s just out of sheer habit, but don't advertize this
  // because it's not actually saving the shader anywhere... just compiling it.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, compileShader);

  console.log('editor started');
  function twoDivResized() {
    canvas.width = twoDiv.offsetWidth;
    canvas.height = twoDiv.offsetHeight - 100; // Keep in sync with 'logf' div height.
    editor.layout();
    onCanvasResize();
  }
  new ResizeObserver(twoDivResized).observe(twoDiv);
});

// Rendering...

const vs = `#version 300 es
// A matrix to transform the positions.
uniform vec3 u_ll;
uniform vec3 u_ur;
uniform mat4 u_matrix;
out vec4 v_xyz;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  v_xyz = modelMatrix * vec4( position, 1.0 );
}
`;
const fsHeader = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 u_ll;
uniform vec3 u_ur;
// uniform vec3 u_resolution;
// uniform float u_resolution;
uniform float u_d;
uniform int u_numMaterials;
uniform vec4 u_color1;
uniform vec4 u_color2;
uniform vec4 u_color3;
uniform vec4 u_color4;
uniform vec4 u_color5;
uniform vec4 u_color6;
uniform vec4 u_color7;
uniform vec4 u_color8;
uniform vec4 u_color9;
uniform vec4 u_color10;
uniform vec4 u_color11;
uniform vec4 u_color12;
uniform vec4 u_color13;
uniform vec4 u_color14;
uniform vec4 u_color15;
uniform vec4 u_color16;
in vec4 v_xyz;
out vec4 out_FragColor;
`;
const fsFooter = `
void main() {
  if (any(lessThanEqual(abs(v_xyz.xyz),u_ll))) {
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThanEqual(abs(v_xyz.xyz),u_ur))) {
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }

  float d = u_d;

  if (u_numMaterials <= 4) {
    vec4 materials;
    mainModel4(materials, v_xyz.xyz);
    out_FragColor = d*(u_color1*materials.x + u_color2*materials.y + u_color3*materials.z + u_color4*materials.w);
    // out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
    // out_FragColor = vec4(vec3(d), 1.);  // DEBUG
  // } else if (u_numMaterials <= 9) {

  // } else if (u_numMaterials <= 16) {

  }
}
`;

let scene = new THREE.Scene();
const hudScene = new THREE.Scene();
let fullViewport = new THREE.Vector4();
let hudViewport = new THREE.Vector4();
const hudSize = 256;

const fov = 75.0;
let aspectRatio = canvas.width / canvas.height;
console.log('canvas: (' + canvas.width.toString() + ',' + canvas.height.toString() + '), aspectRatio=' + aspectRatio.toString());
let activeCamera = null;
let hudActiveCamera = null;
const cameraPerspective = new THREE.PerspectiveCamera(fov, aspectRatio, 0.1, 1000);
let resetCameraD = 5.0;
let frustumSize = 1.0;
const hudFrustumSize = 1.25;
const cameraOrthographic = new THREE.OrthographicCamera(
  -aspectRatio * frustumSize, aspectRatio * frustumSize, frustumSize, -frustumSize, 0.1, 1000);
const hudCameraPerspective = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
const hudCameraOrthographic = new THREE.OrthographicCamera(
  -hudFrustumSize, hudFrustumSize, hudFrustumSize, -hudFrustumSize, 0.1, 1000);

let renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl });
renderer.setSize(canvas.width, canvas.height);
renderer.autoClear = false;

// // Probably not needed at all:
// const light = new THREE.DirectionalLight(0xFFFFFF, 1);
// light.position.set(-1, 2, 4);
// scene.add(light);

const uniforms = {
  u_ll: { type: 'v3', value: new THREE.Vector3() }, // MBB min
  u_ur: { type: 'v3', value: new THREE.Vector3() },  // MBB max
  u_matrix: { type: 'm4', value: new THREE.Matrix4() },
  // u_resolution: { type: 'v3', value: new THREE.Vector3() },
  u_resolution: { type: 'float', value: 512.0 },
  u_numMaterials: { type: 'int', value: 1 },
  u_d: { type: 'float', value: 0.0 },
  // TODO: Make all the colors configurable through the GUI.
  u_color1: { type: 'v4', value: new THREE.Vector4(1, 0, 0, 1) },
  u_color2: { type: 'v4', value: new THREE.Vector4(0, 1, 0, 1) },
  u_color3: { type: 'v4', value: new THREE.Vector4(0, 0, 1, 1) },
  u_color4: { type: 'v4', value: new THREE.Vector4(1, 1, 0, 1) },
  u_color5: { type: 'v4', value: new THREE.Vector4(0, 1, 1, 1) },
  u_color6: { type: 'v4', value: new THREE.Vector4(1, 0, 1, 1) },
  u_color7: { type: 'v4', value: new THREE.Vector4(1) },
  u_color8: { type: 'v4', value: new THREE.Vector4(1) },
  u_color9: { type: 'v4', value: new THREE.Vector4(1) },
  u_color10: { type: 'v4', value: new THREE.Vector4(1) },
  u_color11: { type: 'v4', value: new THREE.Vector4(1) },
  u_color12: { type: 'v4', value: new THREE.Vector4(1) },
  u_color13: { type: 'v4', value: new THREE.Vector4(1) },
  u_color14: { type: 'v4', value: new THREE.Vector4(1) },
  u_color15: { type: 'v4', value: new THREE.Vector4(1) },
  u_color16: { type: 'v4', value: new THREE.Vector4(1) },
};
function copyUniforms() {
  let copy = {};
  let keys = Object.keys(uniforms);
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];
    copy[key] = { type: uniforms[key].type, value: uniforms[key].value };
  }
  return copy;
}

// let materials = [];
let modelCentroidNull = null;
// let modelMeshes = [];
let compilerSource = '';
function loadNewModel(source) {
  console.log("Compiling new model.");
  // TODO: Check https://github.com/mrdoob/three.js/pull/6818
  // and https://github.com/mrdoob/three.js/pull/6963
  // for getting the GLSL compiler errors and report them in the editor.
  compilerSource = source;
  // for (let i = 0; i < modelMeshes.length; i++) {
  //   let material = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fsHeader + source + fsFooter, side: THREE.DoubleSide, transparent: true });
  //   material.
  //   modelMeshes[i].material = material;
  // }
  // material.needsUpdate = true;
  let ll = uniforms.u_ll.value;
  let ur = uniforms.u_ur.value;
  setMBB(ll.x, ll.y, ll.z, ur.x, ur.y, ur.z);
  render();
}

function getLookAt() {
  const ll = uniforms.u_ll.value;
  const ur = uniforms.u_ur.value;
  const cx = 0.5 * (ll.x + ur.x);
  const cy = 0.5 * (ll.y + ur.y);
  const cz = 0.5 * (ll.z + ur.z);
  return [cx, cy, cz];
}
function setMBB(llx, lly, llz, urx, ury, urz) {
  uniforms.u_ll.value.set(llx, lly, llz);
  uniforms.u_ur.value.set(urx, ury, urz);
  let maxval = (urx > ury) ? ury : ury;
  maxval = (maxval > urz) ? maxval : urz;
  resetCameraD = maxval;

  const diagonal = new THREE.Vector3().subVectors(uniforms.u_ur.value, uniforms.u_ll.value).length();

  scene.dispose();  // This alone is not enough. Need to create a brand new scene.
  scene = new THREE.Scene();  // Eventually add a light?
  // modelMeshes = [];

  modelCentroidNull = new THREE.Object3D()
  scene.add(modelCentroidNull);
  // modelCentroidNull.add(new THREE.AxesHelper(diagonal));  // for debugging
  // TODO: make this a GUI option:
  scene.add(new THREE.AxesHelper(diagonal));

  const dStep = diagonal / (uniforms.u_resolution.value + 1.0);
  const minD = -0.5 * diagonal;
  const maxD = 0.5 * diagonal;
  // console.log('u_mind=' + minD.toString() + ', u_maxd=' + maxD.toString());
  for (let d = minD + dStep; d < maxD; d += dStep) {
    let myUniforms = copyUniforms();
    myUniforms.u_d.value = (d - minD) / (maxD - dStep - minD);
    // console.log('d=' + d.toString() + ', u_d=' + myUniforms.u_d.value.toString());
    let material = new THREE.ShaderMaterial({ uniforms: myUniforms, vertexShader: vs, fragmentShader: fsHeader + compilerSource + fsFooter, side: THREE.DoubleSide, transparent: true });
    let plane = new THREE.PlaneBufferGeometry(diagonal, diagonal);
    let mesh = new THREE.Mesh(plane, material);
    mesh.position.set(0, 0, d);
    modelCentroidNull.add(mesh);
  }
}

const hud = new THREE.Object3D();

const axisLength = 1.0;
let axesHelper = new THREE.AxesHelper(axisLength);
hud.add(axesHelper);

const viewPlane = new THREE.CircleBufferGeometry(0.4, 32);
const viewCircle = new THREE.CircleBufferGeometry(0.1, 32);
const viewPlanes = [viewPlane, viewPlane, viewPlane, viewPlane, viewPlane, viewPlane,
  viewCircle, viewCircle, viewCircle, viewCircle,
  viewCircle, viewCircle, viewCircle, viewCircle];
const viewPositions = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5],
[0.4, -0.4, 0.4], [0.4, 0.4, 0.4], [-0.4, 0.4, 0.4], [-0.4, -0.4, 0.4],
[0.4, -0.4, -0.4], [0.4, 0.4, -0.4], [-0.4, 0.4, -0.4], [-0.4, -0.4, -0.4]];
const halfPi = 0.5 * Math.PI;
const quarterPi = 0.25 * Math.PI;
const viewRotations = [[0, halfPi, 0], [0, -halfPi, 0], [-halfPi, 0, 0], [halfPi, 0, 0], [0, 0, 0], [Math.PI, 0, Math.PI],
[quarterPi, 0, quarterPi, 'ZYX'], [-quarterPi, 0, -quarterPi, 'ZYX'], [-quarterPi, 0, quarterPi, 'ZYX'], [quarterPi, 0, -quarterPi, 'ZYX'],
[-quarterPi, 0, quarterPi, 'ZYX'], [quarterPi, 0, -quarterPi, 'ZYX'], [quarterPi, 0, quarterPi, 'ZYX'], [-quarterPi, 0, -quarterPi, 'ZYX']];
const viewCallbacks = [
  function () { toOrtho(rightView); controls.position0.set(resetCameraD, 0, 0); controls.up0.set(0, 0, 1); controls.reset(); },  // right
  function () { toOrtho(leftView); controls.position0.set(-resetCameraD, 0, 0); controls.up0.set(0, 0, 1); controls.reset(); },  // left
  function () { toOrtho(backView); controls.position0.set(0, resetCameraD, 0); controls.up0.set(0, 0, 1); controls.reset(); },  // back
  function () { toOrtho(frontView); controls.position0.set(0, -resetCameraD, 0); controls.up0.set(0, 0, 1); controls.reset(); },  // front
  function () { toOrtho(topView); controls.position0.set(0, 0, resetCameraD); controls.up0.set(0, 1, 0); controls.reset(); },  // top
  function () { toOrtho(bottomView); controls.position0.set(0, 0, -resetCameraD); controls.up0.set(0, -1, 0); controls.reset(); }, // bottom
  function () { toPersp(); controls.position0.set(resetCameraD, -resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, -resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, -resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, -resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); }
];

function commonViewCalc(left, right, top, bottom) {
  aspectRatio = canvas.width / canvas.height;
  let width = (right - left);
  let height = (top - bottom);
  const fs = 0.542;  // This value matches nicely with the orthographic view.
  frustumSize = fs * height;
  resetCameraD = 0.5 * height;
  if (frustumSize * aspectRatio < fs * width) {
    frustumSize = fs * width / aspectRatio;
    resetCameraD = 0.5 * width;
  }
  // console.log('aspectRatio=' + aspectRatio.toString() + ', width=' + width.toString() + ', height=' + height.toString() + ', frustumSize=' + frustumSize.toString() + ', resetCameraD=' + resetCameraD.toString());
  return {
    left: -aspectRatio * frustumSize,
    right: aspectRatio * frustumSize,
    top: frustumSize,
    bottom: -frustumSize
  };
}
function rightView() {
  // console.log('rightView');
  let left = uniforms.u_ll.value.y;
  let right = uniforms.u_ur.value.y;
  let top = uniforms.u_ur.value.z;
  let bottom = uniforms.u_ll.value.z;
  return commonViewCalc(left, right, top, bottom);
}
function leftView() {
  // console.log('leftView');
  let left = uniforms.u_ur.value.y;
  let right = uniforms.u_ll.value.y;
  let top = uniforms.u_ur.value.z;
  let bottom = uniforms.u_ll.value.z;
  return commonViewCalc(left, right, top, bottom);
}
function backView() {
  // console.log('backView');
  let left = uniforms.u_ur.value.x;
  let right = uniforms.u_ll.value.x;
  let top = uniforms.u_ur.value.z;
  let bottom = uniforms.u_ll.value.z;
  return commonViewCalc(left, right, top, bottom);
}
function frontView() {
  // console.log('frontView');
  let left = uniforms.u_ll.value.x;
  let right = uniforms.u_ur.value.x;
  let top = uniforms.u_ur.value.z;
  let bottom = uniforms.u_ll.value.z;
  return commonViewCalc(left, right, top, bottom);
}
function topView() {
  // console.log('topView');
  let left = uniforms.u_ll.value.x;
  let right = uniforms.u_ur.value.x;
  let top = uniforms.u_ur.value.y;
  let bottom = uniforms.u_ll.value.y;
  return commonViewCalc(left, right, top, bottom);
}
function bottomView() {
  // console.log('bottomView');
  let left = uniforms.u_ll.value.x;
  let right = uniforms.u_ur.value.x;
  let top = uniforms.u_ll.value.y;
  let bottom = uniforms.u_ur.value.y;
  return commonViewCalc(left, right, top, bottom);
}

const viewMesh = [];
const loadManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadManager);
const circleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: false });

const materials = [
  new THREE.MeshBasicMaterial({ map: loader.load('images/right.png'), side: THREE.DoubleSide, transparent: false }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/left.png'), side: THREE.DoubleSide, transparent: false }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/back.png'), side: THREE.DoubleSide, transparent: false }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/front.png'), side: THREE.DoubleSide, transparent: false }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/top.png'), side: THREE.DoubleSide, transparent: false }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/bottom.png'), side: THREE.DoubleSide, transparent: false }),
  circleMaterial,
  circleMaterial,
  circleMaterial,
  circleMaterial,
  circleMaterial,
  circleMaterial,
  circleMaterial,
  circleMaterial,
];

materials[0].map.center.set(.5, .5);
materials[0].map.rotation = THREE.Math.degToRad(90);
materials[1].map.center.set(.5, .5);
materials[1].map.rotation = THREE.Math.degToRad(-90);
materials[2].map.center.set(.5, .5);
materials[2].map.rotation = THREE.Math.degToRad(180);
materials[5].map.center.set(.5, .5);
materials[5].map.rotation = THREE.Math.degToRad(180);

const clickCallbacksByUUID = {};
loadManager.onLoad = () => {
  for (let i = 0; i < materials.length; i++) {
    viewMesh[i] = new THREE.Mesh(viewPlanes[i], materials[i]);
    viewMesh[i].position.x = viewPositions[i][0];
    viewMesh[i].position.y = viewPositions[i][1];
    viewMesh[i].position.z = viewPositions[i][2];
    if (viewRotations[i].length == 3) {
      viewMesh[i].rotation.x = viewRotations[i][0];
      viewMesh[i].rotation.y = viewRotations[i][1];
      viewMesh[i].rotation.z = viewRotations[i][2];
    } else {
      const params = viewRotations[i];
      const euler = new THREE.Euler(params[0], params[1], params[2], params[3]);
      viewMesh[i].setRotationFromEuler(euler);
    }
    clickCallbacksByUUID[viewMesh[i].uuid] = viewCallbacks[i];
    hud.add(viewMesh[i]);
  }
};

// Axis labels:
const axisOffset = axisLength + 0.1;
let text_opts_red = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 255, 'g': 0, 'b': 0, 'a': 1 }
};
let labels_data_x = ['X'];
let labels_x = axisLabels(labels_data_x, { 'x': 1 }, [axisOffset, 0, 0],
  text_opts_red);
hud.add(labels_x);
let text_opts_green = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 255, 'b': 0, 'a': 1 }
};
let labels_data_y = ['Y'];
let labels_y = axisLabels(labels_data_y, { 'y': 1 }, [0, axisOffset, 0],
  text_opts_green);
hud.add(labels_y);
let text_opts_blue = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 0, 'b': 255, 'a': 1 }
};
let labels_data_z = ['Z'];
let labels_z = axisLabels(labels_data_z, { 'z': 1 }, [0, 0, axisOffset],
  text_opts_blue);
hud.add(labels_z);

hudScene.add(hud);

// Initialize cameras on startup:
cameraPerspective.position.x = resetCameraD;
cameraPerspective.position.y = -resetCameraD;
cameraPerspective.position.z = resetCameraD;
cameraPerspective.up.y = 0;
cameraPerspective.up.z = 1;
cameraPerspective.lookAt([0, 0, 0]);
activeCamera = cameraPerspective;
cameraOrthographic.position.x = 0;
cameraOrthographic.position.y = -2;
cameraOrthographic.position.z = 0;
cameraOrthographic.up.y = 0;
cameraOrthographic.up.z = 1;
cameraOrthographic.lookAt([0, 0, 0]);
hudCameraPerspective.position.copy(cameraPerspective.position);
hudCameraPerspective.up.y = 0;
hudCameraPerspective.up.z = 1;
hudCameraPerspective.lookAt([0, 0, 0]);
hudActiveCamera = hudCameraPerspective;
hudCameraOrthographic.position.copy(cameraOrthographic.position);
hudCameraOrthographic.up.y = 0;
hudCameraOrthographic.up.z = 1;
hudCameraOrthographic.lookAt([0, 0, 0]);
// const cameraHelper = new THREE.CameraHelper(activeCamera);
// scene.add(cameraHelper);

let controls = new THREE.TrackballControls(activeCamera, canvas);

controls.rotateSpeed = 2.0;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;

controls.noZoom = false;
controls.noPan = false;

controls.staticMoving = true;
controls.dynamicDampingFactor = 0.3;

controls.keys = [65, 83, 68];

controls.addEventListener('change', render);
canvas.addEventListener('resize', onCanvasResize, false);
canvas.addEventListener('mousedown', onCanvasClick, false);
canvas.addEventListener('touchstart', onCanvasClick, false);
onCanvasResize();
animate();

function toOrtho(getViewport) {
  const viewport = getViewport();
  console.log(viewport);
  cameraOrthographic.left = viewport.left;
  cameraOrthographic.right = viewport.right;
  cameraOrthographic.top = viewport.top;
  cameraOrthographic.bottom = viewport.bottom;
  cameraOrthographic.updateProjectionMatrix();
  activeCamera = cameraOrthographic;
  controls.object = activeCamera;
  hudActiveCamera = hudCameraOrthographic;
}
function toPersp() {
  activeCamera = cameraPerspective;
  controls.object = activeCamera;
  hudActiveCamera = hudCameraPerspective;
}

let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let onClickPosition = new THREE.Vector2();
let getMousePosition = function (dom, x, y) {
  let rect = dom.getBoundingClientRect();
  return [(x + hudViewport.width - rect.right) / hudViewport.width,
  (y - rect.top) / hudViewport.height];
};
let getIntersects = function (point, objects) {
  mouse.set((point.x * 2) - 1, - (point.y * 2) + 1);
  raycaster.setFromCamera(mouse, hudActiveCamera);
  return raycaster.intersectObjects(objects);
};
function activateHudViewport() {
  renderer.getViewport(fullViewport);
  let width = hudSize;
  if (fullViewport.width < hudSize) {
    width = fullViewport.width;
  }
  let height = hudSize;
  if (fullViewport.height < hudSize) {
    height = fullViewport.height;
  }
  hudViewport.set(fullViewport.width - width, fullViewport.height - height,
    width, height);
  renderer.setViewport(hudViewport);
}
function onCanvasClick(evt) {
  const x = evt.clientX;
  const y = evt.clientY;
  let array = getMousePosition(canvas, x, y);
  if (array[0] < 0. || array[1] > 1.) { return; }

  evt.preventDefault();
  onClickPosition.fromArray(array);
  let intersects = getIntersects(onClickPosition, hud.children);
  for (let i = 0; i < intersects.length; i++) {
    const intersect = intersects[i];
    if (!intersect.uv || intersect.object.type !== 'Mesh') { continue; }
    let clickCallback = clickCallbacksByUUID[intersect.object.uuid];
    if (clickCallback) {
      clickCallback();
      return false;
    }
  }
  return true;
}
function onCanvasResize() {
  const aspectRatio = canvas.width / canvas.height;
  cameraOrthographic.left = -aspectRatio * frustumSize;
  cameraOrthographic.right = aspectRatio * frustumSize;
  cameraOrthographic.top = frustumSize;
  cameraOrthographic.bottom = -frustumSize;
  cameraOrthographic.updateProjectionMatrix();
  cameraPerspective.aspect = aspectRatio;
  cameraPerspective.updateProjectionMatrix();

  let width = hudSize;
  let height = hudSize;
  if (canvas.width < hudSize) {
    width = canvas.width;
  }
  if (canvas.height < hudSize) {
    height = canvas.height;
  }
  const hudAspectRatio = width / height;
  hudCameraOrthographic.left = -hudAspectRatio * hudFrustumSize;
  hudCameraOrthographic.right = hudAspectRatio * hudFrustumSize;
  hudCameraOrthographic.top = hudFrustumSize;
  hudCameraOrthographic.bottom = -hudFrustumSize;
  hudCameraOrthographic.updateProjectionMatrix();
  hudCameraPerspective.aspect = hudAspectRatio;
  hudCameraPerspective.updateProjectionMatrix();

  renderer.setSize(canvas.width, canvas.height);
  renderer.getViewport(fullViewport);
  controls.handleResize();
  render();
}
function animate() {
  controls.update();
  requestAnimationFrame(animate);
}

function render() {
  renderer.clear();

  if (modelCentroidNull != null) {
    modelCentroidNull.lookAt(activeCamera.position);  // comment out to debug.
  }
  renderer.render(scene, activeCamera);

  activateHudViewport();
  renderer.clearDepth();
  hudActiveCamera.quaternion.copy(activeCamera.quaternion);
  hudActiveCamera.position.set(0, 0, 3.25);
  hudActiveCamera.position.applyQuaternion(hudActiveCamera.quaternion);
  renderer.render(hudScene, hudActiveCamera);
  // console.log('restoring viewport to full canvas:', fullViewport);
  renderer.setViewport(fullViewport);
}

let sliceScene = null;
const rtWidth = 512;
const rtHeight = 512;
const sliceRenderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight);
let pixelBuffer = null;
function getPixelBuffer() { return pixelBuffer; }
function renderSliceToTexture(z) {
  console.log("Rendering slice at z=", z);
  if (sliceScene != null) {
    sliceScene.dispose();
  }
  sliceScene = new THREE.Scene();
  const width = uniforms.u_ur.value.x - uniforms.u_ll.value.x;
  const height = uniforms.u_ur.value.y - uniforms.u_ll.value.y;
  let slicePlane = new THREE.PlaneBufferGeometry(width, height);
  let sliceMesh = new THREE.Mesh(slicePlane, material);
  sliceMesh.position.set(0, 0, z);
  sliceScene.add(sliceMesh);
  let sliceCamera = new THREE.OrthographicCamera(
    uniforms.u_ll.value.x, uniforms.u_ur.value.x,
    uniforms.u_ur.value.y, uniforms.u_ll.value.y, 0.1, 1000);

  renderer.setRenderTarget(sliceRenderTarget);
  renderer.render(sliceScene, sliceCamera);

  pixelBuffer = new Uint8Array(4 * rtWidth * rtHeight);
  renderer.readRenderTargetPixels(sliceRenderTarget, 0, 0, rtWidth, rtHeight, pixelBuffer);

  renderer.setRenderTarget(null);
}