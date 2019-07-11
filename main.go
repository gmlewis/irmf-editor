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

	endJSON := strings.Index(src, "\n}*/\n")
	lines := strings.Split(src, "\n")
	if lines[0] != "/*{" || endJSON < 0 {
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
	if err := jsonBlob.validate(); err != nil {
		fmt.Printf("Invalid JSON blob: %v", err)
		js.Global().Call("highlightShaderError", 2)
		return nil
	}

	shaderSrc := src[endJSON+5:]
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
