package main

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
	"syscall/js"
	"time"
)

var (
	editor      js.Value
	canvas      js.Value
	logfDiv     js.Value
	sliceButton js.Value
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

	// Install compileShader callback.
	cb := js.FuncOf(compileShader)
	v := js.Global().Get("installCompileShader")
	if v.Type() == js.TypeFunction {
		logf("Installing compileShader callback")
		v.Invoke(cb)
	}

	// // Install slice-button callback.
	// cb2 := js.FuncOf(sliceShader)
	// v2 := js.Global().Get("installSliceShader")
	// if v2.Type() == js.TypeFunction {
	// 	logf("Installing sliceShader callback")
	// 	v2.Invoke(cb2)
	// }

	if source != "" {
		initShader(source)
	} else {
		initShader(startupShader)
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
	return initShader(src)
}

func initShader(src string) interface{} {
	lines := strings.Split(src, "\n")
	if lines[0] != "/*{" {
		logf(`Unable to find leading "/*{"`) // TODO: Turn errors into hover-over text.
		js.Global().Call("highlightShaderError", 1)
		return nil
	}
	endJSON := strings.Index(src, "\n}*/\n")
	if endJSON < 0 {
		logf(`Unable to find trailing "}*/"`)
		// Try to find the end of the JSON blob.
		if lineNum := findKeyLine(src, "*/"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil
		}
		if lineNum := findKeyLine(src, "}*"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil
		}
		if lineNum := findKeyLine(src, "}"); lineNum > 2 {
			js.Global().Call("highlightShaderError", lineNum)
			return nil
		}
		js.Global().Call("highlightShaderError", 1)
		return nil
	}

	jsonBlobStr := src[2 : endJSON+2]
	// logf(jsonBlobStr)
	jsonBlob, err := parseJSON(jsonBlobStr)
	if err != nil {
		logf("Unable to parse JSON blob: %v", err)
		js.Global().Call("highlightShaderError", 2)
		return nil
	}

	shaderSrc := src[endJSON+5:]

	if lineNum, err := jsonBlob.validate(jsonBlobStr, shaderSrc); err != nil {
		logf("Invalid JSON blob: %v", err)
		js.Global().Call("highlightShaderError", lineNum)
		return nil
	}

	// TODO: Figure out how to preserve the cursor location on rewrite.
	// Rewrite the editor buffer:
	newShader, err := jsonBlob.format(shaderSrc)
	if err != nil {
		logf("Error: %v", err)
	} else {
		editor.Call("setValue", newShader)
	}

	// Set the updated MBB and number of materials:
	js.Global().Call("setMBB", jsonBlob.Min[0], jsonBlob.Min[1], jsonBlob.Min[2],
		jsonBlob.Max[0], jsonBlob.Max[1], jsonBlob.Max[2], len(jsonBlob.Materials))

	// logf("Compiling new model shader:\n%v", shaderSrc)
	js.Global().Call("loadNewModel", shaderSrc+fsFooter(len(jsonBlob.Materials)))

	return nil
}

func loadSource() string {
	const oldPrefix = "/?s=github.com/"
	const newPrefix = "https://raw.githubusercontent.com/"
	url := js.Global().Get("document").Get("location").String()
	i := strings.Index(url, oldPrefix)
	if i < 0 {
		logf("No source requested in URL path.")
		return ""
	}
	location := url[i+len(oldPrefix):]
	lower := strings.ToLower(location)
	if !strings.HasSuffix(lower, ".irmf") {
		js.Global().Call("alert", "irmf-editor will only load .irmf files")
		return ""
	}

	location = newPrefix + strings.Replace(location, "/blob/", "/", 1)

	resp, err := http.Get(location)
	if err != nil {
		logf("Unable to download source from: %v", location)
		js.Global().Call("alert", "unable to load IRMF shader")
		return ""
	}
	buf, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		logf("Unable to ready response body.")
		return ""
	}
	resp.Body.Close()
	logf("Read %v bytes from GitHub.", len(buf))
	return string(buf)
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
  const float radius = 5.0;  // 10mm diameter sphere.
  materials[0] = sphere(vec3(0), radius, xyz);
}
`

func fsFooter(numMaterials int) string {
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

const fsFooterFmt4 = `
void main() {
  if (any(lessThanEqual(abs(v_xyz.xyz),u_ll))) {
    out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThanEqual(abs(v_xyz.xyz),u_ur))) {
    out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
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
  if (any(lessThanEqual(abs(v_xyz.xyz),u_ll))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThanEqual(abs(v_xyz.xyz),u_ur))) {
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
  if (any(lessThanEqual(abs(v_xyz.xyz),u_ll))) {
		out_FragColor = vec4(0);
    // out_FragColor = vec4(1);  // DEBUG
    return;
  }
  if (any(greaterThanEqual(abs(v_xyz.xyz),u_ur))) {
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
