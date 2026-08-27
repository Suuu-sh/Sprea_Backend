package research

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestVerticalSliceOpensAndEvaluatesPaperTrade(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "research.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	t0 := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	base := []Observation{
		{Source: "sale", Side: Purchase, SourceProductID: "p1", Title: "Apple iPhone 17 Pro 256GB", Price: 180000, Shipping: 0, Stock: true, Condition: "new", Model: "A3523", Capacity: "256GB", Color: "silver", CapturedAt: t0},
		{Source: "buyer", Side: Buyback, SourceProductID: "b1", Title: "iPhone 17 Pro 256GB", Price: 190000, Stock: true, Condition: "新品", Model: "A3523", Capacity: "256GB", Color: "silver", CapturedAt: t0},
	}
	p := Pipeline{Store: store, InitialCapital: 300000, MinimumProfit: 5000, MinimumConfidence: .95, SaleShipping: 1000}
	r, err := p.Run(context.Background(), base, t0)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Opened) != 1 || r.Portfolio.AvailableCash != 120000 {
		t.Fatalf("unexpected first run: %+v", r)
	}
	checkpoints := []struct {
		h     int
		price int
	}{{24, 189000}, {48, 187000}, {72, 184000}}
	for _, c := range checkpoints {
		now := t0.Add(time.Duration(c.h) * time.Hour)
		obs := Observation{Source: "buyer", Side: Buyback, SourceProductID: "b1", Title: "iPhone 17 Pro 256GB", Price: c.price, Stock: true, Condition: "new", Model: "A3523", Capacity: "256GB", Color: "silver", CapturedAt: now}
		r, err = p.Run(context.Background(), []Observation{obs}, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Evaluations) != 1 || r.Evaluations[0].HorizonHours != c.h {
			t.Fatalf("h=%d result=%+v", c.h, r)
		}
	}
	portfolio, err := store.Portfolio(context.Background(), 300000)
	if err != nil {
		t.Fatal(err)
	}
	if portfolio.LockedCapital != 0 || portfolio.OpenTrades != 0 || portfolio.AvailableCash != 303000 {
		t.Fatalf("portfolio=%+v", portfolio)
	}
}

func TestResolverRejectsAmbiguousOrNonApple(t *testing.T) {
	for _, o := range []Observation{{Title: "Apple iPad", Condition: "used"}, {Title: "Apple iPad 128GB", Condition: "new"}, {Title: "Nintendo Switch", Condition: "new", Model: "HAC", Capacity: "32GB"}} {
		if _, err := Resolve(o); err == nil {
			t.Fatalf("expected reject: %+v", o)
		}
	}
}
