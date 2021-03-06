/**
 * @author Eberhard Graether / http://egraether.com/
 * @author Mark Lundin / http://mark-lundin.com
 * @author Simone Manini / http://daron1337.github.io
 * @author Luca Antiga / http://lantiga.github.io
 */

THREE.TrackballControls = function (object, domElement) {

  var _this = this;
  var STATE = { NONE: - 1, ROTATE: 0, ZOOM: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_ZOOM_PAN: 4 };

  this.object = object;
  this.domElement = (domElement !== undefined) ? domElement : document;

  // API

  this.enabled = true;

  this.screen = { left: 0, top: 0, width: 0, height: 0 };

  this.rotateSpeed = 1.0;
  this.zoomSpeed = 1.2;
  this.panSpeed = 0.3;

  this.noRotate = false;
  this.noZoom = false;
  this.noPan = false;

  this.staticMoving = false;
  this.dynamicDampingFactor = 0.2;

  this.minDistance = 0;
  this.maxDistance = Infinity;

  this.keys = [65 /*A*/, 83 /*S*/, 68 /*D*/];

  // internals

  this.target = new THREE.Vector3();

  var EPS = 0.000001;

  var lastPosition = new THREE.Vector3();

  var _state = STATE.NONE,
      _prevState = STATE.NONE,

      _eye = new THREE.Vector3(),

      _movePrev = new THREE.Vector2(),
      _moveCurr = new THREE.Vector2(),

      _lastAxis = new THREE.Vector3(),
      _lastAngle = 0,

      _zoomStart = new THREE.Vector2(),
      _zoomEnd = new THREE.Vector2(),

      _touchZoomDistanceStart = 0,
      _touchZoomDistanceEnd = 0,

      _panStart = new THREE.Vector2(),
      _panEnd = new THREE.Vector2();

  // for reset

  this.target0 = this.target.clone();
  this.position0 = this.object.position.clone();
  this.up0 = this.object.up.clone();

  // events

  var changeEvent = { type: 'change' };
  var startEvent = { type: 'start' };
  var endEvent = { type: 'end' };


  // methods

  this.handleResize = function () {

    if (this.domElement === document) {

      this.screen.left = 0;
      this.screen.top = 0;
      this.screen.width = window.innerWidth;
      this.screen.height = window.innerHeight;

    } else {

      var box = this.domElement.getBoundingClientRect();
      // adjustments come from similar code in the jquery offset() function
      var d = this.domElement.ownerDocument.documentElement;
      this.screen.left = box.left + window.pageXOffset - d.clientLeft;
      this.screen.top = box.top + window.pageYOffset - d.clientTop;
      this.screen.width = box.width;
      this.screen.height = box.height;

    }

  };

  var getMouseOnScreen = (function () {

    var vector = new THREE.Vector2();

    return function getMouseOnScreen(pageX, pageY) {

      vector.set(
        (pageX - _this.screen.left) / _this.screen.width,
        (pageY - _this.screen.top) / _this.screen.height
      );

      return vector;

    };

  }());

  var getMouseOnCircle = (function () {

    var vector = new THREE.Vector2();

    return function getMouseOnCircle(pageX, pageY) {

      vector.set(
        ((pageX - _this.screen.width * 0.5 - _this.screen.left) / (_this.screen.width * 0.5)),
        ((_this.screen.height + 2 * (_this.screen.top - pageY)) / _this.screen.width) // screen.width intentional
      );

      return vector;

    };

  }());

  this.rotateCamera = (function () {

    var axis = new THREE.Vector3(),
        quaternion = new THREE.Quaternion(),
        eyeDirection = new THREE.Vector3(),
        objectUpDirection = new THREE.Vector3(),
        objectSidewaysDirection = new THREE.Vector3(),
        moveDirection = new THREE.Vector3(),
        angle;

    return function rotateCamera() {

      moveDirection.set(_moveCurr.x - _movePrev.x, _moveCurr.y - _movePrev.y, 0);
      angle = moveDirection.length();

      if (angle) {

        _eye.copy(_this.object.position).sub(_this.target);

        eyeDirection.copy(_eye).normalize();
        objectUpDirection.copy(_this.object.up).normalize();
        objectSidewaysDirection.crossVectors(objectUpDirection, eyeDirection).normalize();

        objectUpDirection.setLength(_moveCurr.y - _movePrev.y);
        objectSidewaysDirection.setLength(_moveCurr.x - _movePrev.x);

        moveDirection.copy(objectUpDirection.add(objectSidewaysDirection));

        axis.crossVectors(moveDirection, _eye).normalize();

        angle *= _this.rotateSpeed;
        quaternion.setFromAxisAngle(axis, angle);

        _eye.applyQuaternion(quaternion);
        _this.object.up.applyQuaternion(quaternion);

        _lastAxis.copy(axis);
        _lastAngle = angle;

      } else if (!_this.staticMoving && _lastAngle) {

        _lastAngle *= Math.sqrt(1.0 - _this.dynamicDampingFactor);
        _eye.copy(_this.object.position).sub(_this.target);
        quaternion.setFromAxisAngle(_lastAxis, _lastAngle);
        _eye.applyQuaternion(quaternion);
        _this.object.up.applyQuaternion(quaternion);

      }

      _movePrev.copy(_moveCurr);

    };

  }());


  this.zoomCamera = function () {

    var factor;

    if (_state === STATE.TOUCH_ZOOM_PAN) {

      factor = _touchZoomDistanceStart / _touchZoomDistanceEnd;
      _touchZoomDistanceStart = _touchZoomDistanceEnd;
      _eye.multiplyScalar(factor);

    } else {

      factor = 1.0 + (_zoomEnd.y - _zoomStart.y) * _this.zoomSpeed;

      if (factor !== 1.0 && factor > 0.0) {

        _eye.multiplyScalar(factor);

      }

      if (_this.staticMoving) {

        _zoomStart.copy(_zoomEnd);

      } else {

        _zoomStart.y += (_zoomEnd.y - _zoomStart.y) * this.dynamicDampingFactor;

      }

    }

  };

  this.panCamera = (function () {

    var mouseChange = new THREE.Vector2(),
        objectUp = new THREE.Vector3(),
        pan = new THREE.Vector3();

    return function panCamera() {

      mouseChange.copy(_panEnd).sub(_panStart);

      if (mouseChange.lengthSq()) {

        mouseChange.multiplyScalar(_eye.length() * _this.panSpeed);

        pan.copy(_eye).cross(_this.object.up).setLength(mouseChange.x);
        pan.add(objectUp.copy(_this.object.up).setLength(mouseChange.y));

        _this.object.position.add(pan);
        _this.target.add(pan);

        if (_this.staticMoving) {

          _panStart.copy(_panEnd);

        } else {

          _panStart.add(mouseChange.subVectors(_panEnd, _panStart).multiplyScalar(_this.dynamicDampingFactor));

        }

      }

    };

  }());

  this.checkDistances = function () {

    if (!_this.noZoom || !_this.noPan) {

      if (_eye.lengthSq() > _this.maxDistance * _this.maxDistance) {

        _this.object.position.addVectors(_this.target, _eye.setLength(_this.maxDistance));
        _zoomStart.copy(_zoomEnd);

      }

      if (_eye.lengthSq() < _this.minDistance * _this.minDistance) {

        _this.object.position.addVectors(_this.target, _eye.setLength(_this.minDistance));
        _zoomStart.copy(_zoomEnd);

      }

    }

  };

  this.update = function () {

    _eye.subVectors(_this.object.position, _this.target);

    if (!_this.noRotate) {

      _this.rotateCamera();

    }

    if (!_this.noZoom) {

      _this.zoomCamera();

    }

    if (!_this.noPan) {

      _this.panCamera();

    }

    _this.object.position.addVectors(_this.target, _eye);

    _this.checkDistances();

    _this.object.lookAt(_this.target);

    if (lastPosition.distanceToSquared(_this.object.position) > EPS) {

      _this.dispatchEvent(changeEvent);

      lastPosition.copy(_this.object.position);

    }

  };

  this.reset = function () {

    _state = STATE.NONE;
    _prevState = STATE.NONE;

    _this.target.copy(_this.target0);
    _this.object.position.copy(_this.position0);
    _this.object.up.copy(_this.up0);

    _eye.subVectors(_this.object.position, _this.target);

    _this.object.lookAt(_this.target);

    _this.dispatchEvent(changeEvent);

    lastPosition.copy(_this.object.position);

  };

  // listeners

  function keydown(event) {

    if (_this.enabled === false) return;

    window.removeEventListener('keydown', keydown);

    _prevState = _state;

    if (_state !== STATE.NONE) {

      return;

    } else if (event.keyCode === _this.keys[STATE.ROTATE] && !_this.noRotate) {

      _state = STATE.ROTATE;

    } else if (event.keyCode === _this.keys[STATE.ZOOM] && !_this.noZoom) {

      _state = STATE.ZOOM;

    } else if (event.keyCode === _this.keys[STATE.PAN] && !_this.noPan) {

      _state = STATE.PAN;

    }

  }

  function keyup(event) {

    if (_this.enabled === false) return;

    _state = _prevState;

    window.addEventListener('keydown', keydown, false);

  }

  function mousedown(event) {

    if (_this.enabled === false) return;

    event.preventDefault();
    event.stopPropagation();

    if (_state === STATE.NONE) {

      _state = event.button;

    }

    if (_state === STATE.ROTATE && !_this.noRotate) {

      _moveCurr.copy(getMouseOnCircle(event.pageX, event.pageY));
      _movePrev.copy(_moveCurr);

    } else if (_state === STATE.ZOOM && !_this.noZoom) {

      _zoomStart.copy(getMouseOnScreen(event.pageX, event.pageY));
      _zoomEnd.copy(_zoomStart);

    } else if (_state === STATE.PAN && !_this.noPan) {

      _panStart.copy(getMouseOnScreen(event.pageX, event.pageY));
      _panEnd.copy(_panStart);

    }

    document.addEventListener('mousemove', mousemove, false);
    document.addEventListener('mouseup', mouseup, false);

    _this.dispatchEvent(startEvent);

  }

  function mousemove(event) {

    if (_this.enabled === false) return;

    event.preventDefault();
    event.stopPropagation();

    if (_state === STATE.ROTATE && !_this.noRotate) {

      _movePrev.copy(_moveCurr);
      _moveCurr.copy(getMouseOnCircle(event.pageX, event.pageY));

    } else if (_state === STATE.ZOOM && !_this.noZoom) {

      _zoomEnd.copy(getMouseOnScreen(event.pageX, event.pageY));

    } else if (_state === STATE.PAN && !_this.noPan) {

      _panEnd.copy(getMouseOnScreen(event.pageX, event.pageY));

    }

  }

  function mouseup(event) {

    if (_this.enabled === false) return;

    event.preventDefault();
    event.stopPropagation();

    _state = STATE.NONE;

    document.removeEventListener('mousemove', mousemove);
    document.removeEventListener('mouseup', mouseup);
    _this.dispatchEvent(endEvent);

  }

  function mousewheel(event) {

    if (_this.enabled === false) return;

    if (_this.noZoom === true) return;

    event.preventDefault();
    event.stopPropagation();

    switch (event.deltaMode) {

    case 2:
      // Zoom in pages
      _zoomStart.y -= event.deltaY * 0.025;
      break;

    case 1:
      // Zoom in lines
      _zoomStart.y -= event.deltaY * 0.01;
      break;

    default:
      // undefined, 0, assume pixels
      _zoomStart.y -= event.deltaY * 0.00025;
      break;

    }

    _this.dispatchEvent(startEvent);
    _this.dispatchEvent(endEvent);

  }

  function touchstart(event) {

    if (_this.enabled === false) return;

    event.preventDefault();

    switch (event.touches.length) {

    case 1:
      _state = STATE.TOUCH_ROTATE;
      _moveCurr.copy(getMouseOnCircle(event.touches[0].pageX, event.touches[0].pageY));
      _movePrev.copy(_moveCurr);
      break;

    default: // 2 or more
      _state = STATE.TOUCH_ZOOM_PAN;
      var dx = event.touches[0].pageX - event.touches[1].pageX;
      var dy = event.touches[0].pageY - event.touches[1].pageY;
      _touchZoomDistanceEnd = _touchZoomDistanceStart = Math.sqrt(dx * dx + dy * dy);

      var x = (event.touches[0].pageX + event.touches[1].pageX) / 2;
      var y = (event.touches[0].pageY + event.touches[1].pageY) / 2;
      _panStart.copy(getMouseOnScreen(x, y));
      _panEnd.copy(_panStart);
      break;

    }

    _this.dispatchEvent(startEvent);

  }

  function touchmove(event) {

    if (_this.enabled === false) return;

    event.preventDefault();
    event.stopPropagation();

    switch (event.touches.length) {

    case 1:
      _movePrev.copy(_moveCurr);
      _moveCurr.copy(getMouseOnCircle(event.touches[0].pageX, event.touches[0].pageY));
      break;

    default: // 2 or more
      var dx = event.touches[0].pageX - event.touches[1].pageX;
      var dy = event.touches[0].pageY - event.touches[1].pageY;
      _touchZoomDistanceEnd = Math.sqrt(dx * dx + dy * dy);

      var x = (event.touches[0].pageX + event.touches[1].pageX) / 2;
      var y = (event.touches[0].pageY + event.touches[1].pageY) / 2;
      _panEnd.copy(getMouseOnScreen(x, y));
      break;

    }

  }

  function touchend(event) {

    if (_this.enabled === false) return;

    switch (event.touches.length) {

    case 0:
      _state = STATE.NONE;
      break;

    case 1:
      _state = STATE.TOUCH_ROTATE;
      _moveCurr.copy(getMouseOnCircle(event.touches[0].pageX, event.touches[0].pageY));
      _movePrev.copy(_moveCurr);
      break;

    }

    _this.dispatchEvent(endEvent);

  }

  function contextmenu(event) {

    if (_this.enabled === false) return;

    event.preventDefault();

  }

  this.dispose = function () {

    this.domElement.removeEventListener('contextmenu', contextmenu, false);
    this.domElement.removeEventListener('mousedown', mousedown, false);
    this.domElement.removeEventListener('wheel', mousewheel, false);

    this.domElement.removeEventListener('touchstart', touchstart, false);
    this.domElement.removeEventListener('touchend', touchend, false);
    this.domElement.removeEventListener('touchmove', touchmove, false);

    document.removeEventListener('mousemove', mousemove, false);
    document.removeEventListener('mouseup', mouseup, false);

    window.removeEventListener('keydown', keydown, false);
    window.removeEventListener('keyup', keyup, false);

  };

  this.domElement.addEventListener('contextmenu', contextmenu, false);
  this.domElement.addEventListener('mousedown', mousedown, false);
  this.domElement.addEventListener('wheel', mousewheel, false);

  this.domElement.addEventListener('touchstart', touchstart, false);
  this.domElement.addEventListener('touchend', touchend, false);
  this.domElement.addEventListener('touchmove', touchmove, false);

  window.addEventListener('keydown', keydown, false);
  window.addEventListener('keyup', keyup, false);

  this.handleResize();

  // force an update at start
  this.update();

};

THREE.TrackballControls.prototype = Object.create(THREE.EventDispatcher.prototype);
THREE.TrackballControls.prototype.constructor = THREE.TrackballControls;

function toBinaryInt(num) {
  /**
   * @author fernandosavio
   * http://stackoverflow.com/a/16155417/1763602
   */

  "use strict";

  return (num >>> 0).toString(2);  // jshint ignore:line
}

function getNextPowerOfTwo(num) {
  /**
   *  @author Marco Sulla (marcosullaroma@gmail.com)
   *  @date Feb 17, 2016
   */

  "use strict";

  if (num < 0) {
    throw new Error("Argument must be positive");
  }

  var bin_str = toBinaryInt(num - 1);

  if (bin_str.indexOf("0") < 0 || bin_str === "0") {
    return num;
  }
  else {
    return Math.pow(2, bin_str.length);
  }
}

function adaptCanvasToText(canvas, message, font_size, font_face) {
  /**
   *  @author Marco Sulla (marcosullaroma@gmail.com)
   *  @date Feb 17, 2016
   */

  "use strict";

  var context = canvas.getContext('2d');

  if (canvas.height > canvas.width) {
    canvas.width = canvas.height;
  }


  while (true) {
    var side = getNextPowerOfTwo(canvas.width);

    if (side < 128) {
      side = 128;
    }

    canvas.width = canvas.height = side;

    context.font = "Bold " + font_size + "pt " + font_face;

    var metrics = context.measureText(message);
    var text_width = metrics.width;
    var text_side = getNextPowerOfTwo(Math.max(text_width, font_size));

    if (text_side >= 128) {
      if (side !== text_side) {
        canvas.width = text_side;
        continue;
      }
    }
    else if (side !== 128) {
      canvas.width = 128;
      continue;
    }

    break;
  }
}

function getVector3(arg1, y, z) {
  /**
   *  @author Marco Sulla (marcosullaroma@gmail.com)
   *  @date Feb 17, 2016
   */

  "use strict";

  var x_new;
  var y_new;
  var z_new;

  if (y !== undefined) {
    if (z !== undefined) {
      x_new = arg1;
      y_new = y;
      z_new = z;
    }
    else {
      throw new Error("Arguments must be one or three");
    }
  }
  else {
    if (!(arg1.x === undefined || arg1.y === undefined ||
          arg1.z === undefined)) {

      x_new = arg1.x;
      y_new = arg1.y;
      z_new = arg1.z;
    }
    else if (!(arg1[0] === undefined || arg1[1] === undefined ||
               arg1[2] === undefined)) {

      x_new = arg1[0];
      y_new = arg1[1];
      z_new = arg1[2];
    }
    else {
      throw new Error("Malformed argument or unsupported type. " +
                      "Argument: " + arg1.toString());
    }
  }

  return new THREE.Vector3(x_new, y_new, z_new);
}

function makeTextSprite(message, opts) {  // jshint ignore:line
  /**
   *  @author Lee Stemkoski
   *  @author Marco Sulla (marcosullaroma@gmail.com)
   *
   *  https://stemkoski.github.io/Three.js/Sprite-Text-Labels.html
   *
   */

  "use strict";

  if (opts === undefined) {
    opts = {};
  }

  var possible_opts = ["font_face", "font_size", "border_thickness",
                       "border_color", "background_color", "text_color"];

  for (var k in opts) {
    if (opts.hasOwnProperty(k)) {
      if (possible_opts.indexOf(k) < 0) {
        throw new Error("Unknown option '" + k.toString() + "'");
      }
    }
  }

  if (opts["font_face"] === undefined) {
    opts["font_face"] = "Arial";
  }

  if (opts["font_size"] === undefined) {
    opts["font_size"] = 100;
  }

  var font_size = opts["font_size"];

  if (font_size <= 0) {
    throw new Error("'font_size' must be a positive number");
  }

  if (opts["border_thickness"] === undefined) {
    opts["border_thickness"] = 0;
  }

  if (opts["border_thickness"] < 0) {
    throw new Error("'border_thickness' must be >= 0");
  }

  if (opts["border_color"] === undefined) {
    opts["border_color"] = { r: 0, g: 0, b: 0, a: 1.0 };
  }

  if (opts["background_color"] === undefined) {
    opts["background_color"] = { r: 255, g: 255, b: 255, a: 1.0 };
  }

  if (opts["text_color"] === undefined) {
    opts["text_color"] = { r: 0, g: 0, b: 0, a: 1 };
  }

  var border_color = opts["border_color"];
  var background_color = opts["background_color"];
  var text_color = opts["text_color"];

  var sprite_align;

  // if (old) {
  //   sprite_align = THREE.SpriteAlignment.topLeft;
  // }

  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');

  adaptCanvasToText(canvas, message, font_size, opts["font_face"]);

  var scale;

  if (canvas.width > 128) {
    scale = canvas.width / 128;
  }

  // background color
  context.fillStyle = ("rgba(" + background_color.r + "," +
                       background_color.g + "," + background_color.b + "," +
                       background_color.a + ")");
  // border color
  context.strokeStyle = ("rgba(" + border_color.r + "," + border_color.g +
                         "," + border_color.b + "," + border_color.a + ")");

  context.lineWidth = opts["border_thickness"];
  // 1.4 is extra height factor for text below baseline: g,j,p,q.

  // text color
  context.fillStyle = ("rgba(" + text_color.r + "," + text_color.g +
                       "," + text_color.b + "," + text_color.a + ")");

  var metrics = context.measureText(message);
  var text_width = metrics.width;

  // console.log(text_width);

  context.fillText(message, (canvas.width - text_width) / 2, canvas.height / 2 + font_size / 2);

  // canvas contents will be used for a texture
  var texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;

  var spriteMaterial;

  // if (old) {
  //   spriteMaterial = new THREE.SpriteMaterial({
  //     map: texture,
  //     useScreenCoordinates: false,
  //     alignment: sprite_align,
  //   });
  // }
  // else {
  spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  // }

  var sprite = new THREE.Sprite(spriteMaterial);

  if (scale) {
    sprite.scale.set(scale, scale, 1);
  }

  return sprite;
}


function axisLabels(data, steps, position, text_opts) {
  /**
   *  @author Sue Lockwood
   *  @author Marco Sulla (marcosullaroma@gmail.com)
   *
   *  https://bocoup.com/weblog/learning-three-js-with-real-world-challenges-that-have-already-been-solved
   *
   */

  "use strict";

  var p = { x: 0, y: 0, z: 0 };
  var dobj = new THREE.Object3D();
  var axes = ["x", "y", "z"];
  var axis;

  for (var i = 0; i < data.length; i += 1) {
    var label = makeTextSprite(data[i], text_opts);

    label.position.set(p.x, p.y, p.z);

    dobj.add(label);

    for (var j = 0; j < axes.length; j += 1) {
      axis = axes[j];
      var step = steps[axis];

      if (step) {
        p[axis] += step;
      }
    }
  }

  dobj.position.copy(getVector3(position));

  return dobj;
}
