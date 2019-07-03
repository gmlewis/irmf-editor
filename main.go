package main

import (
	"fmt"
	"strings"

	"github.com/gowebapi/webapi"
	"github.com/gowebapi/webapi/core/js"
)

var (
	window *webapi.Window
	editor interface{}
)

func main() {
	window = webapi.GetWindow()
	editor = js.Global().Get("editor")

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
	url := window.Location().Value_JS.String()
	i := strings.Index(url, "/?s=github.com/")
	if i < 0 {
		return
	}
	location := url[i+4:]
	lower := strings.ToLower(location)
	if !strings.HasSuffix(lower, ".irmf") {
		window.Alert2("irmf-editor will only load .irmf files")
		return
	}

	fmt.Printf("location=%q\n", location)
	fmt.Printf("editor=%#v\n", editor)
}
