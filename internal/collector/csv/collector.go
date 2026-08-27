// Package csv imports buyback prices from a simple CSV format.
package csv

import (
	"encoding/csv"
	"fmt"
	"github.com/yota/sprea/backend/internal/matcher"
	"io"
	"os"
	"strconv"
	"strings"
)

type Offer struct {
	Name, JAN, Model, Capacity, Color, Generation, Buyer string
	Price                                                int
}

// Read expects name,buyback_price,buyer and optionally jan,model,capacity,color,generation. Header order is arbitrary.
func Read(r io.Reader) ([]Offer, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read CSV: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("CSV is empty")
	}
	idx := map[string]int{}
	for i, h := range rows[0] {
		idx[strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, "\ufeff")))] = i
	}
	for _, h := range []string{"name", "buyback_price", "buyer"} {
		if _, ok := idx[h]; !ok {
			return nil, fmt.Errorf("missing required column %q", h)
		}
	}
	get := func(row []string, key string) string {
		i, ok := idx[key]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	out := make([]Offer, 0, len(rows)-1)
	for n, row := range rows[1:] {
		if strings.TrimSpace(strings.Join(row, "")) == "" {
			continue
		}
		price, e := strconv.Atoi(strings.ReplaceAll(get(row, "buyback_price"), ",", ""))
		if e != nil || price < 0 {
			return nil, fmt.Errorf("row %d: invalid buyback_price", n+2)
		}
		name, buyer := get(row, "name"), get(row, "buyer")
		if name == "" || buyer == "" {
			return nil, fmt.Errorf("row %d: name and buyer are required", n+2)
		}
		out = append(out, Offer{Name: name, Price: price, Buyer: buyer, JAN: get(row, "jan"), Model: get(row, "model"), Capacity: get(row, "capacity"), Color: get(row, "color"), Generation: get(row, "generation")})
	}
	return out, nil
}
func ReadFile(path string) ([]Offer, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Read(f)
}
func (o Offer) Product() matcher.Product {
	return matcher.Product{Name: o.Name, JAN: o.JAN, Model: o.Model, Capacity: o.Capacity, Color: o.Color, Generation: o.Generation}
}
