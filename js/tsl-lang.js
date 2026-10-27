"use strict";

// tsl-lang.js
// A Monaco Monarch tokenizer for TSL (Three.js Shading Language) bodies,
// which are JavaScript programs that build a node graph.

var tsl = {
  keywords: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set true false null undefined".split(/\s+/),
  typeKeywords: "float int uint bool vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 mat2x2 mat3x3 mat4x4 color".split(/\s+/),
  // TSL functions, node constructors, and shader globals.
  tslKeywords: "Fn If Loop While Switch Break Continue Return Var Const select mix clamp step smoothstep min max abs sign floor ceil fract mod pow exp log sqrt inverse exp2 log2 sin cos tan asin acos atan atan2 length distance dot cross normalize reflect refract faceforward sin cos transformDirection positionGeometry positionLocal positionWorld positionWorldDirection normalLocal normalWorld normalView viewportUV instanceIndex instanceMatrix uniform uniformArray texture textureLoad sampler uv vertexIndex drawIndex array element attribute varying Fn wgslFn glslFn screenUV screenCoordinate modelWorldMatrix modelViewMatrix cameraPosition cameraProjectionMatrix".split(/\s+/),
  operators: ['=', '>', '<', '==', '<=', '>=', '!=', '===', '!==', '+', '-', '*', '/', '%', '&&', '||', '!', '++', '--', '+=', '-=', '*=', '/=', '=>'],
  symbols: /[=><!~?:&|+\-*\/%^]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

  tokenizer: {
    root: [
      // identifiers and keywords
      [/[a-z_$][\w$]*/, {
        cases: {
          '@typeKeywords': 'keyword',
          '@tslKeywords': 'keyword',
          '@keywords': 'keyword',
          '@default': 'identifier'
        }
      }],
      [/[A-Z][\w\$]*/, 'type.identifier'], // class names

      { include: '@whitespace' },

      // delimiters and operators
      [/[{}()\[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': ''
        }
      }],

      // numbers
      [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],

      // delimiter: after number because of .\d floats
      [/[;,.]/, 'delimiter'],

      // strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-terminated string
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

      // characters
      [/'[^\\']'/, 'string'],
      [/'/, 'string.invalid']
    ],

    comment: [
      [/[^\/*]+/, 'comment'],
      [/\/\*/, 'comment', '@push'], // nested comment
      ['\\*/', 'comment', '@pop'],
      [/[\/*]/, 'comment']
    ],

    string: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
    ],

    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment']
    ]
  }
};

exports.tsl = tsl;
