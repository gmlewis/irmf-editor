#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm .
cp $(go env GOROOT)/misc/wasm/wasm_exec.js js
GOARCH=wasm GOOS=js go build -o main.wasm
