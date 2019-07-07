#!/bin/bash -ex
git checkout master
git push origin master || echo ''
git checkout gh-pages
git merge master
# tinygo build -o main.wasm -target wasm ./main.go
GOARCH=wasm GOOS=js go build -o main.wasm
git commit -am 'Update wasm' || echo ''
git push origin gh-pages
git checkout master
