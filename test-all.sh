#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm .
export PATH=$(go env GOROOT)/lib/wasm:$(dirname "$(which go)"):$(dirname "$(which node)"):/usr/bin:/bin
GOARCH=wasm GOOS=js go test
