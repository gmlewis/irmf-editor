package main

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
	"time"

	"github.com/gowebapi/webapi"
	"github.com/gowebapi/webapi/core/js"
	"github.com/gowebapi/webapi/dom"
)

var (
	window *webapi.Window
	editor js.Value
	canvas *dom.Element
)

func main() {
	window = webapi.GetWindow()
	source := loadSource()

	// Wait until JS is initialized
	f := func() {
		v := js.Global().Get("getEditor")
		editor = v.Invoke()
		canvas = window.Document().GetElementById("canvas")
	}
	f()
	for editor.Type() == js.TypeNull || editor.Type() == js.TypeUndefined || canvas == nil {
		time.Sleep(100 * time.Millisecond)
		f()
	}

	if source != "" {
		editor.Call("setValue", source)
	}

	// Install compileShader callback.
	cb := js.FuncOf(compileShader)
	v := js.Global().Get("installCompileShader")
	if v.Type() == js.TypeFunction {
		fmt.Println("Installing compileShader callback")
		v.Invoke(cb)
	}

	fmt.Println("Application irmf-editor is now started")

	// prevent program from terminating
	c := make(chan struct{}, 0)
	<-c
}

func compileShader(this js.Value, args []js.Value) interface{} {
	fmt.Println("Go compileShader called!")
	src := editor.Call("getValue").String()

	lines := strings.Split(src, "\n")
	if lines[0] != "/*{" {
		fmt.Println(`Unable to find leading "/*{"`) // TODO: Turn errors into hover-over text.
		js.Global().Call("highlightShaderError", 1)
		return nil
	}
	endJSON := strings.Index(src, "\n}*/\n")
	if endJSON < 0 {
		fmt.Println(`Unable to find trailing "}*/"`)
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
	fmt.Println(jsonBlobStr)
	jsonBlob, err := parseJSON(jsonBlobStr)
	if err != nil {
		fmt.Printf("Unable to parse JSON blob: %v\n", err)
		js.Global().Call("highlightShaderError", 2)
		return nil
	}
	if lineNum, err := jsonBlob.validate(jsonBlobStr); err != nil {
		fmt.Printf("Invalid JSON blob: %v", err)
		js.Global().Call("highlightShaderError", lineNum)
		return nil
	}

	shaderSrc := src[endJSON+5:]
	// TODO: Figure out how to preserve the cursor location on rewrite.
	// Rewrite the editor buffer:
	newShader, err := jsonBlob.format(shaderSrc)
	if err != nil {
		fmt.Printf("Error: %v", err)
	} else {
		editor.Call("setValue", newShader)
	}

	// Set the updated MBB:
	js.Global().Call("setMBB", jsonBlob.Min[0], jsonBlob.Min[1], jsonBlob.Min[2],
		jsonBlob.Max[0], jsonBlob.Max[1], jsonBlob.Max[2])

	// fmt.Printf("Compiling new model shader:\n%v\n", shaderSrc)
	js.Global().Call("loadNewModel", shaderSrc)

	return nil
}

func loadSource() string {
	const oldPrefix = "/?s=github.com/"
	const newPrefix = "https://raw.githubusercontent.com/"
	url := window.Location().Value_JS.String()
	i := strings.Index(url, oldPrefix)
	if i < 0 {
		fmt.Println("No source requested in URL path.")
		return ""
	}
	location := url[i+len(oldPrefix):]
	lower := strings.ToLower(location)
	if !strings.HasSuffix(lower, ".irmf") {
		window.Alert2("irmf-editor will only load .irmf files")
		return ""
	}

	location = newPrefix + strings.Replace(location, "/blob/", "/", 1)

	resp, err := http.Get(location)
	if err != nil {
		window.Alert2("unable to load IRMF shader")
		return ""
	}
	buf, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Unable to ready response body.\n")
		return ""
	}
	resp.Body.Close()
	fmt.Printf("Read %v bytes from GitHub.\n", len(buf))
	return string(buf)
}
