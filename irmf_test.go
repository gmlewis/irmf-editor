package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tslHeaderJSON = `{
  "author": "Glenn M. Lewis",
  "irmf": "1.0",
  "language": "tsl",
  "tslVersion": "0.180.0",
  "materials": ["PLA"],
  "max": [5,5,5],
  "min": [-5,-5,-5],
  "units": "mm"
}`

func TestParseTSL(t *testing.T) {
	blob, err := parseJSON(tslHeaderJSON)
	if err != nil {
		t.Fatalf("parseJSON: %v", err)
	}
	if blob.Language != "tsl" {
		t.Errorf("Language = %q, want %q", blob.Language, "tsl")
	}
	if blob.TSLVersion != "0.180.0" {
		t.Errorf("TSLVersion = %q, want %q", blob.TSLVersion, "0.180.0")
	}

	out, err := blob.format("const mainModel4 = (xyz) => [float(1)];\n")
	if err != nil {
		t.Fatalf("format: %v", err)
	}
	if !strings.Contains(out, `"tslVersion": "0.180.0"`) {
		t.Errorf("format dropped tslVersion:\n%s", out)
	}
	if !strings.Contains(out, `"language": "tsl"`) {
		t.Errorf("format dropped language:\n%s", out)
	}
}

func TestLanguageDefaultsToGLSL(t *testing.T) {
	blob, err := parseJSON(`{"irmf":"1.0","materials":["a"],"min":[0,0,0],"max":[1,1,1],"units":"mm"}`)
	if err != nil {
		t.Fatalf("parseJSON: %v", err)
	}
	if blob.Language != "glsl" {
		t.Errorf("Language = %q, want glsl", blob.Language)
	}
}

func TestValidateLanguages(t *testing.T) {
	body := "void mainModel4(out vec4 m, in vec3 xyz) {}\nfn mainModel4(){}\nconst mainModel4 = (xyz) => [float(1)];\n"
	tests := []struct {
		name     string
		language string
		wantErr  bool
	}{
		{"glsl", "glsl", false},
		{"wgsl", "wgsl", false},
		{"tsl", "tsl", false},
		{"unknown", "python", true},
		{"uppercase", "GLSL", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsonBlob := `{"irmf":"1.0","language":"` + tt.language + `","materials":["a"],"min":[0,0,0],"max":[1,1,1],"units":"mm"}`
			blob, err := parseJSON(jsonBlob)
			if err != nil {
				t.Fatalf("parseJSON: %v", err)
			}
			_, err = blob.validate(jsonBlob, body)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validate() err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateTSLRequiresEntryPoint(t *testing.T) {
	jsonBlob := `{"irmf":"1.0","language":"tsl","materials":["a"],"min":[0,0,0],"max":[1,1,1],"units":"mm"}`
	blob, err := parseJSON(jsonBlob)
	if err != nil {
		t.Fatalf("parseJSON: %v", err)
	}
	if _, err := blob.validate(jsonBlob, "const sphere = (r, p) => float(1);\n"); err == nil || !strings.Contains(err.Error(), "mainModel4") {
		t.Fatalf("validate() err = %v, want a mainModel4 error", err)
	}
}

func TestVendoredTSLEvaluatorInSync(t *testing.T) {
	dir := os.Getenv("IRMF_EXAMPLES_DIR")
	if dir == "" {
		t.Skip("IRMF_EXAMPLES_DIR is not set; skipping vendored evaluator drift check")
	}
	canonical, err := os.ReadFile(filepath.Join(dir, "tools", "tsl-compiler", "src", "eval.mjs"))
	if err != nil {
		t.Fatalf("reading canonical evaluator: %v", err)
	}
	vendored, err := os.ReadFile(filepath.Join("js", "vendor", "irmf-tsl", "eval.mjs"))
	if err != nil {
		t.Fatalf("reading vendored evaluator: %v", err)
	}
	if string(canonical) != string(vendored) {
		t.Fatal("js/vendor/irmf-tsl/eval.mjs is out of sync; run tools/sync-tsl-runtime.sh")
	}
}

func TestValidateTSL9and16(t *testing.T) {
	for _, tc := range []struct {
		n     int
		entry string
	}{
		{7, "mainModel9"},
		{12, "mainModel16"},
	} {
		mats := make([]string, tc.n)
		for i := range mats {
			mats[i] = "m"
		}
		jsonBlob := `{"irmf":"1.0","language":"tsl","materials":[` + strings.Repeat(`"m",`, tc.n-1) + `"m"],"min":[0,0,0],"max":[1,1,1],"units":"mm"}`
		blob, err := parseJSON(jsonBlob)
		if err != nil {
			t.Fatalf("parseJSON: %v", err)
		}
		if _, err := blob.validate(jsonBlob, "const "+tc.entry+" = (xyz) => [];\n"); err != nil {
			t.Errorf("%d materials: validate() err = %v", tc.n, err)
		}
	}
}
