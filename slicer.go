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
	img.Release()

	js.Global().Call("saveAs", buf.Bytes(), "slices.zip")

	return nil
}

func renderSlice(z float64) *imageBuf {
	js.Global().Call("renderSliceToTexture", z)

	pixelBuffer := js.Global().Call("getPixelBuffer")
	logf("pixelBuffer=%v", pixelBuffer.Length())

	b := &imageBuf{pb: pixelBuffer}
	// b := &imageBuf{pb: js.TypedArrayOf([]uint8{})}
	// ta := js.TypedArrayOf([]uint8{})
	// b := &imageBuf{pb: pixelBuffer.ValueOf(ta), ta: ta}
	// logf("pb: %v, ta: %v", b.pb.Type(), b.ta.Type())
	// b := &imageBuf{}
	// 	if n := js.CopyBytesToGo(b.pb, pixelBuffer); n != 4*512*512 {
	// 		logf("Got %v bytes from pixelBuffer; want %v", 4*512*512)
	// 	}
	return b
}

type imageBuf struct {
	// pb []byte
	pb js.Value
	// ta js.TypedArray
}

func (i *imageBuf) Release() {
	// i.ta.Release()
}

func (i *imageBuf) At(x, y int) color.Color {
	ind := 4 * ((y * 512) + x)
	r := uint8(i.pb.Index(ind).Int())
	g := uint8(i.pb.Index(ind + 1).Int())
	b := uint8(i.pb.Index(ind + 2).Int())
	a := uint8(i.pb.Index(ind + 3).Int())
	return color.NRGBA{R: r, G: g, B: b, A: a}
}

func (i *imageBuf) Bounds() image.Rectangle {
	return image.Rect(0, 0, 512, 512)
}

func (i *imageBuf) ColorModel() color.Model {
	return color.NRGBAModel
}
