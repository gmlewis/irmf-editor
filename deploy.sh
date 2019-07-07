#!/bin/bash -ex
git checkout gh-pages
git merge master
# tinygo build -o main.wasm -target wasm ./main.go
GOARCH=wasm GOOS=js go build -o main.wasm
git commit -am 'Update wasm'
git push origin gh-pages
git checkout master
