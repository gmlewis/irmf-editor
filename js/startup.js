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

let vs = `#version 300 es
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
let fs = `#version 300 es
precision highp float;
precision highp int;
out vec4 out_FragColor;
void main() {
  out_FragColor = vec4( 1.0 );
}`;

const scene = new THREE.Scene();
let aspectRatio = canvas.width / canvas.height;
console.log('canvas: (' + canvas.width.toString() + ',' + canvas.height.toString() + '), aspectRatio=' + aspectRatio.toString());
let activeCamera = null;
let cameraPerspective = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
let frustumSize = 2.;
let cameraOrthographic = new THREE.OrthographicCamera(
  -aspectRatio * frustumSize, aspectRatio * frustumSize, frustumSize, -frustumSize, 1, 10);

let renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl });
renderer.setSize(canvas.width, canvas.height);

const light = new THREE.DirectionalLight(0xFFFFFF, 1);
light.position.set(-1, 2, 4);
scene.add(light);

// let geometry = new THREE.BoxGeometry(1, 1, 1);
// let material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs });
// let cube = new THREE.Mesh(geometry, material);
// scene.add(cube);

const hud = new THREE.Object3D();

const axisLength = 1.0;
let axesHelper = new THREE.AxesHelper(axisLength);
hud.add(axesHelper);

// let gimbleMaterial = new THREE.SpriteMaterial({ useScreenCoordinates: true, alignment: THREE.SpriteAlignment.topRight });
// let sprite = new THREE.Sprite(gimbleMaterial);
// sprite.position.set(50, 50, 0);
// sprite.scale.set(64, 64, 1.0); // imageWidth, imageHeight
// scene.add(sprite);

// const boxWidth = 1;
// const boxHeight = 1;
// const boxDepth = 1;
// const axesGeometry = new THREE.BoxBufferGeometry(boxWidth, boxHeight, boxDepth);
// const filletBox = function (size, fillet) {
//   let verts = [new THREE.Vector2(-0.5 * size, -0.5 * size)];
//   for (let ang = 0; ang < 2 * Math.PI; ang += 0.1) {
//     verts.push(new THREE.Vector2(size * 0.5 * Math.cos(ang), size * 0.5 * Math.sin(ang)));
//   }
//   return new THREE.Shape(verts);
// }

// const viewPlane = new THREE.ShapeGeometry(filletBox(0.8, 0.25));
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
  function () { toPersp(); controls.position0.set(3, -3, 3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(3, 3, 3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-3, 3, 3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-3, -3, 3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(3, -3, -3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(3, 3, -3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-3, 3, -3); controls.up0.set(0, 0, 1); controls.reset(); },
  function () { toPersp(); controls.position0.set(-3, -3, -3); controls.up0.set(0, 0, 1); controls.reset(); }
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
  // const cube = new THREE.Mesh(axesGeometry, materials);
  // scene.add(cube);
  // cubes.push(cube);  // add to our list of cubes to rotate
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

scene.add(hud);

// Initialize cameras on startup:
cameraPerspective.position.x = 3;
cameraPerspective.position.y = -3;
cameraPerspective.position.z = 3;
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
canvas.addEventListener('click', onCanvasClick, false);
onCanvasResize();
animate();

function toOrtho() {
  activeCamera = cameraOrthographic;
  controls.object = activeCamera;
}
function toPersp() {
  activeCamera = cameraPerspective;
  controls.object = activeCamera;
}

let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let onClickPosition = new THREE.Vector2();
let getMousePosition = function (dom, x, y) {
  let rect = dom.getBoundingClientRect();
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
};
let getIntersects = function (point, objects) {
  mouse.set((point.x * 2) - 1, - (point.y * 2) + 1);
  raycaster.setFromCamera(mouse, activeCamera);
  return raycaster.intersectObjects(objects);
};
function onCanvasClick(evt) {
  evt.preventDefault();
  let array = getMousePosition(canvas, evt.clientX, evt.clientY);
  onClickPosition.fromArray(array);
  let intersects = getIntersects(onClickPosition, hud.children);
  if (intersects.length > 0 && intersects[0].uv) {
    let intersect = intersects[0];
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
  renderer.setSize(canvas.width, canvas.height);
  controls.handleResize();
  render();
}
function animate() {
  requestAnimationFrame(animate);
  controls.update();
}
function render() {
  // let activeCameraWorldDirection = new THREE.Vector3();
  // activeCamera.getWorldDirection(activeCameraWorldDirection);
  // console.log(activeCameraWorldDirection);
  // activeCameraWorldDirection.multiplyScalar(10);
  // let newPosition = new THREE.Vector3().addVectors(activeCamera.position, activeCameraWorldDirection);
  // console.log(newPosition);
  // hud.position.copy(newPosition);
  // hud.quaternion.copy(activeCamera.quaternion);
  renderer.render(scene, activeCamera);
}
