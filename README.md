# [IRMF Shader](https://github.com/gmlewis/irmf) Editor

![example with value ranges](value-ranges.png)

## Try it out!

*This is work-in-progress - the editor is not fully functional yet.*

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

I believe that IRMF shaders will some day revolutionize the 3D-printing industry.

See [github.com/gmlewis/irmf](https://github.com/gmlewis/irmf) for more
details.

## LYGIA support

As of 2022-10-26, support has been added for using the LYGIA Shader Library
at: https://lygia.xyz !

This means that you can add lines to your IRMF shaders like this:

```glsl
#include "lygia/math/decimation.glsl"
```

and the source will be retrieved (and cached) from the LYGIA server.

Congratulations and thanks go to [Patricio Gonzalez Vivo](https://github.com/sponsors/patriciogonzalezvivo)
for making the LYGIA server available for anyone to use, and also
for the amazing tool [glslViewer](https://github.com/patriciogonzalezvivo/glslViewer)!

## IRMF Shader Editor Status

This is the very start of the in-browser IRMF shader editor, built on
Microsoft's amazing open-source [Monaco Editor](https://microsoft.github.io/monaco-editor/monarch.html).

The technology stack used is Go compiled to WebAssembly using the
extremely handy tool [go-wasm-cli](https://github.com/mfrachet/go-wasm-cli).

Easy installation: `npm i -g go-wasm-cli`.

The goal is to allow people to easily design their IRMF shaders and
visualize the models in real time from this [static web app](https://gmlewis.github.io/irmf-editor).
All processing will be done with WebGL within the client browser.
People will edit their model, then copy/paste the code to
their local filesystem to save it offline.
This keeps the app super-simple and prevents abuse by not storing
anything on the server.

# FAQ

## How does it work?

This editor dices up your model (the IRMF shader) into slices (planes)
that are perpendicular (normal) to your eye (the camera). Because the
planes are all stacked together and render the model at different depths
from your eye, it appears that you are being shown a solid, when in
actuality, you are being shown a lot of very thin slices of your model
all stacked together.

Here is a picture showing what is happening:

![How it works](how-it-works.png)

The camera is "above" the slicing planes (on the +Z axis) looking "down"
through the stacked planes. As the camera rotates around, the planes
also rotate to always face the camera, but slice through the model at
different locations.

## Why do I see jaggies in my model?

"I thought this thing had infinite resolution... what's up?"

The IRMF shader itself has infinite resolution because it is just math,
but we have to dice up the design in order to display it. We also
need to keep it performant, so we need to limit the number of slices to
render. But as a result of slicing the model, high detail models
(especially those with curves) will show more jaggies than others.

Here is a picture demonstrating the jaggies:

![Jaggies](jaggies.png)

The bottom line is that I haven't figured out how to render the object
yet without jaggies. This too, will be the art that the 3D printer
manufacturers will be providing. They will figure out how to best
slice your model at the highest resolutions possible so that you don't
get jaggies in the resulting model.

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
