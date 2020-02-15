#!/bin/bash -ex
cat $(go env GOROOT)/misc/wasm/wasm_exec.js |
    sed -e 's/global.fs = require.*$/try { & } catch (err) {}/' \
    > js/wasm_exec.js
# tinygo 0.12.0 doesn't build this app without errors. Use the Go compiler instead.
# tinygo build -o main.wasm -target wasm .
GOARCH=wasm GOOS=js go build -o main.wasm
