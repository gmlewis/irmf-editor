#!/bin/bash -ex
# Note that this hack keeps changing for every release of Go.
#
# Go 1.15.8:
# export GOROOT=/usr/local/go1.15.8
# Go 1.17.8:
export GOROOT=/usr/local/go1.17.8
# Go 1.18.4: fails.
# export GOROOT=/usr/local/go1.18.4
# Go 1.19.2: fails.
# export GOROOT=/usr/local/go1.19.2

${GOROOT}/bin/go run cmd/write-wasm-exec/main.go > js/wasm_exec.js

# tinygo 0.14.1 doesn't build this app without errors. Use the Go compiler instead.
# tinygo build -o main.wasm -target wasm .
GOARCH=wasm GOOS=js ${GOROOT}/bin/go build -o main.wasm
