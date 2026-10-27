#!/bin/bash
# Copy the shared TSL evaluator from irmf-examples into the editor.
#
# The evaluator is deliberately namespace-agnostic and free of Node/DOM APIs so
# the browser and the CLI compiler can share one implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDITOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="${IRMF_EXAMPLES_DIR:-/Users/glenn/src/github.com/gmlewis/irmf-examples}"

SRC="$EXAMPLES_DIR/tools/tsl-compiler/src/eval.mjs"
DST="$EDITOR_DIR/js/vendor/irmf-tsl/eval.mjs"

if [ ! -f "$SRC" ]; then
  echo "error: cannot find $SRC" >&2
  echo "Set IRMF_EXAMPLES_DIR to the irmf-examples checkout." >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
echo "copied $SRC -> $DST"
shasum -a 256 "$DST"
