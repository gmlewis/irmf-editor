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

var geometry = new THREE.BoxGeometry(1, 1, 1);
var material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs });
var cube = new THREE.Mesh(geometry, material);
scene.add(cube);

camera.position.z = 5;

var controls = new THREE.TrackballControls(camera, canvas);

controls.rotateSpeed = 1.0;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;

controls.noZoom = false;
controls.noPan = false;

controls.staticMoving = true;
controls.dynamicDampingFactor = 0.3;

controls.keys = [65, 83, 68];

controls.addEventListener('change', render);

canvas.addEventListener('resize', onCanvasResize, false);

onCanvasResize();
animate();

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