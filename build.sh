#!/bin/bash -ex
# tinygo crashes on building this app. Use Go compiler instead.
# tinygo build -o main.wasm -target wasm ./main.go
GOARCH=wasm GOOS=js go build -o main.wasm
