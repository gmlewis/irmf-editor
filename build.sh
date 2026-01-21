#!/bin/bash -ex
# Note that this hack keeps changing for every release of Go.
export GOROOT=$(go env GOROOT)

cp ${GOROOT}/lib/wasm/wasm_exec.js js/wasm_exec.js

# tinygo 0.14.1 doesn't build this app without errors. Use the Go compiler instead.
# tinygo build -o main.wasm -target wasm .
GOARCH=wasm GOOS=js ${GOROOT}/bin/go build -o main.wasm
