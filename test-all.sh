#!/bin/bash -ex

# Find Go WASM execution wrapper
GOROOT=$(go env GOROOT)
WASM_EXEC_PATH=""
if [ -d "$GOROOT/lib/wasm" ]; then
  WASM_EXEC_PATH="$GOROOT/lib/wasm"
elif [ -d "$GOROOT/misc/wasm" ]; then
  WASM_EXEC_PATH="$GOROOT/misc/wasm"
fi

# Construct PATH safely
NEW_PATH="$WASM_EXEC_PATH"
[ -n "$(which go)" ] && NEW_PATH="$NEW_PATH:$(dirname "$(which go)")"
[ -n "$(which node)" ] && NEW_PATH="$NEW_PATH:$(dirname "$(which node)")"
[ -d "$HOME/.bun/bin" ] && NEW_PATH="$NEW_PATH:$HOME/.bun/bin"
export PATH="$NEW_PATH:/usr/bin:/bin"

# Run Go WASM tests
GOARCH=wasm GOOS=js go test

# Mount the canonical example corpus for the TSL/example e2e tests. The repo
# lives in different places on different machines, so only use the default if
# it exists; otherwise the example-mount tests skip themselves with a message.
if [ -z "${IRMF_EXAMPLES_DIR:-}" ]; then
  for candidate in \
      "$HOME/src/github.com/gmlewis/irmf-examples" \
      "$HOME/go/src/github.com/gmlewis/irmf-examples"; do
    if [ -d "$candidate/examples" ]; then
      export IRMF_EXAMPLES_DIR="$candidate"
      break
    fi
  done
fi
if [ -z "${IRMF_EXAMPLES_DIR:-}" ]; then
  echo "NOTE: IRMF_EXAMPLES_DIR is not set; example-mount e2e tests will be skipped."
fi

# Run E2E Visual Regression tests - see tests/e2e/README.md
cd tests/e2e
if [ "$CI" = "true" ]; then
  # On CI, we might want to allow some pixel difference or handle missing snapshots
  npx playwright test
else
  npx playwright test
fi
