package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	_ "image/png"

	"github.com/gowebapi/webapi/core/js"
)

func sliceShader(this js.Value, args []js.Value) interface{} {
	clearLog()
	logf("Starting slicing...")

	// Create ZIP encoder:

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	img := renderSlice(0.0)

	i := 0
	filename := fmt.Sprintf("slices/out%04d.png", i)
	f, err := w.Create(filename)
	if err != nil {
		logf("Unable to create file %q: %v", filename, err)
		return nil
	}
	if err := png.Encode(f, img); err != nil {
		logf("PNG encode: %v", err)
		return nil
	}
	if err := w.Close(); err != nil {
		logf("Unable to close ZIP: %v", err)
		return nil
	}
	img.pixelBuffer.Release()
	logf("Wrote %v bytes to ZIP file.", buf.Len())

	return nil
}

func renderSlice(z float64) *imageBuf {
	js.Global().Call("renderSliceToTexture", z)

	fn := js.Global().Get("getPixelBuffer")
	pixelBuffer := fn.Invoke()
	logf("pixelBuffer=%v", pixelBuffer.Length())

	v := js.TypedArrayOf([]uint8{})
	return &imageBuf{pixelBuffer: v}
}

type imageBuf struct {
	pixelBuffer js.TypedArray
}

func (i *imageBuf) At(x, y int) color.Color {
	ind := 4 * ((y * 512) + x)
	return color.NRGBA{}
}

func (i *imageBuf) Bounds() image.Rectangle {
	return image.Rect(0, 0, 512, 512)
}

func (i *imageBuf) ColorModel() color.Model {
	return color.NRGBAModel
}
