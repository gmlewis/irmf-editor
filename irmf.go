package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type irmf struct {
	Author    string          `json:"author"`
	Copyright string          `json:"copyright"`
	Date      string          `json:"date"`
	IRMF      string          `json:"irmf"`
	Materials []string        `json:"materials"`
	Max       []float64       `json:"max"`
	Min       []float64       `json:"min"`
	Notes     string          `json:"notes"`
	Options   json.RawMessage `json:"options"`
	Title     string          `json:"title"`
	Units     string          `json:"units"`
	Version   string          `json:"version"`
}

var jsonKeys = []string{
	"author",
	"copyright",
	"date",
	"irmf",
	"materials",
	"max",
	"min",
	"notes",
	"options",
	"title",
	"units",
	"version",
}

func parseJSON(s string) (*irmf, error) {
	result := &irmf{}
	if err := json.Unmarshal([]byte(s), result); err != nil {
		for _, key := range jsonKeys {
			s = strings.Replace(s, key+":", fmt.Sprintf("%q:", key), 1)
		}
		if err := json.Unmarshal([]byte(s), result); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (i *irmf) validate() error {
	if i.IRMF != "1.0" {
		return fmt.Errorf("unsupported IRMF version: %v", i.IRMF)
	}
	if len(i.Materials) < 1 {
		return errors.New("must list at least one material name")
	}
	if len(i.Materials) > 16 {
		return fmt.Errorf("IRMF 1.0 only supports up to 16 materials, found %v", len(i.Materials))
	}
	if len(i.Max) != 3 {
		return fmt.Errorf("max must have only 3 values, found %v", len(i.Max))
	}
	if len(i.Min) != 3 {
		return fmt.Errorf("min must have only 3 values, found %v", len(i.Min))
	}
	if i.Units == "" {
		return errors.New("units are required by IRMF 1.0 (even though the irmf-editor ignores the units)")
	}
	if i.Min[0] >= i.Max[0] {
		return fmt.Errorf("min.x (%v) must be strictly less than max.x (%v)", i.Min[0], i.Max[0])
	}
	if i.Min[1] >= i.Max[1] {
		return fmt.Errorf("min.y (%v) must be strictly less than max.y (%v)", i.Min[1], i.Max[1])
	}
	if i.Min[2] >= i.Max[2] {
		return fmt.Errorf("min.z (%v) must be strictly less than max.z (%v)", i.Min[2], i.Max[2])
	}

	return nil
}
