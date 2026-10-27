'use strict'
/* global THREE */

// Split panels...
Split(['#one', '#two'])
const twoDiv = document.getElementById('two')

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const recompileMessage = document.getElementById('recompile-message')
if (recompileMessage) {
  if (isMac) {
    recompileMessage.innerText = 'Hit Cmd-Enter to recompile IRMF shader.'
  } else {
    recompileMessage.innerText = 'Hit Ctrl-Enter to recompile IRMF shader.'
  }
}

// Get canvases
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('canvas')
/** @type {HTMLCanvasElement} */
const gpuCanvas = document.getElementById('gpu-canvas')
/** @type {HTMLCanvasElement} */
const tslCanvas = document.getElementById('tsl-canvas')

// Lazily create the modern three.js TSL runtime the first time a TSL model is
// loaded. It lives in a separate canvas because a canvas can only ever have one
// context type, and the legacy WGSL renderer owns a `webgpu` context.
let tslRuntime = null
let tslRuntimePromise = null
async function getTSLRuntime() {
  if (tslRuntime) return tslRuntime
  if (!tslRuntimePromise) {
    tslRuntimePromise = (async () => {
      const mod = await import('./tsl-runtime.js')
      const rt = await mod.createRuntime({
        canvas: tslCanvas,
        log: jsLogf,
        forceWebGL: !!window.__irmfTSLForceWebGL,
        getUniforms: () => uniforms,
        getRangeValues: () => rangeValues,
        getResolution: () => uniforms.u_resolution.value,
        getModelTransform: () => modelCentroidNull,
      })
      tslRuntime = rt
      window.IRMFTSL = rt
      return rt
    })()
  }
  return tslRuntimePromise
}

// Confirm before running TSL downloaded from the internet. Approval is
// per source URL and per page load (never session-wide), so one "Continue"
// cannot authorize a different model loaded later in the same tab.
const approvedRemoteTSL = new Set()
function confirmRemoteTSL(remoteSource) {
  if (!remoteSource) return true
  const key = String(remoteSource)
  if (approvedRemoteTSL.has(key)) return true
  const ok = window.confirm(
    'This TSL model is executable JavaScript loaded from:\n\n' + key +
    '\n\nOnly run it if you trust this exact source. Continue?'
  )
  if (ok) approvedRemoteTSL.add(key)
  return ok
}

const gl = canvas.getContext('webgl2')
if (!gl) {
  console.log('Browser does not support WebGL2!')
}

const fov = 75.0
const FRUSTUM_SIZE_FACTOR = 0.542 // Safe value that keeps camera outside model bounding sphere.

// Set up GUI:
const gui = new dat.GUI({ name: 'IRMF Editor', autoPlace: false })
gui.domElement.id = 'gui'
twoDiv.appendChild(gui.domElement)

let viewParameters = {
  resetView: function () {
    if (typeof viewCallbacks !== 'undefined' && viewCallbacks[6]) {
      viewCallbacks[6]()
    }
  }
}
gui.add(viewParameters, 'resetView').name('Reset View')

let resolutionParameters = {
  res32: false,
  res64: false,
  res128: false,
  res256: false,
  res512: true,
  res1024: false,
  res2048: false
}

let axesParameters = {
  showAxes: true,
  showThrough: true,
}

function setResolution(res) {
  setChecked('res' + res.toString())
  uniforms.u_resolution.value = res
}

let resolutionFolder = gui.addFolder("Resolution")
resolutionFolder.add(resolutionParameters, 'res32').name('32').listen().onChange(function () { setResolution(32); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res64').name('64').listen().onChange(function () { setResolution(64); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res128').name('128').listen().onChange(function () { setResolution(128); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res256').name('256').listen().onChange(function () { setResolution(256); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res512').name('512').listen().onChange(function () { setResolution(512); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res1024').name('1024').listen().onChange(function () { setResolution(1024); goJSONOptionsCallback(); uniformsChanged(); render() })
resolutionFolder.add(resolutionParameters, 'res2048').name('2048').listen().onChange(function () { setResolution(2048); goJSONOptionsCallback(); uniformsChanged(); render() })

let axesFolder = gui.addFolder("Axes")
axesFolder.add(axesParameters, 'showAxes').name('Show Axes').onChange(function () { updateAxes(); render() })
axesFolder.add(axesParameters, 'showThrough').name('Show Through').onChange(function () { updateAxes(); render() })

function setChecked(prop) {
  for (let param in resolutionParameters) {
    resolutionParameters[param] = false
  }
  resolutionParameters[prop] = true
}

let colorFolder = gui.addFolder('Material colors (1)')
function getColorFolder() { return colorFolder }
let colorPalette = {
  color1: [255, 0, 0, 1.0],
  color2: [0, 255, 0, 1.0],
  color3: [0, 0, 255, 1.0],
  color4: [255, 255, 0, 1.0],
  color5: [0, 255, 255, 1.0],
  color6: [255, 0, 255, 1.0],
  color7: [128, 0, 0, 1.0],
  color8: [0, 128, 0, 1.0],
  color9: [0, 0, 128, 1.0],
  color10: [128, 128, 0, 1.0],
  color11: [0, 128, 128, 1.0],
  color12: [128, 0, 128, 1.0],
  color13: [64, 128, 64, 1.0],
  color14: [128, 64, 128, 1.0],
  color15: [64, 64, 128, 1.0],
  color16: [64, 128, 128, 1.0],
}
function getColorPalette() { return colorPalette }
let colorControllers = [
]

function refreshMaterialColorControllers(names) {
  for (let i = 0; i < colorControllers.length; i++) {
    colorFolder.remove(colorControllers[i])
  }
  colorControllers = []
  for (let i = 1; i <= names.length; i++) {
    let name = names[i - 1]
    let colorName = 'color' + i.toString()
    let uniformName = 'u_color' + i.toString()
    // dat.GUI 0.7.x writes controller names with innerHTML. Material names
    // come from the (untrusted) IRMF header, so never pass them to .name():
    // set a safe placeholder and then use textContent for the label.
    let ctrl = colorFolder.addColor(colorPalette, colorName).name('').listen().onChange(function () {
      let color = colorPalette[colorName]
      uniforms[uniformName].value.set(color[0] / 255.0, color[1] / 255.0, color[2] / 255.0, color[3])
      goJSONOptionsCallback()
      uniformsChanged()
      render()
    })
    const label = ctrl.__li && ctrl.__li.querySelector('.property-name')
    if (label) label.textContent = String(name)
    colorControllers.push(ctrl)
  }
}
refreshMaterialColorControllers(['PLA'])

let rangeFolder = gui.addFolder('View Ranges')
let rangeValues = {
  // These values represent the current settings which get copied to the uniforms:
  llx: 0.0,
  lly: 0.0,
  llz: 0.0,
  urx: 1.0,
  ury: 1.0,
  urz: 1.0,
  // These values represent the absolute limits from the JSON blob:
  minx: 0.0,
  miny: 0.0,
  minz: 0.0,
  maxx: 1.0,
  maxy: 1.0,
  maxz: 1.0,
}
function getRangeValues() { return rangeValues }
let rangeControllers = [
]
function refreshRangeControllers() {
  for (let i = 0; i < rangeControllers.length; i++) {
    rangeFolder.remove(rangeControllers[i])
  }
  rangeControllers = [
    rangeFolder.add(rangeValues, 'llx', rangeValues.minx, rangeValues.maxx).listen().onChange(rangeChanged('llx', 0)),
    rangeFolder.add(rangeValues, 'lly', rangeValues.miny, rangeValues.maxy).listen().onChange(rangeChanged('lly', 1)),
    rangeFolder.add(rangeValues, 'llz', rangeValues.minz, rangeValues.maxz).listen().onChange(rangeChanged('llz', 2)),
    rangeFolder.add(rangeValues, 'urx', rangeValues.minx, rangeValues.maxx).listen().onChange(rangeChanged('urx', 3)),
    rangeFolder.add(rangeValues, 'ury', rangeValues.miny, rangeValues.maxy).listen().onChange(rangeChanged('ury', 4)),
    rangeFolder.add(rangeValues, 'urz', rangeValues.minz, rangeValues.maxz).listen().onChange(rangeChanged('urz', 5)),
  ]
}
function rangeChanged(name, index) {
  if (name.substr(0, 2) === 'll') {
    let other = 'ur' + name.substr(2, 1)
    return function () {
      if (rangeValues[name] > rangeValues[other]) {
        rangeValues[other] = rangeValues[name]
        rangeControllers[index + 3].setValue(rangeValues[other])
      }
      rangeValuesChanged()
      render()
    }
  }
  let other = 'll' + name.substr(2, 1)
  return function () {
    if (rangeValues[name] < rangeValues[other]) {
      rangeValues[other] = rangeValues[name]
      rangeControllers[index - 3].setValue(rangeValues[other])
    }
    rangeValuesChanged()
    render()
  }
}

// Set up Monaco editor...

require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.20.0/min/vs' } })

// Before loading vs/editor/editor.main, define a global MonacoEnvironment that overwrites
// the default worker url location (used when creating WebWorkers). The problem here is that
// HTML5 does not allow cross-domain web workers, so we need to proxy the instantiation of
// a web worker through a same-domain script
window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
    self.MonacoEnvironment = {
      baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.20.0/min/'
    };
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.20.0/min/vs/base/worker/workerMain.js');`
    )}`
  }
}

// Go code callback installers:
let goAlreadyCached = null
function installAlreadyCached(cb) { goAlreadyCached = cb }
let goSaveToCache = null
function installSaveToCache(cb) { goSaveToCache = cb }
let goCompileCallback = null
function installCompileShader(cb) { goCompileCallback = cb }
let goJSONOptionsCallback = null
function installUpdateJSONOptionsCallback(cb) { goJSONOptionsCallback = cb }

// Synchronous same-origin fetch used by Go's `?file=` loader.
// Must be a function declaration so it exists as a property of globalThis and
// can be reached with js.Global().Call("fetchTextSync", ...).
function fetchTextSync(path) {
  // Defense in depth: reject anything that resolves to another origin, even
  // if the Go-side validation is bypassed or a browser normalizes the path.
  let url
  try {
    url = new URL(path, document.baseURI)
  } catch (e) {
    console.log(`Unable to fetch ${path}: invalid URL`)
    return ''
  }
  if (url.origin !== window.location.origin) {
    console.log(`Refusing cross-origin model URL: ${url.href}`)
    return ''
  }
  const httpRequest = new XMLHttpRequest()
  httpRequest.open('GET', url.pathname + url.search, false)
  try {
    httpRequest.send()
  } catch (e) {
    console.log(`Unable to fetch ${path}: ${e.message}`)
    return ''
  }
  if (httpRequest.status === 200) return httpRequest.responseText
  console.log(`Unable to fetch ${path}: HTTP ${httpRequest.status}`)
  return ''
}

let decorations = []
let editor = null
const compileShader = () => {
  if (!goCompileCallback) { console.log('compileCallback missing'); return }

  let currentSelection = editor.getSelection()
  // Clear decorations.
  decorations = editor.deltaDecorations(decorations, [])

  // Remote includes are fetched by Go's processIncludes so that every fetch
  // goes through the same consent, size, and count checks.
  goCompileCallback()
  // Restore cursor:
  editor.setSelection(currentSelection)
}

// let goSliceCallback = null;
// function installSliceShader(cb) {
//   goSliceCallback = cb;
// }

function highlightShaderError(line, column) {
  if (!column) {
    column = 1
  }
  decorations = editor.deltaDecorations(decorations, [
    {
      range: new monaco.Range(line, column, line, column),
      options: {
        isWholeLine: true,
        className: 'contentErrorClass',
        glyphMarginClassName: 'glyphMarginErrorClass'
      }
    }
  ])
  editor.revealLineInCenter(line)
}

function getEditor() { return editor }

// Test/diagnostic hook: the legacy camera the TSL runtime must mirror.
function getIRMFDebugState() {
  if (!activeCamera) return null
  return {
    camera: {
      position: activeCamera.position.toArray(),
      quaternion: activeCamera.quaternion.toArray(),
    },
  }
}

require(["vs/editor/editor.main"], function () {
  monaco.editor.defineTheme('myCustomTheme', {
    base: 'vs-dark', // can also be vs or hc-black
    inherit: true, // can also be false to completely replace the builtin rules
    rules: [
      { token: 'comment.js', foreground: 'ffa500', fontStyle: 'italic underline' },
      { token: 'comment', foreground: '008800', fontStyle: 'bold' },
      { token: 'comment.css', foreground: '0000ff' } // will inherit fontStyle from `comment` above
    ]
  })
  // Register a new language
  monaco.languages.register({ id: 'glsl' })
  // Register a tokens provider for the language
  monaco.languages.setMonarchTokensProvider('glsl', glsl)
  monaco.languages.setLanguageConfiguration('glsl', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '\'', close: '\'', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ]
  })

  // Register WGSL
  monaco.languages.register({ id: 'wgsl' })
  monaco.languages.setMonarchTokensProvider('wgsl', wgsl)
  monaco.languages.setLanguageConfiguration('wgsl', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '\'', close: '\'', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ]
  })

  // Register TSL (JavaScript that builds a three.js node graph)
  monaco.languages.register({ id: 'tsl' })
  monaco.languages.setMonarchTokensProvider('tsl', tsl)
  monaco.languages.setLanguageConfiguration('tsl', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '\'', close: '\'', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '`', close: '`' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ]
  })

  editor = monaco.editor.create(document.getElementById('one'), {
    value: '',
    language: 'glsl',
    scrollBeyondLastLine: false,
    theme: "myCustomTheme",
    minimap: {
      enabled: false
    },
    glyphMargin: true
  })
  editor.updateOptions({ wordWrap: "on" })

  // Add Ctrl/Cmd-Enter to render updated model:
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, compileShader)
  // Also support Ctrl/Cmd-s just out of sheer habit, but don't advertize this
  // because it's not actually saving the shader anywhere... just compiling it.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, compileShader)

  function twoDivResized() {
    canvas.width = twoDiv.offsetWidth
    canvas.height = twoDiv.offsetHeight - 100 // Keep in sync with 'logf' div height.
    gpuCanvas.width = canvas.width
    gpuCanvas.height = canvas.height
    tslCanvas.width = canvas.width
    tslCanvas.height = canvas.height
    if (tslRuntime) tslRuntime.resize()
    editor.layout()
    onCanvasResize()
  }
  new ResizeObserver(twoDivResized).observe(twoDiv)
})

// Rendering...

const vs = `#version 300 es
out vec4 v_xyz;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  v_xyz = modelMatrix * vec4( position, 1.0 );
}
`
const fsHeader = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 u_ll;
uniform vec3 u_ur;
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
`

let scene = new THREE.Scene()
const hudScene = new THREE.Scene()
let fullViewport = new THREE.Vector4()
let hudViewport = new THREE.Vector4()
const hudSize = 256

let aspectRatio = canvas.width / canvas.height
console.log('canvas: (' + canvas.width.toString() + ',' + canvas.height.toString() + '), aspectRatio=' + aspectRatio.toString())
let activeCamera = null
let hudActiveCamera = null
const cameraPerspective = new THREE.PerspectiveCamera(fov, aspectRatio, 0.1, 1000)
let resetCameraD = 5.0
let frustumSize = 1.0
const hudFrustumSize = 1.25
const cameraOrthographic = new THREE.OrthographicCamera(
  -aspectRatio * frustumSize, aspectRatio * frustumSize, frustumSize, -frustumSize, 0.1, 1000)
const hudCameraPerspective = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000)
const hudCameraOrthographic = new THREE.OrthographicCamera(
  -hudFrustumSize, hudFrustumSize, hudFrustumSize, -hudFrustumSize, 0.1, 1000)

// Log messages contain shader source, include URLs, and compiler diagnostics,
// all of which are attacker-controlled. Always write them with textContent.
function jsLogf(s) {
  const logDiv = document.getElementById('logf')
  if (!logDiv) return
  const line = document.createElement('div')
  line.style.whiteSpace = 'pre-wrap'
  line.textContent = String(s)
  logDiv.appendChild(line)
  logDiv.scrollTop = logDiv.scrollHeight
}

function jsLogError(title, text) {
  const logDiv = document.getElementById('logf')
  if (!logDiv) return
  if (title) {
    const heading = document.createElement('div')
    heading.textContent = String(title)
    logDiv.appendChild(heading)
  }
  if (text) {
    const pre = document.createElement('pre')
    pre.textContent = String(text)
    logDiv.appendChild(pre)
  }
  logDiv.scrollTop = logDiv.scrollHeight
}

// Ask once per URL per page load before loading a model from elsewhere.
// Kept in memory (not sessionStorage) so a new page load always asks again.
const approvedRemoteModels = new Set()
function confirmRemoteModel(url) {
  url = String(url || '')
  if (!url) return false
  if (approvedRemoteModels.has(url)) return true
  const ok = window.confirm(
    'This link asks the editor to download a model from:\n\n' + url +
    '\n\nIRMF models are executable code. Only continue if you trust this source.'
  )
  if (ok) approvedRemoteModels.add(url)
  return ok
}

// Ask once per host per page load before downloading shader code. Kept in
// memory (not sessionStorage) so a new page load always asks again.
const approvedIncludeHosts = new Set()
function confirmRemoteInclude(host) {
  host = String(host || '')
  if (!host) return false
  if (approvedIncludeHosts.has(host)) return true
  const ok = window.confirm(
    'This model wants to download shader code from ' + host + '.\n\n' +
    'Remote includes are executable code and are fetched every time the model ' +
    'is loaded. Only allow this if you trust ' + host + '. Allow?'
  )
  if (ok) approvedIncludeHosts.add(host)
  return ok
}

class WebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.device = null
    this.context = canvas.getContext('webgpu')
    this.pipeline = null
    this.uniformBuffer = null
    this.bindGroup = null
    this.vertexBuffer = null
    this.depthTexture = null
    this.format = null
    this.compilerSource = ''
    this.firstFrame = true
  }

  async init() {
    if (!navigator.gpu) {
      jsLogf('WebGPU: navigator.gpu not found. WebGPU is not supported in this browser.')
      throw new Error('WebGPU not supported')
    }
    jsLogf('WebGPU: Requesting adapter...')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      jsLogf('WebGPU: No appropriate GPUAdapter found.')
      throw new Error('No appropriate GPUAdapter found.')
    }
    jsLogf('WebGPU: Requesting device...')
    this.device = await adapter.requestDevice()
    this.device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      jsLogf(`WebGPU device was lost: ${info.message}. Attempting to recover on next compilation.`);
      if (info.reason !== 'destroyed') {
        webgpuRenderer = null;
        if (activeRenderer instanceof WebGPURenderer) {
          activeRenderer = null;
        }
      }
    });
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    })

    // Create a quad (two triangles)
    const vertices = new Float32Array([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      -0.5, 0.5, 0,
      -0.5, 0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
    ])
    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices)

    this.uniformBuffer = this.device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  async loadNewModel(source) {
    try {
      jsLogf('WebGPU: Starting shader compilation...')
      this.compilerSource = source
      const prefix = `
      struct Uniforms {
        projectionMatrix: mat4x4<f32>,
        modelViewMatrix: mat4x4<f32>,
        modelMatrix: mat4x4<f32>,
        ll: vec4<f32>,
        ur: vec4<f32>,
        minD: f32,
        maxD: f32,
        diagonal: f32,
        _pad: f32,
        colors: array<vec4<f32>, 16>,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      struct VertexOutput {
        @builtin(position) pos: vec4<f32>,
        @location(0) v_xyz: vec4<f32>,
        @location(1) u_d: f32,
      };

      @vertex
      fn main_vs(@location(0) pos: vec3<f32>, @builtin(instance_index) instanceIdx: u32) -> VertexOutput {
        var out: VertexOutput;
        let d_step = u.diagonal / max(1.0, u.ll.w - 1.0);
        let d = u.minD + f32(instanceIdx) * d_step;

        var localPos = vec4<f32>(pos.x * u.diagonal, pos.y * u.diagonal, d, 1.0);

        out.pos = u.projectionMatrix * u.modelViewMatrix * localPos;
        out.v_xyz = u.modelMatrix * localPos;
        out.u_d = f32(instanceIdx) / max(1.0, u.ll.w - 1.0);
        return out;
      }
`
      const fullSource = prefix + source
      const prefixLines = prefix.split('\n').length
      const shaderModule = this.device.createShaderModule({
        code: fullSource
      })
      this.shaderModule = shaderModule // Keep a reference to prevent GC

      let compilationInfo
      try {
        compilationInfo = await shaderModule.getCompilationInfo()
      } catch (e) {
        if (e.message.includes('dropped')) {
          jsLogError('WGSL COMPILATION EXCEPTION:',
            'WebGPU device lost or shader too complex (Instance dropped). Try reducing complexity or resolution.')
          console.error('WGSL COMPILATION EXCEPTION:', e)
          return
        }
        throw e
      }

      if (compilationInfo.messages.length > 0) {
        let hasError = false
        let log = ''
        let firstErrorLine = 0
        let firstErrorCol = 0
        for (const message of compilationInfo.messages) {
          let line = message.lineNum - prefixLines + 1
          log += `${message.type}: ${message.message} at line ${line}, col ${message.linePos}\n`
          if (message.type === 'error') {
            hasError = true
            if (firstErrorLine === 0) {
              firstErrorLine = line
              firstErrorCol = message.linePos
            }
          }
        }
        if (hasError) {
          jsLogError('WGSL COMPILATION ERROR:', log)
          console.error('WGSL COMPILATION ERROR:', log)
          highlightShaderError(firstErrorLine, firstErrorCol)
          return
        } else {
          jsLogf('WGSL Compilation Warnings:\n' + log)
        }
      }

      jsLogf('WebGPU: Creating render pipeline...')
      let pipeline
      try {
        pipeline = await this.device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: {
            module: shaderModule,
            entryPoint: 'main_vs',
            buffers: [{
              arrayStride: 12,
              attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
            }]
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'main',
            targets: [{
              format: this.format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                alpha: { srcFactor: 'one', dstFactor: 'one' }
              }
            }],
          },
          primitive: { topology: 'triangle-list' },
          depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'always',
            format: 'depth24plus',
          }
        })
      } catch (e) {
        if (e.message.includes('Instance reference') || e.message.includes('dropped')) {
          jsLogError('WGSL COMPILATION EXCEPTION:',
            'WebGPU device lost during pipeline creation. The shader may be too complex for your GPU. Try reducing resolution or complexity.')
          console.error('WGSL COMPILATION EXCEPTION:', e)
          // Force renderer recreation on next attempt
          webgpuRenderer = null
          if (activeRenderer instanceof WebGPURenderer) {
            activeRenderer = null
          }
          return
        }
        throw e
      }

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
      })

      this.pipeline = pipeline
      this.bindGroup = bindGroup
      this.firstFrame = true
      jsLogf('WebGPU: Shader compiled and pipeline created successfully.')
    } catch (e) {
      jsLogError('WGSL COMPILATION EXCEPTION:', e.message)
      console.error('WGSL COMPILATION EXCEPTION:', e)
    }
  }

  ensureDepthTexture() {
    if (this.depthTexture &&
      this.depthTexture.width === this.canvas.width &&
      this.depthTexture.height === this.canvas.height) {
      return
    }

    if (this.depthTexture) {
      this.depthTexture.destroy()
    }

    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width || 1, this.canvas.height || 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  render(scene, camera) {
    if (!this.pipeline) return

    if (this.firstFrame) {
      jsLogf('WebGPU: First frame rendering...')
      this.firstFrame = false
    }

    this.ensureDepthTexture()

    // Ensure camera matrices are up to date
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.getInverse(camera.matrixWorld)

    // WebGPU Z-correction matrix (maps Z from [-1, 1] to [0, 1])
    const correction = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    )
    const correctedProjection = new THREE.Matrix4().multiplyMatrices(correction, camera.projectionMatrix)

    const lookAt = getLookAt()
    const center = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
    const ll = new THREE.Vector3(rangeValues.llx, rangeValues.lly, rangeValues.llz)
    const ur = new THREE.Vector3(rangeValues.urx, rangeValues.ury, rangeValues.urz)
    const minD = -(new THREE.Vector3().subVectors(center, ll)).length()
    const maxD = (new THREE.Vector3().subVectors(ur, center)).length()
    const diagonal = maxD - minD

    let modelMatrix = new THREE.Matrix4().makeTranslation(lookAt[0], lookAt[1], lookAt[2])
    if (modelCentroidNull) {
      modelMatrix.copy(modelCentroidNull.matrixWorld)
    }
    const modelViewMatrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, modelMatrix)

    const data = new Float32Array(16 + 16 + 16 + 4 + 4 + 4 + 16 * 4)
    let offset = 0
    data.set(correctedProjection.elements, offset); offset += 16
    data.set(modelViewMatrix.elements, offset); offset += 16
    data.set(modelMatrix.elements, offset); offset += 16
    data.set([rangeValues.llx, rangeValues.lly, rangeValues.llz, uniforms.u_resolution.value], offset); offset += 4
    data.set([rangeValues.urx, rangeValues.ury, rangeValues.urz, uniforms.u_numMaterials.value], offset); offset += 4
    data.set([minD, maxD, diagonal, 0], offset); offset += 4

    for (let i = 1; i <= 16; i++) {
      const c = uniforms['u_color' + i].value
      data.set([c.x, c.y, c.z, c.w], offset); offset += 4
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data)

    const commandEncoder = this.device.createCommandEncoder()
    const textureView = this.context.getCurrentTexture().createView()

    const renderPassDescriptor = {
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    }

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
    passEncoder.setPipeline(this.pipeline)
    passEncoder.setBindGroup(0, this.bindGroup)
    passEncoder.setVertexBuffer(0, this.vertexBuffer)
    passEncoder.draw(6, Math.floor(uniforms.u_resolution.value))
    passEncoder.end()

    this.device.queue.submit([commandEncoder.finish()])
  }

  clear() { }
  clearDepth() { }
  setViewport(v) { }
  getViewport(v) { v.set(0, 0, this.canvas.width, this.canvas.height) }
  setSize(width, height) {
    this.canvas.width = width
    this.canvas.height = height
  }
}

let renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true })
let activeRenderer = renderer
renderer.setSize(canvas.width, canvas.height)
renderer.setClearColor(0x000000, 0)
renderer.autoClear = false

const uniforms = {
  u_ll: { type: 'v3', value: new THREE.Vector3() }, // MBB min
  u_ur: { type: 'v3', value: new THREE.Vector3() },  // MBB max
  u_resolution: { type: 'float', value: 512.0 },
  u_numMaterials: { type: 'int', value: 1 },
  u_d: { type: 'float', value: 0.0 },
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
}
function getUniforms() { return uniforms }
function copyUniforms() {
  let copy = {}
  let keys = Object.keys(uniforms)
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i]
    copy[key] = { type: uniforms[key].type, value: uniforms[key].value }
  }
  return copy
}

let modelCentroidNull = null
let oldBBox = { min: [0, 0, 0], max: [0, 0, 0] }
let compilerSource = ''
let currentLanguage = 'glsl'
let webgpuRenderer = null
async function loadNewModel(source, language, colorModel) {
  const logDiv = document.getElementById('logf')
  if (logDiv) logDiv.textContent = ''
  jsLogf('Compiling new model. Language: ' + language)
  let firstRun = (compilerSource == '')
  compilerSource = source
  // The remote-source value is the URL of the currently loaded document
  // (or false for same-origin/local content); consume it.
  const remoteSource = window.__irmfRemoteSource || false
  window.__irmfRemoteSource = false

  if (language && language !== currentLanguage) {
    jsLogf('Switching language from ' + currentLanguage + ' to ' + language)
    const previousLanguage = currentLanguage
    currentLanguage = language
    // Update Monaco language
    monaco.editor.setModelLanguage(editor.getModel(), language)

    if (previousLanguage === 'tsl' && language !== 'tsl' && tslRuntime) {
      // Free GPU resources while TSL is not in use.
      tslRuntime.unload()
    }

    if (language === 'tsl') {
      if (!confirmRemoteTSL(remoteSource)) {
        jsLogf('TSL execution was declined; the model was not loaded.')
        return
      }
      jsLogf('TSL models are JavaScript and run in your browser.')
      try {
        await getTSLRuntime()
      } catch (e) {
        console.error(e)
        jsLogf('TSL: failed to initialize the three.js renderer: ' + e.message)
        return
      }
      tslCanvas.style.display = 'block'
      gpuCanvas.style.display = 'none'
      activeRenderer = tslRuntime
    } else if (language === 'wgsl') {
      tslCanvas.style.display = 'none'
      if (!webgpuRenderer) {
        webgpuRenderer = new WebGPURenderer(gpuCanvas)
        try {
          await webgpuRenderer.init()
        } catch (e) {
          console.error(e)
          webgpuRenderer = null
          alert('Failed to initialize WebGPU: ' + e.message)
          return
        }
      }
      gpuCanvas.style.display = 'block'
      activeRenderer = webgpuRenderer
    } else {
      tslCanvas.style.display = 'none'
      gpuCanvas.style.display = 'none'
      activeRenderer = renderer
    }
    // Controls always attached to the top WebGL canvas
    controls.domElement = canvas
  }

  if (currentLanguage === 'tsl' && tslRuntime) {
    try {
      await tslRuntime.load(source, colorModel)
      jsLogf('TSL: Model loaded and rendered.')
    } catch (e) {
      console.error(e)
      jsLogf('TSL COMPILATION ERROR: ' + e.message)
      if (e.line) highlightShaderError(e.line, e.col || 1)
      return
    }
  } else if (activeRenderer === webgpuRenderer) {
    await webgpuRenderer.loadNewModel(source)
    jsLogf('WebGPU: Model loaded and rendered.')
  }
  uniformsChanged()
  updateAxes()

  const newBBox = {
    min: [rangeValues.minx, rangeValues.miny, rangeValues.minz],
    max: [rangeValues.maxx, rangeValues.maxy, rangeValues.maxz]
  }
  const bboxChanged = firstRun ||
    newBBox.min[0] !== oldBBox.min[0] || newBBox.min[1] !== oldBBox.min[1] || newBBox.min[2] !== oldBBox.min[2] ||
    newBBox.max[0] !== oldBBox.max[0] || newBBox.max[1] !== oldBBox.max[1] || newBBox.max[2] !== oldBBox.max[2]

  if (bboxChanged) {
    oldBBox = newBBox
  }

  let lookAt = getLookAt()
  controls.target0 = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
  if (bboxChanged) {
    viewCallbacks[6]()  // Reset to default view.
  }
  render()
}

function getLookAt() {
  const ll = new THREE.Vector3(rangeValues.llx, rangeValues.lly, rangeValues.llz)
  const ur = new THREE.Vector3(rangeValues.urx, rangeValues.ury, rangeValues.urz)
  const cx = 0.5 * (ll.x + ur.x)
  const cy = 0.5 * (ll.y + ur.y)
  const cz = 0.5 * (ll.z + ur.z)
  return [cx, cy, cz]
}
function uniformsChanged() {
  refreshRangeControllers()
  rangeValuesChanged()
}
let mainAxesHelper = null
let modelRadius = 1.0

function rangeValuesChanged() {
  const llx = rangeValues.llx
  const lly = rangeValues.lly
  const llz = rangeValues.llz
  const urx = rangeValues.urx
  const ury = rangeValues.ury
  const urz = rangeValues.urz
  uniforms.u_ll.value.set(llx, lly, llz)
  uniforms.u_ur.value.set(urx, ury, urz)

  const ll = new THREE.Vector3(llx, lly, llz)
  const ur = new THREE.Vector3(urx, ury, urz)
  const lookAt = getLookAt()
  const center = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])

  modelRadius = ll.distanceTo(ur) / 2.0
  if (modelRadius <= 0) modelRadius = 1.0

  // Hero zoom: Distance where the bounding sphere perfectly fits the vertical FOV.
  resetCameraD = modelRadius / Math.tan(fov * Math.PI / 360)

  controls.target.copy(center)
  controls.target0.copy(center)
  const minD = -(new THREE.Vector3().subVectors(center, ll)).length()
  const maxD = (new THREE.Vector3().subVectors(ur, center)).length()
  let diagonal = maxD - minD
  if (diagonal <= 0.0) {
    diagonal = 1.0  // Avoid divide-by-zero.
  }
  // console.log('rangeValuesChanged: minD=' + minD.toString() + ', maxD=' + maxD.toString() + ', diagonal=' + diagonal.toString());

  scene.dispose()  // This alone is not enough. Need to create a brand new scene.
  scene = new THREE.Scene()  // Eventually add a light?

  modelCentroidNull = new THREE.Object3D()
  modelCentroidNull.translateX(lookAt[0])
  modelCentroidNull.translateY(lookAt[1])
  modelCentroidNull.translateZ(lookAt[2])
  // console.log('rangeValuesChanged: modelCentroidNull.position=', modelCentroidNull.position);

  scene.add(modelCentroidNull)
  // modelCentroidNull.add(new THREE.AxesHelper(diagonal));  // for debugging
  mainAxesHelper = new THREE.AxesHelper(diagonal)
  mainAxesHelper.visible = axesParameters.showAxes
  mainAxesHelper.material.transparent = axesParameters.showThrough
  mainAxesHelper.material.depthTest = !axesParameters.showThrough
  mainAxesHelper.renderOrder = axesParameters.showThrough ? 1000 : 0
  scene.add(mainAxesHelper)

  if (activeRenderer !== renderer) { return }

  const dStep = diagonal / Math.max(1.0, uniforms.u_resolution.value - 1.0)
  for (let i = 0; i < uniforms.u_resolution.value; i++) {
    let d = minD + i * dStep
    let myUniforms = copyUniforms()
    myUniforms.u_d.value = i / Math.max(1.0, uniforms.u_resolution.value - 1.0)
    // console.log('d=' + d.toString() + ', u_d=' + myUniforms.u_d.value.toString());
    let material = new THREE.ShaderMaterial({ uniforms: myUniforms, vertexShader: vs, fragmentShader: fsHeader + compilerSource, side: THREE.DoubleSide, transparent: true })
    let plane = new THREE.PlaneBufferGeometry(diagonal, diagonal)  // Should this always fill the viewport?
    let mesh = new THREE.Mesh(plane, material)
    mesh.position.set(0, 0, d)
    modelCentroidNull.add(mesh)
  }
}

const hud = new THREE.Object3D()

const axisLength = 1.0
let hudAxesHelper = new THREE.AxesHelper(axisLength)
hud.add(hudAxesHelper)

const viewPlane = new THREE.CircleBufferGeometry(0.4, 32)
const viewCircle = new THREE.CircleBufferGeometry(0.1, 32)
const viewPlanes = [viewPlane, viewPlane, viewPlane, viewPlane, viewPlane, viewPlane,
  viewCircle, viewCircle, viewCircle, viewCircle,
  viewCircle, viewCircle, viewCircle, viewCircle]
const viewPositions = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5],
[0.4, -0.4, 0.4], [0.4, 0.4, 0.4], [-0.4, 0.4, 0.4], [-0.4, -0.4, 0.4],
[0.4, -0.4, -0.4], [0.4, 0.4, -0.4], [-0.4, 0.4, -0.4], [-0.4, -0.4, -0.4]]
const halfPi = 0.5 * Math.PI
const quarterPi = 0.25 * Math.PI
const viewRotations = [[0, halfPi, 0], [0, -halfPi, 0], [-halfPi, 0, 0], [halfPi, 0, 0], [0, 0, 0], [Math.PI, 0, Math.PI],
[quarterPi, 0, quarterPi, 'ZYX'], [-quarterPi, 0, -quarterPi, 'ZYX'], [-quarterPi, 0, quarterPi, 'ZYX'], [quarterPi, 0, -quarterPi, 'ZYX'],
[-quarterPi, 0, quarterPi, 'ZYX'], [quarterPi, 0, -quarterPi, 'ZYX'], [quarterPi, 0, quarterPi, 'ZYX'], [-quarterPi, 0, -quarterPi, 'ZYX']]
const viewCallbacks = [
  function () { toOrtho(rightView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + resetCameraD, p[1] + 0, p[2] + 0); controls.up0.set(0, 0, 1); controls.reset() },  // right
  function () { toOrtho(leftView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + -resetCameraD, p[1] + 0, p[2] + 0); controls.up0.set(0, 0, 1); controls.reset() },  // left
  function () { toOrtho(backView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + 0, p[1] + resetCameraD, p[2] + 0); controls.up0.set(0, 0, 1); controls.reset() },  // back
  function () { toOrtho(frontView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + 0, p[1] + -resetCameraD, p[2] + 0); controls.up0.set(0, 0, 1); controls.reset() },  // front
  function () { toOrtho(topView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + 0, p[1] + 0, p[2] + resetCameraD); controls.up0.set(0, 1, 0); controls.reset() },  // top
  function () { toOrtho(bottomView); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + 0, p[1] + 0, p[2] + -resetCameraD); controls.up0.set(0, -1, 0); controls.reset() }, // bottom
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + resetCameraD, p[1] + -resetCameraD, p[2] + resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + resetCameraD, p[1] + resetCameraD, p[2] + resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + -resetCameraD, p[1] + resetCameraD, p[2] + resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + -resetCameraD, p[1] + -resetCameraD, p[2] + resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + resetCameraD, p[1] + -resetCameraD, p[2] + -resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + resetCameraD, p[1] + resetCameraD, p[2] + -resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + -resetCameraD, p[1] + resetCameraD, p[2] + -resetCameraD); controls.up0.set(0, 0, 1); controls.reset() },
  function () { toPersp(); let p = getLookAt(); controls.target0.set(p[0], p[1], p[2]); controls.position0.set(p[0] + -resetCameraD, p[1] + -resetCameraD, p[2] + -resetCameraD); controls.up0.set(0, 0, 1); controls.reset() }
]

function commonViewCalc(left, right, top, bottom) {
  aspectRatio = canvas.width / canvas.height
  let width = (right - left)
  let height = (top - bottom)
  frustumSize = FRUSTUM_SIZE_FACTOR * height
  if (frustumSize * aspectRatio < FRUSTUM_SIZE_FACTOR * width) {
    frustumSize = FRUSTUM_SIZE_FACTOR * width / aspectRatio
  }
  return {
    left: -aspectRatio * frustumSize,
    right: aspectRatio * frustumSize,
    top: frustumSize,
    bottom: -frustumSize
  }
}
function rightView() {
  // console.log('rightView');
  let left = rangeValues.miny
  let right = rangeValues.maxy
  let top = rangeValues.maxz
  let bottom = rangeValues.minz
  return commonViewCalc(left, right, top, bottom)
}
function leftView() {
  // console.log('leftView');
  let left = rangeValues.maxy
  let right = rangeValues.miny
  let top = rangeValues.maxz
  let bottom = rangeValues.minz
  return commonViewCalc(left, right, top, bottom)
}
function backView() {
  // console.log('backView');
  let left = rangeValues.maxx
  let right = rangeValues.minx
  let top = rangeValues.maxz
  let bottom = rangeValues.minz
  return commonViewCalc(left, right, top, bottom)
}
function frontView() {
  // console.log('frontView');
  let left = rangeValues.minx
  let right = rangeValues.maxx
  let top = rangeValues.maxz
  let bottom = rangeValues.minz
  return commonViewCalc(left, right, top, bottom)
}
function topView() {
  // console.log('topView');
  let left = rangeValues.minx
  let right = rangeValues.maxx
  let top = rangeValues.maxy
  let bottom = rangeValues.miny
  return commonViewCalc(left, right, top, bottom)
}
function bottomView() {
  // console.log('bottomView');
  let left = rangeValues.minx
  let right = rangeValues.maxx
  let top = rangeValues.miny
  let bottom = rangeValues.maxy
  return commonViewCalc(left, right, top, bottom)
}

const viewMesh = []
const loadManager = new THREE.LoadingManager()
const loader = new THREE.TextureLoader(loadManager)
const circleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: false })

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
]

materials[0].map.center.set(.5, .5)
materials[0].map.rotation = THREE.Math.degToRad(90)
materials[1].map.center.set(.5, .5)
materials[1].map.rotation = THREE.Math.degToRad(-90)
materials[2].map.center.set(.5, .5)
materials[2].map.rotation = THREE.Math.degToRad(180)
materials[5].map.center.set(.5, .5)
materials[5].map.rotation = THREE.Math.degToRad(180)

const clickCallbacksByUUID = {}
loadManager.onLoad = () => {
  for (let i = 0; i < materials.length; i++) {
    viewMesh[i] = new THREE.Mesh(viewPlanes[i], materials[i])
    viewMesh[i].position.x = viewPositions[i][0]
    viewMesh[i].position.y = viewPositions[i][1]
    viewMesh[i].position.z = viewPositions[i][2]
    if (viewRotations[i].length == 3) {
      viewMesh[i].rotation.x = viewRotations[i][0]
      viewMesh[i].rotation.y = viewRotations[i][1]
      viewMesh[i].rotation.z = viewRotations[i][2]
    } else {
      const params = viewRotations[i]
      const euler = new THREE.Euler(params[0], params[1], params[2], params[3])
      viewMesh[i].setRotationFromEuler(euler)
    }
    clickCallbacksByUUID[viewMesh[i].uuid] = viewCallbacks[i]
    hud.add(viewMesh[i])
  }
}

// Axis labels:
const axisOffset = axisLength + 0.1
let text_opts_red = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 255, 'g': 0, 'b': 0, 'a': 1 }
}
let labels_data_x = ['X']
let labels_x = axisLabels(labels_data_x, { 'x': 1 }, [axisOffset, 0, 0],
  text_opts_red)
hud.add(labels_x)
let text_opts_green = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 255, 'b': 0, 'a': 1 }
}
let labels_data_y = ['Y']
let labels_y = axisLabels(labels_data_y, { 'y': 1 }, [0, axisOffset, 0],
  text_opts_green)
hud.add(labels_y)
let text_opts_blue = {
  'font_size': 20,
  'background_color': { 'r': 0, 'g': 0, 'b': 0, 'a': 1 },
  'text_color': { 'r': 0, 'g': 0, 'b': 255, 'a': 1 }
}
let labels_data_z = ['Z']
let labels_z = axisLabels(labels_data_z, { 'z': 1 }, [0, 0, axisOffset],
  text_opts_blue)
hud.add(labels_z)

hudScene.add(hud)

// Initialize cameras on startup:
cameraPerspective.position.x = resetCameraD
cameraPerspective.position.y = -resetCameraD
cameraPerspective.position.z = resetCameraD
cameraPerspective.up.y = 0
cameraPerspective.up.z = 1
cameraPerspective.lookAt([0, 0, 0])
activeCamera = cameraPerspective
cameraOrthographic.position.x = 0
cameraOrthographic.position.y = -2
cameraOrthographic.position.z = 0
cameraOrthographic.up.y = 0
cameraOrthographic.up.z = 1
cameraOrthographic.lookAt([0, 0, 0])
hudCameraPerspective.position.copy(cameraPerspective.position)
hudCameraPerspective.up.y = 0
hudCameraPerspective.up.z = 1
hudCameraPerspective.lookAt([0, 0, 0])
hudActiveCamera = hudCameraPerspective
hudCameraOrthographic.position.copy(cameraOrthographic.position)
hudCameraOrthographic.up.y = 0
hudCameraOrthographic.up.z = 1
hudCameraOrthographic.lookAt([0, 0, 0])
// const cameraHelper = new THREE.CameraHelper(activeCamera);
// scene.add(cameraHelper);

canvas.addEventListener('mousedown', onCanvasClick, false)
canvas.addEventListener('touchstart', onCanvasClick, false)

let controls = new THREE.TrackballControls(activeCamera, canvas)

controls.rotateSpeed = 2.0
controls.zoomSpeed = 1.2
controls.panSpeed = 0.8

controls.noZoom = false
controls.noPan = false

controls.staticMoving = true
controls.dynamicDampingFactor = 0.3

controls.keys = [65, 83, 68]

controls.addEventListener('change', render)
canvas.addEventListener('resize', onCanvasResize, false)
onCanvasResize()
animate()

function toOrtho(getViewport) {
  const viewport = getViewport()
  cameraOrthographic.position.copy(cameraPerspective.position)
  cameraOrthographic.up.copy(cameraPerspective.up)
  cameraOrthographic.left = viewport.left
  cameraOrthographic.right = viewport.right
  cameraOrthographic.top = viewport.top
  cameraOrthographic.bottom = viewport.bottom
  cameraOrthographic.zoom = 1.0
  cameraOrthographic.updateProjectionMatrix()
  cameraPerspective.fov = fov
  cameraPerspective.updateProjectionMatrix()
  activeCamera = cameraOrthographic
  controls.object = activeCamera
  hudActiveCamera = hudCameraOrthographic
  render()
}
function toPersp(matchOrtho) {
  cameraPerspective.fov = fov
  if (matchOrtho) {
    const eye = new THREE.Vector3().subVectors(cameraOrthographic.position, controls.target)
    const orthoHeight = (cameraOrthographic.top - cameraOrthographic.bottom) / cameraOrthographic.zoom

    // Calculate the distance needed to match the ortho scale.
    // We add an offset (half the model radius) to ensure we're looking at the face
    // from a safe distance, matching the scale at that forward plane.
    const requiredDistance = (orthoHeight / (2 * Math.tan(cameraPerspective.fov * Math.PI / 360))) + (modelRadius * 0.5)

    if (eye.lengthSq() < 0.000001) {
      cameraPerspective.position.set(requiredDistance, -requiredDistance, requiredDistance).add(controls.target)
    } else {
      eye.setLength(requiredDistance)
      cameraPerspective.position.copy(controls.target).add(eye)
    }
  } else {
    const eye = new THREE.Vector3().subVectors(cameraOrthographic.position, controls.target)
    if (eye.length() < resetCameraD) {
      eye.setLength(resetCameraD)
    }
    cameraPerspective.position.copy(controls.target).add(eye)
  }

  cameraPerspective.up.copy(cameraOrthographic.up)
  cameraPerspective.updateProjectionMatrix()
  activeCamera = cameraPerspective
  controls.object = activeCamera
  hudActiveCamera = hudCameraPerspective
  render()
}

let raycaster = new THREE.Raycaster()
let mouse = new THREE.Vector2()
let onClickPosition = new THREE.Vector2()
let getMousePosition = function (dom, x, y) {
  let rect = dom.getBoundingClientRect()
  return [(x + hudViewport.width - rect.right) / hudViewport.width,
  (y - rect.top) / hudViewport.height]
}
let getIntersects = function (point, objects) {
  mouse.set((point.x * 2) - 1, - (point.y * 2) + 1)
  raycaster.setFromCamera(mouse, hudActiveCamera)
  return raycaster.intersectObjects(objects)
}
function activateHudViewport() {
  // The TSL runtime has no viewport API; the HUD always lives on the legacy
  // r110 renderer, so fall back to it.
  const vpSource = (activeRenderer && activeRenderer.getViewport) ? activeRenderer : renderer
  if (vpSource && vpSource.getViewport) {
    vpSource.getViewport(fullViewport)
  }
  let width = hudSize
  const fvWidth = fullViewport.z || fullViewport.width
  const fvHeight = fullViewport.w || fullViewport.height
  if (fvWidth < hudSize) {
    width = fvWidth
  }
  let height = hudSize
  if (fvHeight < hudSize) {
    height = fvHeight
  }
  hudViewport.set(fvWidth - width, fvHeight - height,
    width, height)
  renderer.setViewport(hudViewport)
}
function onCanvasClick(evt) {
  let x, y
  if (evt.touches) {
    x = evt.touches[0].clientX
    y = evt.touches[0].clientY
  } else {
    x = evt.clientX
    y = evt.clientY
  }
  let array = getMousePosition(canvas, x, y)
  if (array[0] >= 0. && array[0] <= 1. && array[1] >= 0. && array[1] <= 1.) {
    evt.preventDefault()
    onClickPosition.fromArray(array)
    let intersects = getIntersects(onClickPosition, hud.children)
    for (let i = 0; i < intersects.length; i++) {
      const intersect = intersects[i]
      if (!intersect.uv || intersect.object.type !== 'Mesh') { continue }
      let clickCallback = clickCallbacksByUUID[intersect.object.uuid]
      if (clickCallback) {
        clickCallback()
        return false
      }
    }
  }

  const isLeftClick = evt.button === 0
  const isTouch = evt.touches && evt.touches.length === 1
  if (activeCamera.isOrthographicCamera && (isLeftClick || isTouch)) {
    // Switch to perspective mode and match the current ortho zoom/view exactly.
    toPersp(true)
    controls.update()
  }

  return true
}
function onCanvasResize() {
  const aspectRatio = canvas.width / canvas.height
  cameraOrthographic.left = -aspectRatio * frustumSize
  cameraOrthographic.right = aspectRatio * frustumSize
  cameraOrthographic.top = frustumSize
  cameraOrthographic.bottom = -frustumSize
  cameraOrthographic.updateProjectionMatrix()
  cameraPerspective.aspect = aspectRatio
  cameraPerspective.updateProjectionMatrix()

  let width = hudSize
  let height = hudSize
  if (canvas.width < hudSize) {
    width = canvas.width
  }
  if (canvas.height < hudSize) {
    height = canvas.height
  }
  const hudAspectRatio = width / height
  hudCameraOrthographic.left = -hudAspectRatio * hudFrustumSize
  hudCameraOrthographic.right = hudAspectRatio * hudFrustumSize
  hudCameraOrthographic.top = hudFrustumSize
  hudCameraOrthographic.bottom = -hudFrustumSize
  hudCameraOrthographic.updateProjectionMatrix()
  hudCameraPerspective.aspect = hudAspectRatio
  hudCameraPerspective.updateProjectionMatrix()

  if (currentLanguage === 'tsl' && tslRuntime) {
    tslRuntime.resize()
  }
  if (activeRenderer && typeof activeRenderer.setSize === 'function') {
    activeRenderer.setSize(canvas.width, canvas.height)
    if (activeRenderer.getViewport) {
      activeRenderer.getViewport(fullViewport)
    }
  } else {
    renderer.setSize(canvas.width, canvas.height)
    if (renderer.getViewport) {
      renderer.getViewport(fullViewport)
    }
  }
  controls.handleResize()
  render()
}
function animate() {
  controls.update()
  requestAnimationFrame(animate)
}

let errorRE = /ERROR: (\d+):(\d+):/
function checkCompilerErrors() {
  let currentCode = fsHeader + compilerSource
  for (let i = 0; i < renderer.info.programs.length; i++) {
    let program = renderer.info.programs[i]
    if (program.name !== 'ShaderMaterial' || !program.diagnostics) {
      continue
    }
    if (program.cacheKey.substr(0, currentCode.length) !== currentCode) {
      continue
    }
    if (program.diagnostics.fragmentShader.log) {
      let headerLines = fsHeader.split(/\r\n|\r|\n/).length
      let prefixLines = program.diagnostics.fragmentShader.prefix.split(/\r\n|\r|\n/).length
      let log = program.diagnostics.fragmentShader.log
      let logfDiv = document.getElementById('logf')
      let match = errorRE.exec(log)
      if (match) {
        // highlight the error location.
        let column = match[1]
        let line = match[2] - prefixLines - headerLines + 3
        highlightShaderError(line, column)
        log = 'ERROR: ' + (parseInt(column, 10) + 1).toString() + ':' + line.toString() + ':' + log.substr(match[0].length)
      }
      jsLogError('GLSL COMPILATION EXCEPTION:', log)
      console.error('GLSL COMPILATION EXCEPTION:', log)
    }
  }
}
function updateAxes() {
  if (mainAxesHelper) {
    mainAxesHelper.visible = axesParameters.showAxes
    // For GLSL mode, we use transparency and renderOrder to show through in a single pass
    mainAxesHelper.material.transparent = axesParameters.showThrough
    mainAxesHelper.material.depthTest = !axesParameters.showThrough
    mainAxesHelper.renderOrder = axesParameters.showThrough ? 1000 : 0
  }

  if (currentLanguage === 'wgsl' || currentLanguage === 'tsl') {
    const modelCanvas = currentLanguage === 'wgsl' ? gpuCanvas : tslCanvas
    if (axesParameters.showThrough) {
      canvas.style.zIndex = '1'
      modelCanvas.style.zIndex = '0'
    } else {
      canvas.style.zIndex = '0'
      modelCanvas.style.zIndex = '1'
    }
    modelCanvas.style.pointerEvents = 'none'
    // Keep the inactive model canvas out of the stacking order.
    ;(currentLanguage === 'wgsl' ? tslCanvas : gpuCanvas).style.zIndex = '0'
  } else {
    canvas.style.zIndex = '1'
    gpuCanvas.style.zIndex = '0'
    tslCanvas.style.zIndex = '0'
  }
}

function render() {
  if (modelCentroidNull != null) {
    modelCentroidNull.lookAt(activeCamera.position)
    modelCentroidNull.updateMatrixWorld()
  }

  if (currentLanguage === 'tsl' && tslRuntime) {
    tslRuntime.render(activeCamera)
    // The legacy renderer draws the axes/HUD overlay on its own canvas.
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, activeCamera)
  } else if (activeRenderer && activeRenderer === webgpuRenderer) {
    webgpuRenderer.render(scene, activeCamera)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, activeCamera)
    checkCompilerErrors()
  } else if (activeRenderer) {
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(scene, activeCamera)
    checkCompilerErrors()
  }

  activateHudViewport()
  renderer.clearDepth()
  hudActiveCamera.quaternion.copy(activeCamera.quaternion)
  hudActiveCamera.position.set(0, 0, 3.25)
  hudActiveCamera.position.applyQuaternion(hudActiveCamera.quaternion)
  renderer.render(hudScene, hudActiveCamera)
  // console.log('restoring viewport to full canvas:', fullViewport);
  renderer.setViewport(fullViewport)
}
