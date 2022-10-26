// -*- compile-command: "go test ./... && go run main.go"; -*-

// make-wasm-exec uses the knowledge of the current version of Go
// to build the js/wasm_exec.js file.
package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	wasmFile = "misc/wasm/wasm_exec.js"
)

func main() {
	v := runtime.Version()
	filename := filepath.Join(runtime.GOROOT(), wasmFile)
	log.Printf("Using Go version %v: %v", v, filename)

	switch {
	case strings.HasPrefix(v, "go1.15"),
		strings.HasPrefix(v, "go1.16"),
		strings.HasPrefix(v, "go1.17"):
		makeEdits(filename,
			replaceAll("global.require.main === module", "false"),
			replaceRegexp("const fs = require.*?;", "try { $0"),
			replaceRegexp("global.fs = fs;", "$0 } } catch (err) {} {"),
		)
	default:
		makeEdits(filename)
	}

	log.Printf("Done.")
}

type editor func(s string) string

func replaceAll(from, to string) editor {
	return func(s string) string {
		return strings.ReplaceAll(s, from, to)
	}
}

func replaceRegexp(from, to string) editor {
	re := regexp.MustCompile(from)
	return func(s string) string {
		return re.ReplaceAllString(s, to)
	}
}

func makeEdits(filename string, edits ...editor) {
	// buf, err := os.ReadFile(filename)
	buf, err := ioutil.ReadFile(filename) // pre- Go 1.16
	if err != nil {
		log.Fatalf("Unable to read file %v", filename)
	}

	s := string(buf)
	for _, e := range edits {
		s = e(s)
	}

	fmt.Print(s)
}
