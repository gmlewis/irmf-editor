# [IRMF Shader](https://github.com/gmlewis/irmf) Editor

## Try it out!

*This is work-in-progress - the editor is not functional yet.*

Note that *nothing* is saved in the editor! You must copy/paste your
shader source and save it locally or all edits will be lost!

* [gmlewis.github.io/irmf-editor](https://gmlewis.github.io/irmf-editor)

## Summary

IRMF is a file format used to describe [GLSL
ES](https://en.wikipedia.org/wiki/OpenGL_ES) shaders that define the
materials in a 3D object with infinite resolution. IRMF completely
eliminates the need for [software
slicers](https://en.wikipedia.org/wiki/Slicer_(3D_printing)),
[STL](https://en.wikipedia.org/wiki/STL_(file_format)), and
[G-code](https://en.wikipedia.org/wiki/G-code) files used in
[3D printers](https://en.wikipedia.org/wiki/3D_printing).

I believe that IRMF shaders will revolutionize the 3D-printing industry.

See [github.com/gmlewis/irmf](https://github.com/gmlewis/irmf) for more
details.

## IRMF Shader Editor Status

This is the very start of the in-browser IRMF shader editor, built on
Microsoft's amazing open-source [Monaco Editor](https://microsoft.github.io/monaco-editor/monarch.html).

The technology stack used is Go compiled to WebAssembly using the
extremely handy tool [go-wasm-cli](https://github.com/mfrachet/go-wasm-cli).

The goal is to allow people to easily design their IRMF shaders and
visualize the models in real time from this [static web app](https://gmlewis.github.io/irmf-editor).
All processing will be done with WebGL within the client browser.
People will edit their model, then copy/paste the code to
their local filesystem to save it offline.
This keeps the app super-simple and prevents abuse by not storing
anything on the server.

----------------------------------------------------------------------

# License

Copyright 2019 Glenn M. Lewis. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
