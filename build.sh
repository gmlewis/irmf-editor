#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm .
cat $(go env GOROOT)/misc/wasm/wasm_exec.js |
    sed -e 's/global.fs = require.*$/try { & } catch (err) {}/' \
    > js/wasm_exec.js
GOARCH=wasm GOOS=js go build -o main.wasm
