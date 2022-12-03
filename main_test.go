package main

import (
	"reflect"
	"testing"
)

func TestProcessMaterialNames(t *testing.T) {
	tests := []struct {
		name          string
		materialNames []string
		wantHSVs      hsvMap
		wantHSLs      hslMap
		wantRGBs      rgbMap
	}{
		{
			name:          "No full-color materials",
			materialNames: []string{"PLA", "metal", "dielectric"},
		},
		{
			name:          "One HSV triplet",
			materialNames: []string{"PLA.H", "PLA.S", "PLA.V"},
			wantHSVs:      hsvMap{"PLA": &hsvT{H: 1, S: 2, V: 3}},
		},
		{
			name:          "One HSV reversed triplet",
			materialNames: []string{"PLA.V", "PLA.S", "PLA.H"},
			wantHSVs:      hsvMap{"PLA": &hsvT{H: 3, S: 2, V: 1}},
		},
		{
			name:          "Another single HSV triplet",
			materialNames: []string{"PLA.V", "PLA.H", "PLA.S"},
			wantHSVs:      hsvMap{"PLA": &hsvT{H: 2, S: 3, V: 1}},
		},
		{
			name:          "Three triplets",
			materialNames: []string{"metal.H", "PLA.V", "PLA.H", "metal.S", "PLA.S", "dielectric.G", "metal.L", "dielectric.R", "dielectric.B"},
			wantHSVs:      hsvMap{"PLA": &hsvT{H: 3, S: 5, V: 2}},
			wantHSLs:      hslMap{"metal": &hslT{H: 1, S: 4, L: 7}},
			wantRGBs:      rgbMap{"dielectric": &rgbT{R: 8, G: 6, B: 9}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.wantHSVs == nil {
				tt.wantHSVs = hsvMap{}
			}
			if tt.wantHSLs == nil {
				tt.wantHSLs = hslMap{}
			}
			if tt.wantRGBs == nil {
				tt.wantRGBs = rgbMap{}
			}

			hsvs, hsls, rgbs := processMaterialNames(tt.materialNames)
			if !reflect.DeepEqual(hsvs, tt.wantHSVs) {
				t.Errorf("hsvs = %#v, want %#v", hsvs, tt.wantHSVs)
			}
			if !reflect.DeepEqual(hsls, tt.wantHSLs) {
				t.Errorf("hsls = %#v, want %#v", hsls, tt.wantHSLs)
			}
			if !reflect.DeepEqual(rgbs, tt.wantRGBs) {
				t.Errorf("rgbs = %#v, want %#v", rgbs, tt.wantRGBs)
			}
		})
	}
}

func TestGenColorMixer(t *testing.T) {
	tests := []struct {
		name           string
		materialNames  []string
		hsvs           hsvMap
		hsls           hslMap
		rgbs           rgbMap
		wantColorMixer string
		wantColorNames []string
	}{
		{
			name:           "No full-color materials",
			materialNames:  []string{"PLA", "metal", "dielectric"},
			wantColorMixer: "u_d*(u_color1*m.x + u_color2*m.y + u_color3*m.z)",
			wantColorNames: []string{"PLA", "metal", "dielectric"},
		},
		{
			name:           "One HSV triplet",
			materialNames:  []string{"PLA.H", "PLA.S", "PLA.V"},
			wantColorMixer: "u_d*(hsv(m.x,m.y,m.z))",
			hsvs:           hsvMap{"PLA": &hsvT{H: 1, S: 2, V: 3}},
		},
		{
			name:           "One HSV reversed triplet",
			materialNames:  []string{"PLA.V", "PLA.S", "PLA.H"},
			wantColorMixer: "u_d*(hsv(m.z,m.y,m.x))",
			hsvs:           hsvMap{"PLA": &hsvT{H: 3, S: 2, V: 1}},
		},
		{
			name:           "Another single HSV triplet",
			materialNames:  []string{"PLA.V", "PLA.H", "PLA.S"},
			wantColorMixer: "u_d*(hsv(m.y,m.z,m.x))",
			hsvs:           hsvMap{"PLA": &hsvT{H: 2, S: 3, V: 1}},
		},
		{
			name:           "Three triplets",
			materialNames:  []string{"metal.H", "PLA.V", "PLA.H", "metal.S", "PLA.S", "dielectric.G", "metal.L", "dielectric.R", "dielectric.B"},
			hsvs:           hsvMap{"PLA": &hsvT{H: 3, S: 5, V: 2}},
			hsls:           hslMap{"metal": &hslT{H: 1, S: 4, L: 7}},
			rgbs:           rgbMap{"dielectric": &rgbT{R: 8, G: 6, B: 9}},
			wantColorMixer: "u_d*(hsv(m[0][2],m[1][1],m[0][1]) + hsl(m[0][0],m[1][0],m[2][0]) + vec4(m[2][1],m[1][2],m[2][2],max(m[2][1],max(m[1][2],m[2][2]))))",
		},
		{
			name:           "One HSV triplet with an extra material",
			materialNames:  []string{"PLA.H", "PLA.S", "extra", "PLA.V"},
			hsvs:           hsvMap{"PLA": &hsvT{H: 1, S: 2, V: 4}},
			wantColorMixer: "u_d*(hsv(m.x,m.y,m.w) + u_color1*m.z)",
			wantColorNames: []string{"extra"},
		},
		{
			name:           "One RGB triplet",
			materialNames:  []string{"PLA.R", "PLA.G", "PLA.B"},
			wantColorMixer: "u_d*(vec4(m.x,m.y,m.z,max(m.x,max(m.y,m.z))))",
			rgbs:           rgbMap{"PLA": &rgbT{R: 1, G: 2, B: 3}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, colorMixer, colorNames := genColorMixer(tt.materialNames, tt.hsvs, tt.hsls, tt.rgbs)
			if colorMixer != tt.wantColorMixer {
				t.Errorf("colorMixer = %q, want %q", colorMixer, tt.wantColorMixer)
			}
			if !reflect.DeepEqual(colorNames, tt.wantColorNames) {
				t.Errorf("colorNames = %#v, want %#v", colorNames, tt.wantColorNames)
			}
		})
	}
}

func TestParseIncludeURL(t *testing.T) {
	tests := []struct {
		name    string
		trimmed string
		want    string
	}{
		{
			name: "empty",
		},
		{
			name:    "bogus",
			trimmed: `#include "bad/include.h"`,
		},
		{
			name:    "lygia normal",
			trimmed: `#include "lygia/math/decimation.glsl"`,
			want:    "https://lygia.xyz/math/decimation.glsl",
		},
		{
			name:    "lygia extra space",
			trimmed: `#include    "lygia/math/decimation.glsl"`,
			want:    "https://lygia.xyz/math/decimation.glsl",
		},
		{
			name:    "lygia accidental copy/paste",
			trimmed: `#include "lygia.xyz/math/decimation.glsl"`,
			want:    "https://lygia.xyz/math/decimation.glsl",
		},
		{
			name:    "github normal",
			trimmed: `#include "github.com/gmlewis/irmf-examples/blob/master/examples/012-bifilar-electromagnet/rotation.glsl"`,
			want:    "https://raw.githubusercontent.com/gmlewis/irmf-examples/master/examples/012-bifilar-electromagnet/rotation.glsl",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseIncludeURL(tt.trimmed)
			if got != tt.want {
				t.Errorf("parseIncludeURL got %v, want %v", got, tt.want)
			}
		})
	}
}
