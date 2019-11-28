#!/bin/bash -ex
git checkout master
git push origin master || echo ''
git checkout gh-pages
git merge master

source ./build.sh

git commit -am 'Update wasm' || echo ''
git push origin gh-pages
git checkout master
