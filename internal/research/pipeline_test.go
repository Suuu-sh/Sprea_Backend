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
		if len(r.Evaluations) != 2 || r.Evaluations[0].HorizonHours != c.h || r.Evaluations[1].HorizonHours != c.h {
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

func TestSkipIsEvaluatedAsMissedOpportunity(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "skip.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	t0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	p := Pipeline{Store: store, InitialCapital: 300000, MinimumProfit: 5000, MinimumConfidence: .95}
	initial := []Observation{{Source: "sale", Side: Purchase, SourceProductID: "p", Title: "Apple iPad 128GB", Price: 100000, Stock: true, Condition: "new", Model: "A1", Capacity: "128GB", CapturedAt: t0}, {Source: "buyer", Side: Buyback, SourceProductID: "b", Title: "iPad 128GB", Price: 103000, Stock: true, Condition: "new", Model: "A1", Capacity: "128GB", CapturedAt: t0}}
	r, err := p.Run(context.Background(), initial, t0)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Decisions) != 1 || r.Decisions[0].Decision != DecisionSkip {
		t.Fatalf("decisions=%+v", r.Decisions)
	}
	check := Observation{Source: "buyer", Side: Buyback, SourceProductID: "b", Title: "iPad 128GB", Price: 108000, Stock: true, Condition: "new", Model: "A1", Capacity: "128GB", CapturedAt: t0.Add(48 * time.Hour)}
	r, err = p.Run(context.Background(), []Observation{check}, t0.Add(48*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range r.Evaluations {
		if e.DecisionID > 0 && e.HorizonHours == 48 && e.Outcome == "missed_opportunity" {
			found = true
		}
	}
	if !found {
		t.Fatalf("evaluations=%+v", r.Evaluations)
	}
	m, err := store.StrategyMetrics(context.Background(), "rule-v1", 48)
	if err != nil {
		t.Fatal(err)
	}
	if m.MissedOpportunities != 1 || m.Recall != 0 {
		t.Fatalf("metrics=%+v", m)
	}
}

func TestRealityCalibrationCalculatesSlippage(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "reality.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	x, err := store.RecordRealityCalibration(context.Background(), RealityCalibration{CanonicalKey: "apple:a1:128gb", PurchaseSource: "sale", BuybackSource: "buyer", PredictedProfit: 10000, ActualPurchasePrice: 100000, ActualPayout: 108000, ActualCosts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if x.ActualProfit != 7000 || x.Slippage != -3000 {
		t.Fatalf("calibration=%+v", x)
	}
}

func TestPromotionAndSourcePolicySafetyGates(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "gates.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	baseline := StrategyMetrics{Precision: .9, AverageProfit: 5000, MaximumLoss: -3000}
	x, err := store.SaveModelExperiment(ctx, ModelExperiment{Name: "lightgbm", CandidateVersion: "v2", BaselineVersion: "rule-v1", DatasetCutoff: time.Now(), Precision: .92, AverageProfit: 5200, MaximumLoss: -2500}, baseline)
	if err != nil || !x.Promoted {
		t.Fatalf("experiment=%+v err=%v", x, err)
	}
	if err := store.SaveSourcePolicy(ctx, SourcePolicy{Source: "apple-site", Method: "scrape", Status: "blocked", ReviewedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	allowed, err := store.SourceAllowed(ctx, "apple-site", "scrape")
	if err != nil || allowed {
		t.Fatalf("allowed=%v err=%v", allowed, err)
	}
	if err := store.SaveSourcePolicy(ctx, SourcePolicy{Source: "rakuten", Method: "official_api", Status: "approved", ReviewedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	allowed, err = store.SourceAllowed(ctx, "rakuten", "official_api")
	if err != nil || !allowed {
		t.Fatalf("allowed=%v err=%v", allowed, err)
	}
}

func TestResolverRejectsAmbiguousOrNonApple(t *testing.T) {
	for _, o := range []Observation{{Title: "Apple iPad", Condition: "used"}, {Title: "Apple iPad 128GB", Condition: "new"}, {Title: "Nintendo Switch", Condition: "new", Model: "HAC", Capacity: "32GB"}} {
		if _, err := Resolve(o); err == nil {
			t.Fatalf("expected reject: %+v", o)
		}
	}
}
