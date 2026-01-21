#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm .
export PATH=$(go env GOROOT)/lib/wasm:$(dirname "$(which go)"):$(dirname "$(which node)"):$HOME/.bun/bin:/usr/bin:/bin
GOARCH=wasm GOOS=js go test

# Run E2E Visual Regression tests
cd tests/e2e && npx playwright test
