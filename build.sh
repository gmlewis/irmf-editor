#!/bin/bash -ex
# Note that this hack keeps changing for every release of Go.
# This script is currently for use with Go 1.15.1:
cat $(go env GOROOT)/misc/wasm/wasm_exec.js |
    sed -e 's/global.require.main === module/false/' \
	-e 's/const fs = require.*$/try { &/' \
        -e 's/global.fs = fs;/& } } catch (err) {} {/' \
    > js/wasm_exec.js
# tinygo 0.14.1 doesn't build this app without errors. Use the Go compiler instead.
# tinygo build -o main.wasm -target wasm .
GOARCH=wasm GOOS=js go build -o main.wasm
