"use strict";

// Split panels...

Split(['#one', '#two']);
const twoDiv = document.getElementById('two');

// Get A WebGL context
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById("canvas");
const gl = canvas.getContext("webgl2");
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

var compileShader = function () {
  console.log('TODO: Compile shader.');
};
var renderModel = function () {
  console.log('TODO: Render model.');
};

var editor = null;
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
  var myBinding = editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, renderModel);

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

var vs = `#version 300 es
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
var fs = `#version 300 es
precision highp float;
precision highp int;
out vec4 out_FragColor;
void main() {
  out_FragColor = vec4( 1.0 );
}`;

var scene = new THREE.Scene();
var aspectRatio = canvas.width / canvas.height;
console.log('canvas: (' + canvas.width.toString() + ',' + canvas.height.toString() + '), aspectRatio=' + aspectRatio.toString());
var camera = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);

var renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl });
renderer.setSize(canvas.width, canvas.height);

const light = new THREE.DirectionalLight(0xFFFFFF, 1);
light.position.set(-1, 2, 4);
scene.add(light);

// var geometry = new THREE.BoxGeometry(1, 1, 1);
// var material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs });
// var cube = new THREE.Mesh(geometry, material);
// scene.add(cube);

const axisLength = 1.5;
var axesHelper = new THREE.AxesHelper(axisLength);
scene.add(axesHelper);

// var gimbleMaterial = new THREE.SpriteMaterial({ useScreenCoordinates: true, alignment: THREE.SpriteAlignment.topRight });
// var sprite = new THREE.Sprite(gimbleMaterial);
// sprite.position.set(50, 50, 0);
// sprite.scale.set(64, 64, 1.0); // imageWidth, imageHeight
// scene.add(sprite);

const boxWidth = 1;
const boxHeight = 1;
const boxDepth = 1;
const axesGeometry = new THREE.BoxBufferGeometry(boxWidth, boxHeight, boxDepth);

const cubes = [];  // just an array we can use to rotate the cubes
const loadManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadManager);

const materials = [
  new THREE.MeshBasicMaterial({ map: loader.load('images/right.png') }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/left.png') }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/back.png') }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/front.png') }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/top.png') }),
  new THREE.MeshBasicMaterial({ map: loader.load('images/bottom.png') }),
];

materials[0].map.center.set(.5, .5);
materials[0].map.rotation = THREE.Math.degToRad(90);
materials[0].map.side = THREE.DoubleSide;
materials[0].map.transparent = true;
materials[1].map.center.set(.5, .5);
materials[1].map.rotation = THREE.Math.degToRad(-90);
materials[1].map.side = THREE.DoubleSide;
materials[1].map.transparent = true;
materials[2].map.center.set(.5, .5);
materials[2].map.rotation = THREE.Math.degToRad(180);
materials[2].map.side = THREE.DoubleSide;
materials[2].map.transparent = true;
materials[3].map.side = THREE.DoubleSide;
materials[3].map.transparent = true;
materials[4].map.side = THREE.DoubleSide;
materials[4].map.transparent = true;
materials[5].map.center.set(.5, .5);
materials[5].map.rotation = THREE.Math.degToRad(180);
materials[5].map.side = THREE.DoubleSide;
materials[5].map.transparent = true;

loadManager.onLoad = () => {
  const cube = new THREE.Mesh(axesGeometry, materials);
  scene.add(cube);
  cubes.push(cube);  // add to our list of cubes to rotate
};

// Axis labels:
const axisOffset = axisLength + 0.1;
var text_opts_red = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 255, 'g': 0, 'b': 0, 'a': 1 }
};
var labels_data_x = ['X'];
var labels_x = axisLabels(labels_data_x, { 'x': 1 }, [axisOffset, 0, 0],
  text_opts_red);
scene.add(labels_x);
var text_opts_green = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 255, 'b': 0, 'a': 1 }
};
var labels_data_y = ['Y'];
var labels_y = axisLabels(labels_data_y, { 'y': 1 }, [0, axisOffset, 0],
  text_opts_green);
scene.add(labels_y);
var text_opts_blue = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 0, 'b': 255, 'a': 1 }
};
var labels_data_z = ['Z'];
var labels_z = axisLabels(labels_data_z, { 'z': 1 }, [0, 0, axisOffset],
  text_opts_blue);
scene.add(labels_z);

// Isometric view on startup:
camera.position.x = 3;
camera.position.y = -3;
camera.position.z = 3;
camera.up.y = 0;
camera.up.z = 1;
camera.lookAt([0, 0, 0]);

var controls = new THREE.TrackballControls(camera, canvas);

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

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var onClickPosition = new THREE.Vector2();
var getMousePosition = function (dom, x, y) {
  var rect = dom.getBoundingClientRect();
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
};
var getIntersects = function (point, objects) {
  mouse.set((point.x * 2) - 1, - (point.y * 2) + 1);
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(objects);
};
function onCanvasClick(evt) {
  evt.preventDefault();
  var array = getMousePosition(canvas, evt.clientX, evt.clientY);
  onClickPosition.fromArray(array);
  var intersects = getIntersects(onClickPosition, scene.children);
  if (intersects.length > 0 && intersects[0].uv) {
    var intersect = intersects[0];
    for (var i = 0; i < intersect.object.material.length; i++) {
      var uv = intersect.uv;
      intersect.object.material[i].map.transformUv(uv);
      // canvas.setCrossPosition(uv.x, uv.y);
      console.log(uv);
    }
  }
}
function onCanvasResize() {
  console.log('onCanvasResize: (' + canvas.width.toString() + ',' + canvas.height.toString() + ')');
  camera.aspect = canvas.width / canvas.height;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.width, canvas.height);
  controls.handleResize();
  render();
}
function animate() {
  requestAnimationFrame(animate);
  controls.update();
}
function render() {
  renderer.render(scene, camera);
}
