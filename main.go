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
		editor = js.Global().Get("editor")
		canvas = window.Document().GetElementById("canvas")
	}
	f()
	for editor.Type() == js.TypeNull || editor.Type() == js.TypeUndefined || canvas == nil {
		time.Sleep(100 * time.Millisecond)
		f()
	}
	// Even though the editor is defined, it may not be initialized.
	// Wait until it has its options set.
	// f = func() bool {
	// 	return editor.Call('')
	// }

	if source != "" {
		editor.Call("setValue", source)
	}

	fmt.Println("Application irmf-editor is now started")

	// prevent program from terminating
	c := make(chan struct{}, 0)
	<-c
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
