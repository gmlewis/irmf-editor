// Shared TSL body evaluator.
//
// This module is deliberately free of any Node.js or DOM API so that the
// browser editor can vendor it unchanged. It is given a `tslNamespace` object
// (the names exported by `three/tsl`) and evaluates a canonical IRMF TSL body
// with those names injected as lexical bindings.
//
// Security note: TSL bodies are executable JavaScript. This evaluator is not a
// sandbox. Callers must treat untrusted input as untrusted code (the CLI runs
// it in a child process with a timeout; the editor asks the user first).

const IDENT_RE = /^[A-Za-z_$][0-9A-Za-z_$]*$/;

// JavaScript reserved words and bindings that cannot appear in a const
// destructuring pattern. TSL export names that collide are skipped.
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'let', 'static', 'await', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'arguments', 'eval',
]);

const ENTRY_NAMES = ['mainModel4', 'mainModel9', 'mainModel16', 'mainModel32', 'mainModel48'];

// Names shadowed inside the evaluated body. This is a guardrail, not a
// hardened sandbox: a determined body can still reach `globalThis`. The CLI
// additionally runs the body in a permission-restricted child process.
const SHADOWED = 'fetch, XMLHttpRequest, WebSocket, EventSource, importScripts, require, process';

/** Build the fixed-line-count prelude that injects the TSL namespace. */
export function buildPrelude(tslNamespace) {
  const names = Object.keys(tslNamespace || {})
    .filter((n) => IDENT_RE.test(n) && !RESERVED.has(n))
    .sort();
  return (
    '"use strict";\n' +
    `const { ${names.join(', ')} } = TSL;\n` +
    `const ${SHADOWED.replace(/, /g, ' = undefined, ')} = undefined;\n`
  );
}

export const PRELUDE_LINES = 3; // newlines in buildPrelude output

function firstStackLine(err) {
  const stack = String((err && err.stack) || '');
  let m = /<anonymous>:(\d+):(\d+)/.exec(stack);
  if (m) return { line: Number(m[1]), col: Number(m[2]) };
  m = /\bFunction:(\d+):(\d+)/.exec(stack);
  if (m) return { line: Number(m[1]), col: Number(m[2]) };
  m = /(?:^|[\s(])(?:eval|Function)[^:]*:(\d+):(\d+)/.exec(stack);
  if (m) return { line: Number(m[1]), col: Number(m[2]) };
  return null;
}

let cachedWrapperOffset = null;

// V8 wraps a `new Function` body so stack lines are shifted by a constant.
// Measure it once instead of hard-coding a version-specific value.
function wrapperOffset() {
  if (cachedWrapperOffset !== null) return cachedWrapperOffset;
  cachedWrapperOffset = 2;
  try {
    const src = '\n\n\n\nthrow new Error("IRMF_CALIBRATE");'; // throw on line 5
    try {
      // eslint-disable-next-line no-new-func
      new Function(src)();
    } catch (e) {
      const loc = firstStackLine(e);
      if (loc) cachedWrapperOffset = Math.max(0, loc.line - 5);
    }
  } catch {
    /* keep fallback */
  }
  return cachedWrapperOffset;
}

/** Strip a leading `import ... from 'three/...'` while preserving line count. */
function stripLeadingImports(src, warnings) {
  let s = src.replace(/^﻿/, '');
  const re = /^\s*import\s+[^;]+?\bfrom\s*['"](?:three(?:\/(?:tsl|nodes|webgpu))?)['"]\s*;?[ \t]*\r?\n?/;
  let guard = 0;
  for (;;) {
    const m = re.exec(s);
    if (!m || guard++ > 20) break;
    const newlines = (m[0].match(/\n/g) || []).length;
    warnings.push(
      'stripped a leading `import ... from three/...` statement; canonical TSL bodies rely on host-injected names'
    );
    s = '\n'.repeat(newlines) + s.slice(m[0].length);
  }
  return s;
}

function findSyntaxErrorLine(body, assemble) {
  const lines = body.split('\n');
  for (let i = 1; i <= lines.length; i++) {
    try {
      // eslint-disable-next-line no-new-func
      new Function('TSL', assemble(lines.slice(0, i).join('\n')));
    } catch {
      return i;
    }
  }
  return 1;
}

function checkModuleSyntax(body) {
  if (/(^|\n)[ \t]*export\b/.test(body)) {
    return 'TSL bodies must not contain `export` statements (hosts inject the entry point)';
  }
  if (/\bimport\s*\(/.test(body)) {
    return 'TSL bodies must not use dynamic `import()`';
  }
  return null;
}

/**
 * Evaluate a TSL body.
 *
 * @param {string} source - The decoded TSL JavaScript body.
 * @param {object} tslNamespace - The names exported by `three/tsl`.
 * @param {object} [opts]
 * @returns {{entries: Object<string, Function>, warnings: string[],
 *            diagnostics: Array<{line:number,col:number,message:string}>,
 *            mapLine: (line:number)=>number}}
 */
export function evaluateTSL(source, tslNamespace, opts = {}) {
  const warnings = [];
  const body = stripLeadingImports(String(source), warnings);
  const prelude = buildPrelude(tslNamespace);
  const offset = wrapperOffset();

  const mapLine = (reported) => Math.max(1, reported - offset - PRELUDE_LINES);
  const diag = (err) => {
    const loc = firstStackLine(err);
    return {
      line: loc ? mapLine(loc.line) : 1,
      col: loc ? loc.col : 1,
      message: (err && err.message) || String(err),
    };
  };

  const syntaxProblem = checkModuleSyntax(body);
  if (syntaxProblem) {
    return { entries: {}, warnings, diagnostics: [{ line: 1, col: 1, message: syntaxProblem }], mapLine };
  }

  const epilogue =
    '\n;return {' +
    ENTRY_NAMES.map(
      (n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined,`
    ).join('') +
    '};';

  let jsFunc;
  try {
    // eslint-disable-next-line no-new-func
    jsFunc = new Function('TSL', prelude + body + epilogue);
  } catch (err) {
    // V8 does not report a location for syntax errors raised by `new Function`.
    // Find the first body line whose prefix no longer parses as a best effort.
    const line = findSyntaxErrorLine(body, (prefix) => prelude + prefix + epilogue);
    return { entries: {}, warnings, diagnostics: [{ line, col: 1, message: (err && err.message) || String(err) }], mapLine };
  }

  let result;
  try {
    result = jsFunc(tslNamespace);
  } catch (err) {
    return { entries: {}, warnings, diagnostics: [diag(err)], mapLine };
  }

  const entries = {};
  for (const name of ENTRY_NAMES) {
    if (typeof result[name] === 'function') entries[name] = result[name];
  }
  return { entries, warnings, diagnostics: [], mapLine };
}

/**
 * Call an entry point with a vec3 node and return its raw result.
 * `Fn` entries are unwrapped because three r180 cannot represent an array
 * return through the `Fn` object (it wraps the array in a node object).
 */
export function callEntry(entry, xyz) {
  if (entry && entry.isFn && entry.shaderNode && typeof entry.shaderNode.jsFunc === 'function') {
    return entry.shaderNode.jsFunc([xyz]);
  }
  return entry(xyz);
}
