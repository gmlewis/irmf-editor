package main

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
	"time"

	"github.com/gowebapi/webapi"
	"github.com/gowebapi/webapi/core/js"
)

var (
	window *webapi.Window
	editor js.Value
)

func main() {
	// Wait until JS is initialized
	for window == nil || editor.Type() == js.TypeNull {
		window = webapi.GetWindow()
		editor = js.Global().Get("editor")
		time.Sleep(100 * time.Millisecond)
	}

	loadSource()

	// element := window.Document().GetElementById("foo")
	// button := html.HTMLButtonElementFromJS(element)
	// button.SetInnerText("Press me!")
	//
	// count := 1
	// callback := domcore.EventHandlerToJS(func(event *domcore.Event) interface{} {
	// 	button.SetInnerText(fmt.Sprint("Count: ", count))
	// 	count++
	// 	return nil
	// })
	// button.SetOnclick(callback)

	fmt.Println("Application irmf-editor is now started")

	// prevent program from terminating
	c := make(chan struct{}, 0)
	<-c
}

func loadSource() {
	const oldPrefix = "/?s=github.com/"
	const newPrefix = "https://raw.githubusercontent.com/"
	url := window.Location().Value_JS.String()
	i := strings.Index(url, oldPrefix)
	if i < 0 {
		return
	}
	location := url[i+len(oldPrefix):]
	lower := strings.ToLower(location)
	if !strings.HasSuffix(lower, ".irmf") {
		window.Alert2("irmf-editor will only load .irmf files")
		return
	}

	location = newPrefix + strings.Replace(location, "/blob/", "/", 1)

	resp, err := http.Get(location)
	if err != nil {
		window.Alert2("unable to load IRMF shader")
		return
	}
	buf, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Unable to ready response body.\n")
		return
	}
	resp.Body.Close()
	editor.Call("setValue", string(buf))
}
