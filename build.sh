#!/bin/bash -ex
git checkout gh-pages
git merge master
# tinygo build -o main.wasm -target wasm ./main.go
go-wasm start
