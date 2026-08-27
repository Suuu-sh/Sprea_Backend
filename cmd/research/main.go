package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/yota/sprea/backend/internal/research"
)

func main() {
	db := flag.String("db", "data/sprea-research-demo.db", "SQLite database path")
	input := flag.String("input", "", "optional observation CSV")
	flag.Parse()
	store, err := research.Open(*db)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	for _, policy := range []research.SourcePolicy{
		{Source: "apple.com", Method: "scrape", TermsURL: "https://www.apple.com/legal/internet-services/terms/site.html", RobotsURL: "https://www.apple.com/robots.txt", Status: "blocked", ReviewedAt: time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC), Notes: "Apple Website Terms prohibit automated page scraping."},
		{Source: "rakuten", Method: "official_api", TermsURL: "https://webservice.rakuten.co.jp/guide/rule", Status: "approved", ReviewedAt: time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC), Notes: "Use Rakuten Web Service only; credentials and rate limits are required."},
		{Source: "buyback-csv", Method: "manual_csv", Status: "manual_only", ReviewedAt: time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC), Notes: "HTTP collection stays disabled until each buyback source is reviewed."},
	} {
		if err := store.SaveSourcePolicy(context.Background(), policy); err != nil {
			log.Fatal(err)
		}
	}
	now := time.Now().UTC()
	observations := demo(now)
	if *input != "" {
		observations, err = readCSV(*input)
		if err != nil {
			log.Fatal(err)
		}
	}
	p := research.Pipeline{Store: store, InitialCapital: 300000, MinimumProfit: 5000, MinimumConfidence: .95, SaleShipping: 1000}
	result, err := p.Run(context.Background(), observations, now)
	if err != nil {
		log.Fatal(err)
	}
	b, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(b))
}

func demo(now time.Time) []research.Observation {
	return []research.Observation{
		{Source: "demo-sale-csv", Side: research.Purchase, SourceProductID: "iphone17pro-256-silver", Title: "Apple iPhone 17 Pro 256GB Silver", Price: 179800, Stock: true, Condition: "new", Model: "A3523", Capacity: "256GB", Color: "silver", CapturedAt: now, Raw: map[string]any{"demo": true}},
		{Source: "demo-buyback-csv", Side: research.Buyback, SourceProductID: "iphone17pro-256-silver", Title: "iPhone 17 Pro 256GB Silver 新品", Price: 188000, Stock: true, Condition: "新品", Model: "A3523", Capacity: "256GB", Color: "silver", CapturedAt: now, Raw: map[string]any{"demo": true}},
	}
}

func readCSV(path string) ([]research.Observation, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("CSV requires a header and at least one row")
	}
	idx := map[string]int{}
	for i, h := range rows[0] {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	get := func(r []string, k string) string {
		i, ok := idx[k]
		if !ok || i >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[i])
	}
	out := make([]research.Observation, 0, len(rows)-1)
	for n, r := range rows[1:] {
		price, e := strconv.Atoi(get(r, "price"))
		if e != nil {
			return nil, fmt.Errorf("row %d price: %w", n+2, e)
		}
		shipping, _ := strconv.Atoi(get(r, "shipping"))
		captured := time.Now().UTC()
		if v := get(r, "captured_at"); v != "" {
			captured, e = time.Parse(time.RFC3339, v)
			if e != nil {
				return nil, fmt.Errorf("row %d captured_at: %w", n+2, e)
			}
		}
		side := research.Side(get(r, "side"))
		if side != research.Purchase && side != research.Buyback {
			return nil, fmt.Errorf("row %d side must be purchase or buyback", n+2)
		}
		stock := strings.ToLower(get(r, "stock")) != "false"
		out = append(out, research.Observation{Source: get(r, "source"), Side: side, SourceProductID: get(r, "source_product_id"), Title: get(r, "title"), Price: price, Shipping: shipping, Stock: stock, Condition: get(r, "condition"), JAN: get(r, "jan"), Model: get(r, "model"), Capacity: get(r, "capacity"), Color: get(r, "color"), CapturedAt: captured})
	}
	return out, nil
}
