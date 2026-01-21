"use strict";

// glsl-language.js
var wgsl = {  // hack
  // Set defaultToken to invalid to see what you do not tokenize yet
  // defaultToken: 'invalid',
  keywords: "bitcast break case continue continuing default discard else enable fallthrough fn for if let loop return struct switch type var while alias const override static storage uniform workgroup read write read_write function private".split(/\s+/),
  typeKeywords: "bool f16 f32 i32 u32 vec2 vec3 vec4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 atomic ptr sampler sampler_comparison texture_1d texture_2d texture_2d_array texture_3d texture_cube texture_cube_array texture_multisampled_2d texture_storage_1d texture_storage_2d texture_storage_2d_array texture_storage_3d texture_external".split(/\s+/),
  operators: ['=', '>', '<', '==', '<=', '>=', '!=', '<>', '+', '-', '*', '/', '&&', '||', '++', '--'],
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
  // The main tokenizer for our languages
  tokenizer: {
    root: [// identifiers and keywords
      [/[a-z_$][\w$]*/, {
        cases: {
          '@typeKeywords': 'keyword',
          '@keywords': 'keyword',
          '@default': 'identifier'
        }
      }], [/[A-Z][\w\$]*/, 'type.identifier'], // to show class names nicely
      // whitespace
      {
        include: '@whitespace'
      }, [/^\s*#\s*\w+/, 'keyword'], // delimiters and operators
      [/[{}()\[\]]/, '@brackets'], // @ annotations.
      // As an example, we emit a debugging log message on these tokens.
      // Note: message are supressed during the first load -- change some lines to see them.
      // eslint-disable-next-line no-useless-escape
      [/@\s*[a-zA-Z_\$][\w\$]*/, {
        token: 'annotation',
        log: 'annotation token: $0'
      }], // numbers
      [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'], [/0[xX][0-9a-fA-F]+/, 'number.hex'], [/\d+/, 'number'], // delimiter: after number because of .\d floats
      [/[;,.]/, 'delimiter'], // strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-teminated string
      [/"/, {
        token: 'string.quote',
        bracket: '@open',
        next: '@string'
      }], // characters
      [/'[^\\']'/, 'string'], [/'/, 'string.invalid']],
    comment: [[/[^\/*]+/, 'comment'], [/\/\*/, 'comment', '@push'], // nested comment
    ['\\*/', 'comment', '@pop'], [/[\/*]/, 'comment']],
    string: [[/[^\\"]+/, 'string'], [/\\./, 'string.escape.invalid'], [/"/, {
      token: 'string.quote',
      bracket: '@close',
      next: '@pop'
    }]],
    whitespace: [[/[ \t\r\n]+/, 'white'], [/\/\*/, 'comment', '@comment'], [/\/\/.*$/, 'comment']]
  }
};
exports.wgsl = wgsl;
