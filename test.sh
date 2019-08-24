#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm .
PATH=$(go env GOROOT)/misc/wasm:${PATH} GOARCH=wasm GOOS=js go test
