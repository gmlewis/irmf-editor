package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"math"
	"net/http"
	neturl "net/url"
	"regexp"
	"sort"
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

const (
	githubRawPrefix = "https://raw.githubusercontent.com/"

	// Limits applied to untrusted input. IRMF files are executable code, so
	// cap the damage a single file can do before any rendering starts.
	maxIRMFFileBytes   = 64 << 20 // 64 MiB raw .irmf file
	maxShaderBodyBytes = 16 << 20 // 16 MiB decoded shader body
	maxIncludeBytes    = 1 << 20  // 1 MiB per remote #include
	maxIncludes        = 16       // remote #include directives per model
	maxModelExtent     = 1 << 20  // model units along one axis
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
	installCallback("installCompileShader", compileShader)
	installCallback("installUpdateJSONOptionsCallback", updateJSONOptionsCallback)
	installCallback("installAlreadyCached", alreadyCached)
	installCallback("installSaveToCache", saveToCache)

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
	select {}
}

type jsFunc func(this js.Value, args []js.Value) interface{}

func installCallback(name string, fn jsFunc) {
	cb := js.FuncOf(fn)
	v := js.Global().Get(name)
	if v.Type() == js.TypeFunction {
		v.Invoke(cb)
	} else {
		logf("Unable to install callback %v", name)
	}
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

	if jsonBlob.Language == "tsl" {
		// TSL is JavaScript: fetching remote text into the body would be remote
		// code execution. validate() rejects such models; never expand them.
		if hasIncludeDirective(newShader) {
			logf("Error: #include is not allowed in TSL bodies; inline the code instead")
		}
	} else {
		newShader = processIncludes(newShader)
	}

	// Refresh the material-color GUI and hand the TSL runtime a descriptor of
	// how to mix the material values into colors.
	colorModel := setupMaterialColors(jsonBlob)

	// logf("Compiling new model shader:\n%v", newShader)
	js.Global().Call("loadNewModel", newShader+fsFooter(jsonBlob), jsonBlob.Language, colorModel)

	return nil
}

// processMaterialNames supports HSV, HSL, and RGB full color models.
// If any material is listed three times with unique suffix triplets ('.H','.S','.V'),
// ('.H','.S','.L'), or ('.R','.G','.B'), they are combined to form a
// color in the editor using the appropriate color space model.
// See https://en.wikipedia.org/wiki/HSL_and_HSV for more information.
func processMaterialNames(materialNames []string) (hsvMap, hslMap, rgbMap) {
	hsvs := hsvMap{}
	hsls := hslMap{}
	rgbs := rgbMap{}
	setH := func(name string, colorNum int) {
		if v, ok := hsvs[name]; ok {
			v.H = colorNum
		} else {
			hsvs[name] = &hsvT{H: colorNum}
		}
		if v, ok := hsls[name]; ok {
			v.H = colorNum
		} else {
			hsls[name] = &hslT{H: colorNum}
		}
	}
	setS := func(name string, colorNum int) {
		if v, ok := hsvs[name]; ok {
			v.S = colorNum
		} else {
			hsvs[name] = &hsvT{S: colorNum}
		}
		if v, ok := hsls[name]; ok {
			v.S = colorNum
		} else {
			hsls[name] = &hslT{S: colorNum}
		}
	}
	setV := func(name string, colorNum int) {
		if v, ok := hsvs[name]; ok {
			v.V = colorNum
		} else {
			hsvs[name] = &hsvT{V: colorNum}
		}
	}
	setL := func(name string, colorNum int) {
		if v, ok := hsls[name]; ok {
			v.L = colorNum
		} else {
			hsls[name] = &hslT{L: colorNum}
		}
	}
	setR := func(name string, colorNum int) {
		if v, ok := rgbs[name]; ok {
			v.R = colorNum
		} else {
			rgbs[name] = &rgbT{R: colorNum}
		}
	}
	setG := func(name string, colorNum int) {
		if v, ok := rgbs[name]; ok {
			v.G = colorNum
		} else {
			rgbs[name] = &rgbT{G: colorNum}
		}
	}
	setB := func(name string, colorNum int) {
		if v, ok := rgbs[name]; ok {
			v.B = colorNum
		} else {
			rgbs[name] = &rgbT{B: colorNum}
		}
	}
	for i, name := range materialNames {
		if len(name) > 2 {
			baseName := name[0 : len(name)-2]
			switch {
			case strings.HasSuffix(name, ".H"): // Make entries for both HSV and HSL, then clean up below.
				setH(baseName, i+1)
			case strings.HasSuffix(name, ".S"): // Make entries for both HSV and HSL, then clean up below.
				setS(baseName, i+1)
			case strings.HasSuffix(name, ".V"):
				setV(baseName, i+1)
			case strings.HasSuffix(name, ".L"):
				setL(baseName, i+1)
			case strings.HasSuffix(name, ".R"):
				setR(baseName, i+1)
			case strings.HasSuffix(name, ".G"):
				setG(baseName, i+1)
			case strings.HasSuffix(name, ".B"):
				setB(baseName, i+1)
			}
		}
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

	return hsvs, hsls, rgbs
}

// hsvT maps each color channel to a color number for an HSV color model.
type hsvT struct{ H, S, V int }

// hslT maps each color channel to a color number for an HSL color model.
type hslT struct{ H, S, L int }

// rgbT maps each color channel to a color number for an RGB color model.
type rgbT struct{ R, G, B int }

// hsvMap maps a material prefix name (e.g. "PLA") to the material numbers
// (1-based index) for each of its components. So if the materials were:
// ["metal", "PLA.V", "dielectric", "PLA.H", "PLA.S"], then the map entry
// would be: "PLA": {H: 4, S: 5, V: 2}.
type hsvMap map[string]*hsvT

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
type hslMap map[string]*hslT

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
type rgbMap map[string]*rgbT

func (m rgbMap) keys() (result []string) {
	for k := range m {
		result = append(result, k)
	}
	return result
}

func parseEditor(src []byte) (*irmf, string) {
	if len(src) > maxIRMFFileBytes {
		logf("IRMF file is too large (%v bytes; limit is %v)", len(src), maxIRMFFileBytes)
		js.Global().Call("highlightShaderError", 1)
		return nil, ""
	}
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
		// Cap decompression so a small file cannot expand into a memory bomb.
		if _, err := io.Copy(buf, io.LimitReader(zr, maxShaderBodyBytes+1)); err != nil {
			return err
		}
		if buf.Len() > maxShaderBodyBytes {
			return fmt.Errorf("decoded shader exceeds %v bytes", maxShaderBodyBytes)
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
		if len(shaderSrcBuf) > maxShaderBodyBytes {
			logf("Shader body is too large (%v bytes; limit is %v)", len(shaderSrcBuf), maxShaderBodyBytes)
			return nil, ""
		}
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
	href := js.Global().Get("document").Get("location").Get("href").String()

	const oldPrefix = "/?s=github.com/"
	if i := strings.Index(href, oldPrefix); i >= 0 {
		location := href[i+len(oldPrefix):]
		lower := strings.ToLower(location)
		if !strings.HasSuffix(lower, ".irmf") {
			js.Global().Call("alert", "irmf-editor will only load .irmf files")
			return nil
		}

		location = githubRawPrefix + strings.Replace(location, "/blob/", "/", 1)
		if !js.Global().Call("confirmRemoteModel", location).Bool() {
			logf("Remote model from %v was not approved", location)
			return nil
		}
		buf, _ := curl(location)
		if len(buf) > 0 {
			// Record the exact URL so the consent prompt can name the source
			// and so approval is per model, not per session.
			js.Global().Set("__irmfRemoteSource", location)
		}
		return buf
	}

	// Same-origin local file, e.g. /?file=/examples/001-sphere/sphere-1-tsl.irmf
	const filePrefix = "/?file="
	if i := strings.Index(href, filePrefix); i >= 0 {
		path := href[i+len(filePrefix):]
		if j := strings.IndexAny(path, "&#"); j >= 0 {
			path = path[:j]
		}
		// PathUnescape (not QueryUnescape) so that '+' is preserved in file names.
		if decoded, err := neturl.PathUnescape(path); err == nil {
			path = decoded
		}
		if !isSafeSameOriginPath(path) {
			js.Global().Call("alert", "invalid ?file= path (must be a same-origin /....irmf path)")
			return nil
		}
		js.Global().Set("__irmfRemoteSource", false)
		text := js.Global().Call("fetchTextSync", path).String()
		if text == "" {
			logf("Unable to load source from: %v", path)
			return nil
		}
		return []byte(text)
	}

	logf("No source requested in URL path.")
	return nil
}

// isSafeSameOriginPath reports whether path (already percent-decoded) is a
// same-origin absolute path pointing at an .irmf file.
//
// This must reject protocol-relative URLs such as "//evil.example/x.irmf":
// a browser resolves those to another origin, which would let a link run
// remote TSL without the user ever seeing the remote-source prompt.
// Backslashes are rejected too because browsers normalize "/\" to "//".
func isSafeSameOriginPath(path string) bool {
	if path == "" || path[0] != '/' {
		return false
	}
	if len(path) > 1 && (path[1] == '/' || path[1] == '\\') {
		return false
	}
	if strings.ContainsAny(path, "\\\x00\r\n") {
		return false
	}
	if strings.Contains(path, "..") {
		return false
	}
	if !strings.HasSuffix(strings.ToLower(path), ".irmf") {
		return false
	}
	u, err := neturl.Parse(path)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil {
		return false
	}
	return true
}

// hasIncludeDirective reports whether src contains an #include line.
func hasIncludeDirective(src string) bool {
	for _, line := range strings.Split(src, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#include") {
			return true
		}
	}
	return false
}

var curlCache = map[string][]byte{}

func alreadyCached(this js.Value, args []js.Value) interface{} {
	if len(args) != 1 {
		logf("alreadyCached: expected 1 arg, got %v", len(args))
		return nil
	}

	url := args[0].String()
	_, ok := curlCache[url]
	return ok
}

func saveToCache(this js.Value, args []js.Value) interface{} {
	if len(args) != 2 {
		logf("saveToCache: expected 2 args, got %v", len(args))
		return nil
	}

	url := args[0].String()
	body := []byte(args[1].String())
	curlCache[url] = body
	return nil
}

func curl(url string) ([]byte, error) {
	return curlLimited(url, maxShaderBodyBytes)
}

func curlLimited(url string, limit int64) ([]byte, error) {
	buf, ok := curlCache[url]
	if ok {
		return buf, nil
	}

	resp, err := http.Get(url)
	if err != nil {
		logf("Unable to download source from: %v", url)
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		logf("Unable to download source from: %v (HTTP %v)", url, resp.StatusCode)
		return nil, fmt.Errorf("HTTP %v", resp.StatusCode)
	}
	// Cap the response so a hostile server cannot exhaust the tab's memory.
	buf, err = ioutil.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		logf("Unable to read response body.")
		return nil, err
	}
	if int64(len(buf)) > limit {
		logf("Remote source from %v exceeds %v bytes; ignoring", url, limit)
		return nil, fmt.Errorf("response exceeds %v bytes", limit)
	}
	logf("Read %v bytes from %v", len(buf), url)

	curlCache[url] = buf
	return buf, nil
}

var (
	includeRE = regexp.MustCompile(`^#include\s+"([^"]+)"`)
	// GitHub includes must name an immutable commit (40 hex characters).
	// Branch and tag names can be moved by the repository owner, which would
	// change the code a model executes without changing the model file.
	githubIncludeRE = regexp.MustCompile(
		`^github\.com/([^/]+)/([^/]+)/(?:(?:blob|raw)/)?([0-9a-fA-F]{40})/(.+)$`)
	// Only used after the user explicitly allows a mutable include.
	githubMutableIncludeRE = regexp.MustCompile(
		`^github\.com/([^/]+)/([^/]+)/(?:blob|raw)/([^/]+)/(.+)$`)
)

const (
	lygiaBaseURL = "https://lygia.xyz"
	prefix1      = "lygia.xyz/"
	prefix2      = "lygia/"
	prefix3      = "github.com/"
)

// mutableIncludeURL returns the raw GitHub URL for an #include that names a
// branch or tag, or "" if it is not a mutable GitHub include. It is only used
// after the user has explicitly approved a mutable include; parseIncludeURL
// remains strict.
func mutableIncludeURL(trimmed string) string {
	m := includeRE.FindStringSubmatch(trimmed)
	if len(m) < 2 {
		return ""
	}
	inc := m[1]
	if !strings.HasSuffix(inc, ".glsl") || !strings.HasPrefix(inc, prefix3) {
		return ""
	}
	if githubIncludeRE.MatchString(inc) {
		return "" // already pinned; parseIncludeURL handles it
	}
	m = githubMutableIncludeRE.FindStringSubmatch(inc)
	if m == nil {
		return ""
	}
	if !safeIncludeRefAndPath(m[3], m[4]) {
		return ""
	}
	return fmt.Sprintf("%v%v/%v/%v/%v", githubRawPrefix, m[1], m[2], m[3], m[4])
}

// safeIncludeRefAndPath rejects refs and paths that would change the meaning
// of the constructed URL or traverse the fetched path.
func safeIncludeRefAndPath(ref, path string) bool {
	if ref == "" || ref == "." || ref == ".." ||
		strings.Contains(ref, "..") || strings.ContainsAny(ref, `\?#%`) {
		return false
	}
	if strings.ContainsAny(path, `\?#%`) || strings.ContainsAny(path, "\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	return true
}

func parseIncludeURL(trimmed string) string {
	m := includeRE.FindStringSubmatch(trimmed)
	if len(m) < 2 {
		return ""
	}

	inc := m[1]
	if !strings.HasSuffix(inc, ".glsl") {
		return ""
	}

	switch {
	case strings.HasPrefix(inc, prefix1):
		return fmt.Sprintf("%v/%v", lygiaBaseURL, inc[len(prefix1):])
	case strings.HasPrefix(inc, prefix2):
		return fmt.Sprintf("%v/%v", lygiaBaseURL, inc[len(prefix2):])
	case strings.HasPrefix(inc, prefix3):
		m := githubIncludeRE.FindStringSubmatch(inc)
		if m == nil || !safeIncludeRefAndPath(m[3], m[4]) {
			return ""
		}
		return fmt.Sprintf("%v%v/%v/%v/%v", githubRawPrefix, m[1], m[2], m[3], m[4])
	default:
		return ""
	}
}

// processIncludes converts "#include" lines (with recognized prefixes)
// into their actual source by retrieving them from the internet.
//
// Remote includes are fetched code, so this function requires explicit user
// consent per host (see confirmRemoteInclude in js/startup.js), caps the number
// and size of fetched files, and never touches TSL bodies (callers must check
// the language first; TSL includes are rejected during validation).
//
// Note that multiline comments ("/*" and "*/") are currently not supported.
// It is recommended that an ignored "#include" statement should be commented-out
// with single-line comments ("//...").
func processIncludes(source string) string {
	lines := strings.Split(source, "\n")
	var result []string
	includeCount := 0
	var totalIncludeBytes int64
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		url := parseIncludeURL(trimmed)
		if url == "" && strings.HasPrefix(trimmed, "#include") {
			// A branch/tag include is mutable, so it needs an explicit
			// per-file approval in addition to the host approval below.
			if mutableURL := mutableIncludeURL(trimmed); mutableURL != "" &&
				js.Global().Call("confirmMutableInclude", trimmed).Bool() {
				url = mutableURL
				logf("WARNING: fetching mutable include: %v", trimmed)
			}
		}
		if url == "" {
			if strings.HasPrefix(trimmed, "#include") {
				logf("Blocked unsupported or unpinned #include: %v", trimmed)
			}
			result = append(result, line)
			continue
		}

		if includeCount >= maxIncludes {
			logf("Blocked remote include: model exceeds the %v-include limit", maxIncludes)
			result = append(result, line)
			continue
		}
		host := includeHost(url)
		if host == "" {
			logf("Blocked remote include with an unsupported URL")
			result = append(result, line)
			continue
		}
		if !js.Global().Call("confirmRemoteInclude", host).Bool() {
			logf("Remote include from %v was not approved; it was not downloaded", host)
			result = append(result, line)
			continue
		}

		buf, err := curlLimited(url, maxIncludeBytes)
		if err != nil {
			result = append(result, line)
			continue
		}
		totalIncludeBytes += int64(len(buf))
		if totalIncludeBytes > maxIncludes*maxIncludeBytes {
			logf("Blocked remote include: total included source is too large")
			result = append(result, line)
			continue
		}
		includeCount++
		result = append(result, string(buf))
	}

	return strings.Join(result, "\n")
}

// includeHost returns the host name of an https URL, or "" if the URL is not
// an acceptable remote-include URL.
func includeHost(rawURL string) string {
	u, err := neturl.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return ""
	}
	return u.Hostname()
}

func clearLog() {
	if logfDiv.Type() != js.TypeNull && logfDiv.Type() != js.TypeUndefined {
		logfDiv.Set("textContent", "")
	}
}

// logf appends a message to the log panel. It must go through jsLogf (which
// uses textContent), never through innerHTML: log messages contain shader
// source, URLs, and other attacker-controlled text.
func logf(fmtStr string, args ...interface{}) {
	msg := fmt.Sprintf(fmtStr, args...)
	if logfDiv.Type() != js.TypeNull && logfDiv.Type() != js.TypeUndefined {
		js.Global().Call("jsLogf", msg)
	} else {
		fmt.Println(msg)
	}
}

const startupShader = `/*{
  irmf: "1.0",
	language: "glsl",
  materials: ["PLA"],
  max: [10,10,10],
  min: [0,0,0],
  units: "mm",
}*/

float sphere(in float radius, in vec3 xyz) {
  float r = length(xyz);
  return r <= radius ? 1.0 : 0.0;
}

void mainModel4(out vec4 materials, in vec3 xyz ) {
  const float radius = 6.0;
  materials[0] = 1.0 - sphere(radius, xyz-vec3(5));  // 1.0 represents the cube.
}
`

func fsFooter(jsonBlob *irmf) string {
	switch jsonBlob.Language {
	case "wgsl":
		return wgslFooter(jsonBlob)
	case "tsl":
		// TSL does not use shader-text footers; the runtime builds the
		// equivalent graph from the color descriptor (setupMaterialColors).
		return ""
	}
	hsvs, hsls, rgbs := processMaterialNames(jsonBlob.Materials)
	footer, _ := processColors(jsonBlob.Materials, hsvs, hsls, rgbs)
	return footer
}

// tslThreeVersion is the three.js release the editor's TSL runtime pins.
const tslThreeVersion = "0.180.0"

// plainColor describes a material that is rendered with a single GUI color.
type plainColor struct {
	Index int `json:"index"` // 1-based material index
	Color int `json:"color"` // 1-based u_colorN uniform
}

// materialColorDescriptor tells the TSL runtime how to mix material values
// into a color, matching the GLSL/WGSL footer math.
type materialColorDescriptor struct {
	Materials []string     `json:"materials"`
	HSV       [][]int      `json:"hsv"`
	HSL       [][]int      `json:"hsl"`
	RGB       [][]int      `json:"rgb"`
	Plain     []plainColor `json:"plain"`
}

func sortedKeys(m map[string]*hsvT) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeysHSL(m map[string]*hslT) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeysRGB(m map[string]*rgbT) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// materialColorDescriptorFor computes how to mix material values into a color,
// matching genColorMixer's math. It is pure so it can be unit tested.
func materialColorDescriptorFor(materialNames []string) (materialColorDescriptor, []string) {
	hsvs, hsls, rgbs := processMaterialNames(materialNames)

	desc := materialColorDescriptor{
		Materials: materialNames,
		HSV:       [][]int{},
		HSL:       [][]int{},
		RGB:       [][]int{},
		Plain:     []plainColor{},
	}
	usedColors := map[int]bool{}
	for _, k := range sortedKeys(hsvs) {
		v := hsvs[k]
		desc.HSV = append(desc.HSV, []int{v.H, v.S, v.V})
		usedColors[v.H], usedColors[v.S], usedColors[v.V] = true, true, true
	}
	for _, k := range sortedKeysHSL(hsls) {
		v := hsls[k]
		desc.HSL = append(desc.HSL, []int{v.H, v.S, v.L})
		usedColors[v.H], usedColors[v.S], usedColors[v.L] = true, true, true
	}
	for _, k := range sortedKeysRGB(rgbs) {
		v := rgbs[k]
		desc.RGB = append(desc.RGB, []int{v.R, v.G, v.B})
		usedColors[v.R], usedColors[v.G], usedColors[v.B] = true, true, true
	}

	var colorNames []string
	nextColor := 1
	for i := 1; i <= len(materialNames); i++ {
		if !usedColors[i] {
			desc.Plain = append(desc.Plain, plainColor{Index: i, Color: nextColor})
			colorNames = append(colorNames, materialNames[i-1])
			nextColor++
		}
	}

	return desc, colorNames
}

// setupMaterialColors refreshes the material-color GUI controllers and returns
// a JSON descriptor the TSL runtime uses to mix material values into colors.
func setupMaterialColors(jsonBlob *irmf) string {
	desc, colorNames := materialColorDescriptorFor(jsonBlob.Materials)

	colorFolder := js.Global().Call("getColorFolder")
	if colorFolder.Type() != js.TypeNull && colorFolder.Type() != js.TypeUndefined {
		// Only count the colors for non-full-color materials.
		colorFolder.Set("name", fmt.Sprintf("Material colors (%v)", len(colorNames)))
		jsArray := js.ValueOf([]interface{}{})
		for i, name := range colorNames {
			jsArray.SetIndex(i, name)
		}
		js.Global().Call("refreshMaterialColorControllers", jsArray)
	}

	buf, err := json.Marshal(desc)
	if err != nil {
		logf("Error: unable to marshal material color descriptor: %v", err)
		return "{}"
	}
	return string(buf)
}

// processColors returns a final fragment shader footer (which includes a color math
// expression for mixing colors) and a list of final color names shown in
// the GUI for setting colors on each non-full-color material.
func processColors(materialNames []string, hsvs hsvMap, hsls hslMap, rgbs rgbMap) (string, []string) {
	var prefixFuncs []string
	if len(hsvs) > 0 {
		prefixFuncs = append(prefixFuncs, hsvFunc)
	}
	if len(hsls) > 0 {
		prefixFuncs = append(prefixFuncs, hslFunc)
	}

	footerFmt, colorMixer, colorNames := genColorMixer(materialNames, hsvs, hsls, rgbs)
	footer := strings.Join(prefixFuncs, "\n") + fmt.Sprintf(footerFmt, colorMixer)
	return footer, colorNames
}

// genColorMixer generates the pieces needed for processColors, and makes it easier to test.
func genColorMixer(materialNames []string, hsvs hsvMap, hsls hslMap, rgbs rgbMap) (string, string, []string) {
	var colorToMaterial func(colorNum int) string
	var footerFmt string
	numMaterials := len(materialNames)
	switch numMaterials {
	default:
		footerFmt = fsFooterFmt4
		colorToMaterial = func(colorNum int) string {
			return []string{"m.x", "m.y", "m.z", "m.w"}[colorNum-1]
		}
	case 5, 6, 7, 8, 9:
		footerFmt = fsFooterFmt9
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[1][0]", "m[1][1]", "m[1][2]", "m[2][0]", "m[2][1]", "m[2][2]"}[colorNum-1]
		}
	case 10, 11, 12, 13, 14, 15, 16:
		footerFmt = fsFooterFmt16
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[0][3]", "m[1][0]", "m[1][1]", "m[1][2]", "m[1][3]", "m[2][0]", "m[2][1]", "m[2][2]", "m[2][3]", "m[3][0]", "m[3][1]", "m[3][2]", "m[3][3]"}[colorNum-1]
		}
	case 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32:
		footerFmt = fsFooterFmt32
		colorToMaterial = func(colorNum int) string {
			return []string{"mA[0][0]", "mA[0][1]", "mA[0][2]", "mA[0][3]", "mA[1][0]", "mA[1][1]", "mA[1][2]", "mA[1][3]", "mA[2][0]", "mA[2][1]", "mA[2][2]", "mA[2][3]", "mA[2][0]", "mA[2][1]", "mA[2][2]", "mA[2][3]",
				"mB[0][0]", "mB[0][1]", "mB[0][2]", "mB[0][3]", "mB[1][0]", "mB[1][1]", "mB[1][2]", "mB[1][3]", "mB[2][0]", "mB[2][1]", "mB[2][2]", "mB[2][3]", "mB[2][0]", "mB[2][1]", "mB[2][2]", "mB[2][3]"}[colorNum-1]
		}
	case 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48:
		footerFmt = fsFooterFmt32
		colorToMaterial = func(colorNum int) string {
			return []string{"mA[0][0]", "mA[0][1]", "mA[0][2]", "mA[0][3]", "mA[1][0]", "mA[1][1]", "mA[1][2]", "mA[1][3]", "mA[2][0]", "mA[2][1]", "mA[2][2]", "mA[2][3]", "mA[2][0]", "mA[2][1]", "mA[2][2]", "mA[2][3]",
				"mB[0][0]", "mB[0][1]", "mB[0][2]", "mB[0][3]", "mB[1][0]", "mB[1][1]", "mB[1][2]", "mB[1][3]", "mB[2][0]", "mB[2][1]", "mB[2][2]", "mB[2][3]", "mB[2][0]", "mB[2][1]", "mB[2][2]", "mB[2][3]",
				"mC[0][0]", "mC[0][1]", "mC[0][2]", "mC[0][3]", "mC[1][0]", "mC[1][1]", "mC[1][2]", "mC[1][3]", "mC[2][0]", "mC[2][1]", "mC[2][2]", "mC[2][3]", "mC[2][0]", "mC[2][1]", "mC[2][2]", "mC[2][3]"}[colorNum-1]
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
		r := colorToMaterial(v.R)
		g := colorToMaterial(v.G)
		b := colorToMaterial(v.B)
		finalColors = append(finalColors, fmt.Sprintf("vec4(%v,%v,%v,max(%v,max(%v,%v)))", r, g, b, r, g, b))
	}

	var colorNames []string
	nextColor := 1
	for i := 1; i <= numMaterials; i++ {
		if !usedColors[i] {
			finalColors = append(finalColors, fmt.Sprintf("u_color%v*%v", nextColor, colorToMaterial(i)))
			colorNames = append(colorNames, materialNames[i-1])
			nextColor++
		}
	}

	return footerFmt, fmt.Sprintf("u_d*(%v)", strings.Join(finalColors, " + ")), colorNames
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

const fsFooterFmt32 = `
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
  mat4 mA;
  mat4 mB;
  mainModel32(mA, mB, v_xyz.xyz);
  out_FragColor = %v;
  // out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
}
`

const fsFooterFmt48 = `
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
  mat4 mA;
  mat4 mB;
  mat4 mC;
  mainModel48(mA, mB, mC, v_xyz.xyz);
  out_FragColor = %v;
  // out_FragColor = v_xyz/5.0 + 0.5;  // DEBUG
}
`

func wgslFooter(jsonBlob *irmf) string {
	numMaterials := len(jsonBlob.Materials)
	var footerFmt string
	var colorToMaterial func(colorNum int) string
	switch {
	case numMaterials <= 4:
		footerFmt = wgslFooterFmt4
		colorToMaterial = func(colorNum int) string {
			return []string{"m.x", "m.y", "m.z", "m.w"}[colorNum-1]
		}
	case numMaterials <= 9:
		footerFmt = wgslFooterFmt9
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[1][0]", "m[1][1]", "m[1][2]", "m[2][0]", "m[2][1]", "m[2][2]"}[colorNum-1]
		}
	case numMaterials <= 16:
		footerFmt = wgslFooterFmt16
		colorToMaterial = func(colorNum int) string {
			return []string{"m[0][0]", "m[0][1]", "m[0][2]", "m[0][3]", "m[1][0]", "m[1][1]", "m[1][2]", "m[1][3]", "m[2][0]", "m[2][1]", "m[2][2]", "m[2][3]", "m[3][0]", "m[3][1]", "m[3][2]", "m[3][3]"}[colorNum-1]
		}
	}

	var colorMixers []string
	for i := 1; i <= numMaterials; i++ {
		colorMixers = append(colorMixers, fmt.Sprintf("u.colors[%v] * %v", i-1, colorToMaterial(i)))
	}

	colorMixer := fmt.Sprintf("u_d * (%v)", strings.Join(colorMixers, " + "))
	return fmt.Sprintf(footerFmt, colorMixer)
}

const wgslFooterFmt4 = `
@fragment
fn main(@location(0) v_xyz: vec4<f32>, @location(1) u_d: f32) -> @location(0) vec4<f32> {
  if (any(v_xyz.xyz < u.ll.xyz) || any(v_xyz.xyz > u.ur.xyz)) {
    return vec4<f32>(0.0);
  }
  let m = mainModel4(v_xyz.xyz);
  return %v;
}
`

const wgslFooterFmt9 = `
@fragment
fn main(@location(0) v_xyz: vec4<f32>, @location(1) u_d: f32) -> @location(0) vec4<f32> {
  if (any(v_xyz.xyz < u.ll.xyz) || any(v_xyz.xyz > u.ur.xyz)) {
    return vec4<f32>(0.0);
  }
  let m = mainModel9(v_xyz.xyz);
  return %v;
}
`

const wgslFooterFmt16 = `
@fragment
fn main(@location(0) v_xyz: vec4<f32>, @location(1) u_d: f32) -> @location(0) vec4<f32> {
  if (any(v_xyz.xyz < u.ll.xyz) || any(v_xyz.xyz > u.ur.xyz)) {
    return vec4<f32>(0.0);
  }
  let m = mainModel16(v_xyz.xyz);
  return %v;
}
`

const hsvFunc = `
vec4 hsv(float h, float s, float v) {
  float k5 = mod(5.0+6.0*h, 6.0);
  float k3 = mod(3.0+6.0*h, 6.0);
  float k1 = mod(1.0+6.0*h, 6.0);
  float f5 = v - v*s*max(min(k5,min(4.0-k5,1.0)),0.0);
  float f3 = v - v*s*max(min(k3,min(4.0-k3,1.0)),0.0);
  float f1 = v - v*s*max(min(k1,min(4.0-k1,1.0)),0.0);
  return vec4(f5,f3,f1,max(f5,max(f3,f1)));
}
`

const hslFunc = `
vec4 hsl(float h, float s, float l) {
  float a = s*min(l,1.0-l);
  float k0 = mod(0.0+12.0*h, 12.0);
  float k8 = mod(8.0+12.0*h, 12.0);
  float k4 = mod(4.0+12.0*h, 12.0);
  float f0 = l - a*max(min(k0-3.0,min(9.0-k0,1.0)),-1.0);
  float f8 = l - a*max(min(k8-3.0,min(9.0-k8,1.0)),-1.0);
  float f4 = l - a*max(min(k4-3.0,min(9.0-k4,1.0)),-1.0);
  return vec4(f0,f8,f4,max(f0,max(f8,f4)));
}
`
