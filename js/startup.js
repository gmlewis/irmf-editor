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

const compileShader = function () {
  console.log('TODO: Compile shader.');
};
const renderModel = function () {
  console.log('TODO: Render model.');
};

let editor = null;
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
    value: [
      '/*{',
      '  irmf: "1.0",',
      '  materials: ["PLA"],',
      '  max: [10,10,10],',
      '  min: [0,0,0],',
      '  units: "mm",',
      '}*/',
      '',
      'void mainModel4( out vec4 materials, in vec3 xyz ) {',
      '  materials[0] = 1.0;',
      '}'
    ].join('\n'),
    language: 'javascript',
    scrollBeyondLastLine: false,
    theme: "myCustomTheme",
    minimap: {
      enabled: false
    }
  });
  editor.updateOptions({ wordWrap: "on" });

  // Add Ctrl/Cmd-Enter to render updated model:
  const myBinding = editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, renderModel);

  console.log('editor started');
  function twoDivResized() {
    canvas.width = twoDiv.offsetWidth;
    canvas.height = twoDiv.offsetHeight;
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
  // u_matrix maps the position to 3D model world space for the plane mesh.
  v_xyz = u_matrix * vec4( position, 1.0 );
}
`;
const fsHeader = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 u_ll;
uniform vec3 u_ur;
uniform vec3 u_resolution;
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
let fsModel = `
// TODO: Take this model from the editor.
float sphere(in vec3 pos, in float radius, in vec3 xyz) {
  xyz -= pos;  // Move sphere into place.
  float r = length(xyz);
  return r <= radius ? 1.0 : 0.0;
}

void mainModel4( out vec4 materials, in vec3 xyz ) {
  const float radius = 5.0;  // 10mm diameter sphere.
  materials[0] = sphere(vec3(0), radius, xyz);
}
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
  if (u_numMaterials <= 4) {
    vec4 materials;
    mainModel4(materials, v_xyz.xyz);
    out_FragColor = u_color1*materials.x + u_color2*materials.y + u_color3*materials.z + u_color4*materials.w;
    // out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
  // } else if (u_numMaterials <= 9) {

  // } else if (u_numMaterials <= 16) {

  }
}
`;

const scene = new THREE.Scene();
const hudScene = new THREE.Scene();
const modelScene = new THREE.Scene();
let fullViewport = new THREE.Vector4();
let hudViewport = new THREE.Vector4();
const hudSize = 256;

const fov = 75.0;
let aspectRatio = canvas.width / canvas.height;
console.log('canvas: (' + canvas.width.toString() + ',' + canvas.height.toString() + '), aspectRatio=' + aspectRatio.toString());
let activeCamera = null;
let hudActiveCamera = null;
const cameraPerspective = new THREE.PerspectiveCamera(fov, aspectRatio, 0.1, 1000);
const resetCameraD = 5.0;
const frustumSize = 1.0;
const hudFrustumSize = 1.25;
const cameraOrthographic = new THREE.OrthographicCamera(
  -aspectRatio * frustumSize, aspectRatio * frustumSize, frustumSize, -frustumSize, 0.1, 1000);
const hudCameraPerspective = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
const hudCameraOrthographic = new THREE.OrthographicCamera(
  -hudFrustumSize, hudFrustumSize, hudFrustumSize, -hudFrustumSize, 0.1, 1000);

let renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl });
renderer.setSize(canvas.width, canvas.height);
renderer.autoClear = false;

// Probably not needed at all:
const light = new THREE.DirectionalLight(0xFFFFFF, 1);
light.position.set(-1, 2, 4);
scene.add(light);

const uniforms = {
  u_ll: { type: 'v3', value: new THREE.Vector3() }, // MBB min
  u_ur: { type: 'v3', value: new THREE.Vector3() },  // MBB max
  u_matrix: { type: 'm4', value: new THREE.Matrix4() },
  u_resolution: { type: 'v3', value: new THREE.Vector3() },
  u_numMaterials: { type: 'int', value: 1 },
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
// const modelGeometry = new THREE.BoxGeometry(1, 1, 1);
const modelGeometry = new THREE.PlaneBufferGeometry(2, 2);
const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fsHeader + fsModel + fsFooter, side: THREE.DoubleSide, transparent: true });
const modelMesh = new THREE.Mesh(modelGeometry, material);
scene.add(modelMesh);
// TODO: Make this a slider in the display.
uniforms.u_resolution.value.x = 128;
uniforms.u_resolution.value.y = 128;
uniforms.u_resolution.value.z = 128;
// TODO: Take these from the editor.
uniforms.u_ll.value.set(-5, -5, -5);
uniforms.u_ur.value.set(5, 5, 5);
// TODO: Make this configurable from the editor.
modelMesh.position.addVectors(uniforms.u_ll.value, uniforms.u_ur.value);
modelMesh.position.multiplyScalar(0.5);
modelMesh.scale.subVectors(uniforms.u_ur.value, uniforms.u_ll.value);
modelMesh.scale.multiplyScalar(0.5);

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
  function () { toOrtho(); controls.position0.set(5, 0, 0); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toOrtho(); controls.position0.set(-5, 0, 0); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toOrtho(); controls.position0.set(0, 5, 0); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toOrtho(); controls.position0.set(0, -5, 0); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toOrtho(); controls.position0.set(0, 0, 5); controls.up0.set(0, 1, 0); controls.reset(); },
  function () { toOrtho(); controls.position0.set(0, 0, -5); controls.up0.set(0, -1, 0); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, -resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, -resetCameraD, resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, -resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(resetCameraD, resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-resetCameraD, -resetCameraD, -resetCameraD); controls.up0.set(0, 0, 1); controls.reset(); }
];

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

function toOrtho() {
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
function calcViewportMBB() {
  const mvi = activeCamera.matrixWorldInverse;
  // let llx = 1e6;
  // let lly = 1e6;
  let llz = 1e6;
  // let urx = -1e6;
  // let ury = -1e6;
  let urz = -1e6;
  const updateMBB = function (pt) {
    pt.applyMatrix4(mvi);
    // if (pt.x < llx) { llx = pt.x }
    // if (pt.y < lly) { lly = pt.y }
    if (pt.z < llz) { llz = pt.z }
    // if (pt.x > urx) { urx = pt.x }
    // if (pt.y > ury) { ury = pt.y }
    if (pt.z > urz) { urz = pt.z }
  }
  const ll = uniforms.u_ll.value;
  const ur = uniforms.u_ur.value;
  updateMBB(new THREE.Vector4(ll.x, ll.y, ll.z, 1));
  updateMBB(new THREE.Vector4(ll.x, ll.y, ur.z, 1));
  updateMBB(new THREE.Vector4(ll.x, ur.y, ll.z, 1));
  updateMBB(new THREE.Vector4(ll.x, ur.y, ur.z, 1));
  updateMBB(new THREE.Vector4(ur.x, ll.y, ll.z, 1));
  updateMBB(new THREE.Vector4(ur.x, ll.y, ur.z, 1));
  updateMBB(new THREE.Vector4(ur.x, ur.y, ll.z, 1));
  updateMBB(new THREE.Vector4(ur.x, ur.y, ur.z, 1));
  // console.log(llx, lly, llz, urx, ury, urz);
  return [llz, urz];
}
function render() {
  // cameraHelper.update();
  renderer.clear();

  // // const zstep = (uniforms.u_ur.value.z - uniforms.u_ll.value.z) / uniforms.u_resolution.value.z;
  // // for (let z = uniforms.u_ll.value.z; z <= uniforms.u_ur.value.z; z += zstep) {
  // let z = 0;
  // modelMesh.position.z = z;
  // uniforms.u_matrix.value.set(
  //   modelMesh.scale.x, 0, 0, 0,
  //   0, modelMesh.scale.y, 0, 0,
  //   0, 0, 0, z,
  //   0, 0, 0, 1,
  // );

  // renderer.render(scene, activeCamera);
  // // }

  const [minD, maxD] = calcViewportMBB();
  // console.log('minD=', minD, ', maxD=', maxD);
  const dStep = (maxD - minD) / uniforms.u_resolution.value.z;
  for (let d = minD; d <= maxD; d += dStep) {
    // modelMesh.position.z = d;

    // Make a plane |d| distance from the camera along the camera's local axis.
    // const cameraWorldDirection = new THREE.Vector3();
    // activeCamera.getWorldDirection(cameraWorldDirection);
    // console.log('GML1: ', cameraWorldDirection);
    // cameraWorldDirection.normalize();
    // console.log('GML1.5: ', cameraWorldDirection);
    // cameraWorldDirection.multiplyScalar(Math.abs(d));
    // console.log('GML2: ', cameraWorldDirection);
    // cameraWorldDirection.add(activeCamera.position);
    // console.log('GML3: ', cameraWorldDirection);
    // modelMesh.position.copy(cameraWorldDirection);
    // console.log('GML4: ', modelMesh.position);;
    modelMesh.quaternion.copy(activeCamera.quaternion);

    // modelMesh.quaternion.copy(activeCamera.quaternion);
    uniforms.u_matrix.value.compose(modelMesh.position, activeCamera.quaternion, modelMesh.scale);
    // uniforms.u_matrix.value.set(
    //   modelMesh.scale.x, 0, 0, 0,
    //   0, modelMesh.scale.y, 0, 0,
    //   0, 0, 0, z,
    //   0, 0, 0, 1,
    // );
    renderer.render(scene, activeCamera);
  }

  activateHudViewport();
  renderer.clearDepth();
  hudActiveCamera.quaternion.copy(activeCamera.quaternion);
  hudActiveCamera.position.set(0, 0, 3.25);
  hudActiveCamera.position.applyQuaternion(hudActiveCamera.quaternion);
  renderer.render(hudScene, hudActiveCamera);
  // console.log('restoring viewport to full canvas:', fullViewport);
  renderer.setViewport(fullViewport);
}
