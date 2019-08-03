package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"io/ioutil"
	"math"
	"net/http"
	"strings"
	"syscall/js"
	"time"
)

var (
	editor        js.Value
	canvas        js.Value
	logfDiv       js.Value
	sliceButton   js.Value
	setResolution js.Value
)

func main() {
	source := loadSource()

	// Wait until JS is initialized
	f := func() {
		editor = js.Global().Call("getEditor")
		doc := js.Global().Get("document")
		canvas = doc.Call("getElementById", "canvas")
		logfDiv = doc.Call("getElementById", "logf")
		sliceButton = doc.Call("getElementById", "slice-button")
		setResolution = js.Global().Get("setResolution")
	}
	f()
	for editor.Type() == js.TypeNull ||
		editor.Type() == js.TypeUndefined ||
		canvas.Type() == js.TypeNull ||
		logfDiv.Type() == js.TypeNull ||
		logfDiv.Type() == js.TypeUndefined ||
		sliceButton.Type() == js.TypeNull ||
		sliceButton.Type() == js.TypeUndefined {
		time.Sleep(100 * time.Millisecond)
		f()
	}

	// Install callbacks.
	cb := js.FuncOf(compileShader)
	v := js.Global().Get("installCompileShader")
	if v.Type() == js.TypeFunction {
		logf("Installing compileShader callback")
		v.Invoke(cb)
	}
	cb = js.FuncOf(updateJSONOptionsCallback)
	v = js.Global().Get("installUpdateJSONOptionsCallback")
	if v.Type() == js.TypeFunction {
		logf("Installing updateJSONOptions callback")
		v.Invoke(cb)
	}

	// // Install slice-button callback.
	// cb2 := js.FuncOf(sliceShader)
	// v2 := js.Global().Get("installSliceShader")
	// if v2.Type() == js.TypeFunction {
	// 	logf("Installing sliceShader callback")
	// 	v2.Invoke(cb2)
	// }

	if len(source) > 0 {
		initShader(source)
	} else {
		initShader([]byte(startupShader))
	}

	logf("Application irmf-editor is now started")

	// prevent program from terminating
	c := make(chan struct{}, 0)
	<-c
}

func compileShader(this js.Value, args []js.Value) interface{} {
	clearLog()
	logf("Go compileShader called!")
	src := editor.Call("getValue").String()
	return initShader([]byte(src))
}

func initShader(src []byte) interface{} {
	jsonBlob, shaderSrc := parseEditor(src)
	if jsonBlob == nil {
		return nil
	}

	// Rewrite the editor buffer:
	newShader, err := jsonBlob.format(shaderSrc)
	if err != nil {
		logf("Error: %v", err)
	} else {
		editor.Call("setValue", newShader)
	}

	if jsonBlob.Options.Resolution != nil {
		switch res := *jsonBlob.Options.Resolution; res {
		case 32, 64, 128, 256, 512, 1024, 2048:
			if setResolution.Type() == js.TypeFunction {
				setResolution.Invoke(res)
			}
		}
	}

	uniforms := js.Global().Call("getUniforms")
	colorPalette := js.Global().Call("getColorPalette")
	if uniforms.Type() != js.TypeNull && uniforms.Type() != js.TypeUndefined &&
		colorPalette.Type() != js.TypeNull && colorPalette.Type() != js.TypeUndefined {
		setColor := func(n int, v *rgba) {
			if v == nil {
				return
			}
			color := colorPalette.Get(fmt.Sprintf("color%v", n))
			if color.Type() != js.TypeNull && color.Type() != js.TypeUndefined {
				color.SetIndex(0, v[0])
				color.SetIndex(1, v[1])
				color.SetIndex(2, v[2])
				color.SetIndex(3, v[3])
			}
			uniforms.Get(fmt.Sprintf("u_color%v", n)).Get("value").Call("set", v[0]/255.0, v[1]/255.0, v[2]/255.0, v[3])
		}
		setColor(1, jsonBlob.Options.Color1)
		setColor(2, jsonBlob.Options.Color2)
		setColor(3, jsonBlob.Options.Color3)
		setColor(4, jsonBlob.Options.Color4)
		setColor(5, jsonBlob.Options.Color5)
		setColor(6, jsonBlob.Options.Color6)
		setColor(7, jsonBlob.Options.Color7)
		setColor(8, jsonBlob.Options.Color8)
		setColor(9, jsonBlob.Options.Color9)
		setColor(10, jsonBlob.Options.Color10)
		setColor(11, jsonBlob.Options.Color11)
		setColor(12, jsonBlob.Options.Color12)
		setColor(13, jsonBlob.Options.Color13)
		setColor(14, jsonBlob.Options.Color14)
		setColor(15, jsonBlob.Options.Color15)
		setColor(16, jsonBlob.Options.Color16)

		// Set the number of materials:
		uniforms.Get("u_numMaterials").Set("value", len(jsonBlob.Materials))
	}

	// Set the GUI to the correct number of materials and their color editors.
	// Also support HSV, HSL, and RGB full color models. If any material is
	// listed three times with unique suffix triplets ('.H','.S','.V'),
	// ('.H','.S','.L'), or ('.R','.G','.B'), they are combined to form a
	// color in the editor using the appropriate color space model.
	// See https://en.wikipedia.org/wiki/HSL_and_HSV for more information.
	hsvs := hsvMap{}
	hsls := hslMap{}
	rgbs := rgbMap{}
	colorFolder := js.Global().Call("getColorFolder")
	if colorFolder.Type() != js.TypeNull && colorFolder.Type() != js.TypeUndefined {
		// TODO: Only count the colors for non-full-color materials.
		colorFolder.Set("name", fmt.Sprintf("Material colors (%v)", len(jsonBlob.Materials)))
		jsArray := js.ValueOf([]interface{}{})
		setH := func(name string, colorNum int) {
			if v, ok := hsvs[name]; ok {
				v.H = colorNum
			} else {
				hsvs[name] = hsvT{H: colorNum}
			}
			if v, ok := hsls[name]; ok {
				v.H = colorNum
			} else {
				hsls[name] = hslT{H: colorNum}
			}
		}
		setS := func(name string, colorNum int) {
			if v, ok := hsvs[name]; ok {
				v.S = colorNum
			} else {
				hsvs[name] = hsvT{S: colorNum}
			}
			if v, ok := hsls[name]; ok {
				v.S = colorNum
			} else {
				hsls[name] = hslT{S: colorNum}
			}
		}
		setV := func(name string, colorNum int) {
			if v, ok := hsvs[name]; ok {
				v.V = colorNum
			} else {
				hsvs[name] = hsvT{V: colorNum}
			}
		}
		setL := func(name string, colorNum int) {
			if v, ok := hsls[name]; ok {
				v.L = colorNum
			} else {
				hsls[name] = hslT{L: colorNum}
			}
		}
		setR := func(name string, colorNum int) {
			if v, ok := rgbs[name]; ok {
				v.R = colorNum
			} else {
				rgbs[name] = rgbT{R: colorNum}
			}
		}
		setG := func(name string, colorNum int) {
			if v, ok := rgbs[name]; ok {
				v.G = colorNum
			} else {
				rgbs[name] = rgbT{G: colorNum}
			}
		}
		setB := func(name string, colorNum int) {
			if v, ok := rgbs[name]; ok {
				v.B = colorNum
			} else {
				rgbs[name] = rgbT{B: colorNum}
			}
		}
		for i, name := range jsonBlob.Materials {
			jsArray.SetIndex(i, name)
			if len(name) > 2 {
				baseName := name[0 : len(name)-2]
				switch {
				case strings.HasSuffix(name, ".H"): // Make entries for both HSV and HSL, then clean up later.
					setH(name, i+1)
				case strings.HasSuffix(name, ".S"): // Make entries for both HSV and HSL, then clean up later.
					setS(name, i+1)
				case strings.HasSuffix(name, ".V"):
					setV(name, i+1)
				case strings.HasSuffix(name, ".L"):
					setL(name, i+1)
				case strings.HasSuffix(name, ".R"):
					setR(name, i+1)
				case strings.HasSuffix(name, ".G"):
					setG(name, i+1)
				case strings.HasSuffix(name, ".B"):
					setB(name, i+1)
				}
			}
		}
		js.Global().Call("refreshMaterialColorControllers", jsArray)
	}

	// Remove incomplete color models.
	cleanMap := func(keys []string, removeFunc func(key string)) {
		for _, k := range keys {
			removeFunc(k)
		}
	}
	cleanMap(hsvs.keys(), func(key string) {
		if hsvs[key].H == 0 || hsvs[key].S == 0 || hsvs[key].V == 0 {
			delete(hsvs, key)
		}
	})
	cleanMap(hsls.keys(), func(key string) {
		if hsls[key].H == 0 || hsls[key].S == 0 || hsls[key].L == 0 {
			delete(hsls, key)
		}
	})
	cleanMap(rgbs.keys(), func(key string) {
		if rgbs[key].R == 0 || rgbs[key].G == 0 || rgbs[key].B == 0 {
			delete(rgbs, key)
		}
	})

	// Set the updated MBB:
	rangeValues := js.Global().Call("getRangeValues")
	if rangeValues.Type() != js.TypeNull && rangeValues.Type() != js.TypeUndefined {
		rangeValues.Set("llx", jsonBlob.Min[0])
		rangeValues.Set("minx", jsonBlob.Min[0])
		rangeValues.Set("lly", jsonBlob.Min[1])
		rangeValues.Set("miny", jsonBlob.Min[1])
		rangeValues.Set("llz", jsonBlob.Min[2])
		rangeValues.Set("minz", jsonBlob.Min[2])
		rangeValues.Set("urx", jsonBlob.Max[0])
		rangeValues.Set("maxx", jsonBlob.Max[0])
		rangeValues.Set("ury", jsonBlob.Max[1])
		rangeValues.Set("maxy", jsonBlob.Max[1])
		rangeValues.Set("urz", jsonBlob.Max[2])
		rangeValues.Set("maxz", jsonBlob.Max[2])
	}

	// logf("Compiling new model shader:\n%v", shaderSrc)
	js.Global().Call("loadNewModel", shaderSrc+fsFooter(len(jsonBlob.Materials), hsvs, hsls, rgbs))

	return nil
}

type hsvT struct {
	H int
	S int
	V int
}

type hslT struct {
	H int
	S int
	L int
}

type rgbT struct {
	R int
	G int
	B int
}

// hsvMap maps a material prefix name (e.g. "PLA") to the material numbers
// (1-based index) for each of its components. So if the materials were:
// ["metal", "PLA.V", "dielectric", "PLA.H", "PLA.S"], then the map entry
// would be: "PLA": {H: 4, S: 5, V: 2}.
type hsvMap map[string]hsvT

func (m hsvMap) keys() (result []string) {
	for k := range m {
		result = append(result, k)
	}
	return result
}

// hslMap maps a material prefix name (e.g. "PLA") to the material numbers
// (1-based index) for each of its components. So if the materials were:
// ["metal", "PLA.L", "dielectric", "PLA.H", "PLA.S"], then the map entry
// would be: "PLA": {H: 4, S: 5, L: 2}.
type hslMap map[string]hslT

func (m hslMap) keys() (result []string) {
	for k := range m {
		result = append(result, k)
	}
	return result
}

// rgbMap maps a material prefix name (e.g. "PLA") to the material numbers
// (1-based index) for each of its components. So if the materials were:
// ["metal", "PLA.B", "dielectric", "PLA.R", "PLA.G"], then the map entry
// would be: "PLA": {R: 4, G: 5, B: 2}.
type rgbMap map[string]rgbT

func (m rgbMap) keys() (result []string) {
	for k := range m {
		result = append(result, k)
	}
	return result
}

func parseEditor(src []byte) (*irmf, string) {
	if bytes.Index(src, []byte("/*{")) != 0 {
		logf(`Unable to find leading "/*{"`) // TODO: Turn errors into hover-over text.
		js.Global().Call("highlightShaderError", 1)
		return nil, ""
	}
	endJSON := bytes.Index(src, []byte("\n}*/\n"))
	if endJSON < 0 {
		logf(`Unable to find trailing "}*/"`)
		// Try to find the end of the JSON blob.
		if lineNum := findKeyLine(string(src), "*/"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil, ""
		}
		if lineNum := findKeyLine(string(src), "}*"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil, ""
		}
		if lineNum := findKeyLine(string(src), "}"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil, ""
		}
		js.Global().Call("highlightShaderError", 1)
		return nil, ""
	}

	jsonBlobStr := string(src[2 : endJSON+2])
	// logf(jsonBlobStr)
	jsonBlob, err := parseJSON(jsonBlobStr)
	if err != nil {
		logf("Unable to parse JSON blob: %v", err)
		js.Global().Call("highlightShaderError", 2)
		return nil, ""
	}

	shaderSrcBuf := src[endJSON+5:]
	var shaderSrc string
	unzip := func(data []byte) error {
		zr, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return err
		}
		buf := &bytes.Buffer{}
		if _, err := io.Copy(buf, zr); err != nil {
			return err
		}
		if err := zr.Close(); err != nil {
			return err
		}
		shaderSrc = buf.String()
		return nil
	}

	if jsonBlob.Encoding != nil && *jsonBlob.Encoding == "gzip+base64" {
		data, err := base64.RawStdEncoding.DecodeString(string(shaderSrcBuf))
		if err != nil {
			logf("uudecode error: %v", err)
			return nil, ""
		}
		if err := unzip(data); err != nil {
			logf("unzip: %v", err)
			return nil, ""
		}
		jsonBlob.Encoding = nil
	} else if jsonBlob.Encoding != nil && *jsonBlob.Encoding == "gzip" {
		if err := unzip(shaderSrcBuf); err != nil {
			logf("unzip: %v", err)
			return nil, ""
		}
		jsonBlob.Encoding = nil
	} else {
		shaderSrc = string(shaderSrcBuf)
	}

	if lineNum, err := jsonBlob.validate(jsonBlobStr, shaderSrc); err != nil {
		logf("Invalid JSON blob: %v", err)
		js.Global().Call("highlightShaderError", lineNum)
		return nil, ""
	}

	return jsonBlob, shaderSrc
}

func updateJSONOptionsCallback(this js.Value, args []js.Value) interface{} {
	src := editor.Call("getValue").String()
	jsonBlob, shaderSrc := parseEditor([]byte(src))
	updateJSONOptions(jsonBlob)

	// Rewrite the editor buffer:
	newShader, err := jsonBlob.format(shaderSrc)
	if err != nil {
		logf("Error: %v", err)
	} else {
		editor.Call("setValue", newShader)
	}
	return nil
}

func updateJSONOptions(jsonBlob *irmf) {
	uniforms := js.Global().Call("getUniforms")
	if uniforms.Type() != js.TypeNull && uniforms.Type() != js.TypeUndefined {
		resolution := uniforms.Get("u_resolution").Get("value").Int()
		jsonBlob.Options.Resolution = &resolution

		for i := range jsonBlob.Materials {
			color := uniforms.Get(fmt.Sprintf("u_color%v", i+1)).Get("value")
			v := &rgba{
				math.Floor(0.5 + 255.0*color.Get("x").Float()),
				math.Floor(0.5 + 255.0*color.Get("y").Float()),
				math.Floor(0.5 + 255.0*color.Get("z").Float()),
				color.Get("w").Float(),
			}
			switch i + 1 {
			case 1:
				jsonBlob.Options.Color1 = v
			case 2:
				jsonBlob.Options.Color2 = v
			case 3:
				jsonBlob.Options.Color3 = v
			case 4:
				jsonBlob.Options.Color4 = v
			case 5:
				jsonBlob.Options.Color5 = v
			case 6:
				jsonBlob.Options.Color6 = v
			case 7:
				jsonBlob.Options.Color7 = v
			case 8:
				jsonBlob.Options.Color8 = v
			case 9:
				jsonBlob.Options.Color9 = v
			case 10:
				jsonBlob.Options.Color10 = v
			case 11:
				jsonBlob.Options.Color11 = v
			case 12:
				jsonBlob.Options.Color12 = v
			case 13:
				jsonBlob.Options.Color13 = v
			case 14:
				jsonBlob.Options.Color14 = v
			case 15:
				jsonBlob.Options.Color15 = v
			case 16:
				jsonBlob.Options.Color16 = v
			}
		}
	}
}

func loadSource() []byte {
	const oldPrefix = "/?s=github.com/"
	const newPrefix = "https://raw.githubusercontent.com/"
	url := js.Global().Get("document").Get("location").String()
	i := strings.Index(url, oldPrefix)
	if i < 0 {
		logf("No source requested in URL path.")
		return nil
	}
	location := url[i+len(oldPrefix):]
	lower := strings.ToLower(location)
	if !strings.HasSuffix(lower, ".irmf") {
		js.Global().Call("alert", "irmf-editor will only load .irmf files")
		return nil
	}

	location = newPrefix + strings.Replace(location, "/blob/", "/", 1)

	resp, err := http.Get(location)
	if err != nil {
		logf("Unable to download source from: %v", location)
		js.Global().Call("alert", "unable to load IRMF shader")
		return nil
	}
	buf, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		logf("Unable to ready response body.")
		return nil
	}
	resp.Body.Close()
	logf("Read %v bytes from GitHub.", len(buf))
	return buf
}

func clearLog() {
	if logfDiv.Type() != js.TypeNull {
		logfDiv.Set("innerHTML", "")
	}
}

func logf(fmtStr string, args ...interface{}) {
	if logfDiv.Type() != js.TypeNull && logfDiv.Type() != js.TypeUndefined {
		txt := logfDiv.Get("innerHTML").String()
		txt += fmt.Sprintf("<div>"+fmtStr+"</div>", args...)
		logfDiv.Set("innerHTML", txt)
	} else {
		fmt.Printf(fmtStr+"\n", args...)
	}
}

const startupShader = `/*{
  irmf: "1.0",
  materials: ["PLA"],
  max: [5,5,5],
  min: [-5,-5,-5],
  units: "mm",
}*/

float sphere(in vec3 pos, in float radius, in vec3 xyz) {
  xyz -= pos;  // Move sphere into place.
  float r = length(xyz);
  return r <= radius ? 1.0 : 0.0;
}

void mainModel4( out vec4 materials, in vec3 xyz ) {
  const float radius = 6.0;
  materials[0] = 1.0 - sphere(vec3(0), radius, xyz);
}
`

func fsFooter(numMaterials int, hsvs hsvMap, hsls hslMap, rgbs rgbMap) string {
	if len(hsvs) == 0 && len(hsls) == 0 && len(rgbs) == 0 {
		switch numMaterials {
		default:
			return fmt.Sprintf(fsFooterFmt4, "u_d*u_color1*m.x")
		case 2:
			return fmt.Sprintf(fsFooterFmt4, "u_d*(u_color1*m.x + u_color2*m.y)")
		case 3:
			return fmt.Sprintf(fsFooterFmt4, "u_d*(u_color1*m.x + u_color2*m.y + u_color3*m.z)")
		case 4:
			return fmt.Sprintf(fsFooterFmt4, "u_d*(u_color1*m.x + u_color2*m.y + u_color3*m.z + u_color4*m.w)")
		case 5:
			return fmt.Sprintf(fsFooterFmt9, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[1][0] + u_color5*m[1][1])")
		case 6:
			return fmt.Sprintf(fsFooterFmt9, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[1][0] + u_color5*m[1][1] + u_color6*m[1][2])")
		case 7:
			return fmt.Sprintf(fsFooterFmt9, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[1][0] + u_color5*m[1][1] + u_color6*m[1][2] + u_color7*m[2][0])")
		case 8:
			return fmt.Sprintf(fsFooterFmt9, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[1][0] + u_color5*m[1][1] + u_color6*m[1][2] + u_color7*m[2][0] + u_color8*m[2][1])")
		case 9:
			return fmt.Sprintf(fsFooterFmt9, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[1][0] + u_color5*m[1][1] + u_color6*m[1][2] + u_color7*m[2][0] + u_color8*m[2][1] + u_color9*m[2][2])")
		case 10:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1])")
		case 11:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2])")
		case 12:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2] + u_color12*m[2][3])")
		case 13:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2] + u_color12*m[2][3] + u_color13*m[2][0])")
		case 14:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2] + u_color12*m[2][3] + u_color13*m[2][0] + u_color14*m[2][1])")
		case 15:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2] + u_color12*m[2][3] + u_color13*m[2][0] + u_color14*m[2][1] + u_color15*m[2][2])")
		case 16:
			return fmt.Sprintf(fsFooterFmt16, "u_d*(u_color1*m[0][0] + u_color2*m[0][1] + u_color3*m[0][2] + u_color4*m[0][3] + u_color5*m[1][0] + u_color6*m[1][1] + u_color7*m[1][2] + u_color8*m[1][3] + u_color9*m[2][0] + u_color10*m[2][1] + u_color11*m[2][2] + u_color12*m[2][3] + u_color13*m[2][0] + u_color14*m[2][1] + u_color15*m[2][2] + u_color16*m[2][3])")
		}
	}

	var colorToMaterial func(colorNum int) string
	var footerFmt string
	switch numMaterials {
	default:
		footerFmt = fsFooterFmt4
		colorToMaterial = func(colorNum int) string {
			return []string{"m.x", "m.y", "m.z", "m.z"}[colorNum-1]
		}
	case 5, 6, 7, 8, 9:
		footerFmt = fsFooterFmt9
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[1][0]", "m[1][1]", "m[1][2]", "m[2][0]", "m[2][1]", "m[2][2]"}[colorNum-1]
		}
	case 10, 11, 12, 13, 14, 15, 16:
		footerFmt = fsFooterFmt16
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[0][3]", "m[1][0]", "m[1][1]", "m[1][2]", "m[1][3]", "m[2][0]", "m[2][1]", "m[2][2]", "m[2][3]", "m[2][0]", "m[2][1]", "m[2][2]", "m[2][3]"}[colorNum-1]
		}
	}

	usedColors := map[int]bool{}
	var finalColors []string
	for _, v := range hsvs {
		usedColors[v.H] = true
		usedColors[v.S] = true
		usedColors[v.V] = true
		finalColors = append(finalColors, fmt.Sprintf("hsv(%v,%v,%v)", colorToMaterial(v.H), colorToMaterial(v.S), colorToMaterial(v.V)))
	}
	for _, v := range hsls {
		usedColors[v.H] = true
		usedColors[v.S] = true
		usedColors[v.L] = true
		finalColors = append(finalColors, fmt.Sprintf("hsl(%v,%v,%v)", colorToMaterial(v.H), colorToMaterial(v.S), colorToMaterial(v.L)))
	}
	for _, v := range rgbs {
		usedColors[v.R] = true
		usedColors[v.G] = true
		usedColors[v.B] = true
		finalColors = append(finalColors, fmt.Sprintf("vec4(%v,%v,%v,1.0)", colorToMaterial(v.R), colorToMaterial(v.G), colorToMaterial(v.B)))
	}
	nextColor := 1
	for i := 1; i <= numMaterials; i++ {
		if !usedColors[i] {
			finalColors = append(finalColors, fmt.Sprintf("u_color%v*%v", nextColor, colorToMaterial(i)))
			nextColor++
		}
	}

	var prefixFuncs []string
	if len(hsvs) > 0 {
		prefixFuncs = append(prefixFuncs, hsvFunc)
	}
	if len(hsls) > 0 {
		prefixFuncs = append(prefixFuncs, hslFunc)
	}
	colorMixer := fmt.Sprintf("u_d*(%v)", strings.Join(finalColors, " + "))
	return strings.Join(prefixFuncs, "\n") + fmt.Sprintf(footerFmt, colorMixer)
}

const fsFooterFmt4 = `
void main() {
  if (any(lessThan(v_xyz.xyz,u_ll))) {
    out_FragColor = vec4(0);
    // out_FragColor = vec4(0,1,0,1);  // DEBUG
    return;
  }
  if (any(greaterThan(v_xyz.xyz,u_ur))) {
    out_FragColor = vec4(0);
    // out_FragColor = vec4(0,0,1,1);  // DEBUG
    return;
	}
  vec4 m;
  mainModel4(m, v_xyz.xyz);
  out_FragColor = %v;
  // out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
}
`

const fsFooterFmt9 = `
void main() {
  if (any(lessThan(v_xyz.xyz,u_ll))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThan(v_xyz.xyz,u_ur))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
	mat3 m;
	mainModel9(m, v_xyz.xyz);
	out_FragColor = %v;
	// out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
}
`

const fsFooterFmt16 = `
void main() {
  if (any(lessThan(v_xyz.xyz,u_ll))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThan(v_xyz.xyz,u_ur))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
	mat4 m;
	mainModel16(m, v_xyz.xyz);
	out_FragColor = %v;
	// out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
}
`

const hsvFunc = `
vec4 hsv(float h, float s, float v) {
  float k5 = mod(5.0+6.0*h, 6.0);
  float k3 = mod(3.0+6.0*h, 6.0);
  float k1 = mod(1.0+6.0*h, 6.0);
  float f5 = v - v*s*max(min(k5,4.0-k5,1.0),0.0);
  float f3 = v - v*s*max(min(k3,4.0-k3,1.0),0.0);
  float f1 = v - v*s*max(min(k1,4.0-k1,1.0),0.0);
  return vec4(f5,f3,f1,1.0);
}
`

const hslFunc = `
vec4 hsl(float h, float s, float l) {
  float a = s*min(l,1.0-l);
  float k0 = mod(0.0+12.0*h, 12.0);
  float k8 = mod(8.0+12.0*h, 12.0);
  float k4 = mod(4.0+12.0*h, 12.0);
  float f0 = l - a*max(min(k0-3.0,9.0-k0,1.0),-1.0);
  float f8 = l - a*max(min(k8-3.0,9.0-k8,1.0),-1.0);
  float f4 = l - a*max(min(k4-3.0,9.0-k4,1.0),-1.0);
  return vec4(f0,f8,f4,1.0);
}
`
