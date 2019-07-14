package main

import (
	"image"

	"github.com/gowebapi/webapi/core/js"
)

func sliceShader(this js.Value, args []js.Value) interface{} {
	clearLog()
	logf("Starting slicing...")

	renderSlice(0.0)

	return nil
}

func renderSlice(z float64) *image.Image {
	js.Global().Call("renderSliceToTexture", z)

	fn := js.Global().Get("getSliceTexture")
	texture := fn.Invoke()
	logf("texture=%#v", texture)

	return nil
}
