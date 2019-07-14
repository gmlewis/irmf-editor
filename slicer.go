package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"syscall/js"
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
	logf("Wrote %v bytes to ZIP file.", buf.Len())

	return nil
}

func renderSlice(z float64) *imageBuf {
	js.Global().Call("renderSliceToTexture", z)

	fn := js.Global().Get("getPixelBuffer")
	pixelBuffer := fn.Invoke()
	logf("pixelBuffer=%v", pixelBuffer.Length())

	b := &imageBuf{}
	// 	if n := js.CopyBytesToGo(b.pb, pixelBuffer); n != 4*512*512 {
	// 		logf("Got %v bytes from pixelBuffer; want %v", 4*512*512)
	// 	}
	return b
}

type imageBuf struct {
	pb []byte
}

func (i *imageBuf) At(x, y int) color.Color {
	ind := 4 * ((y * 512) + x)
	return color.NRGBA{R: i.pb[ind], G: i.pb[ind+1], B: i.pb[ind+2], A: i.pb[ind+3]}
}

func (i *imageBuf) Bounds() image.Rectangle {
	return image.Rect(0, 0, 512, 512)
}

func (i *imageBuf) ColorModel() color.Model {
	return color.NRGBAModel
}
