package research

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type MockMarketStatus struct {
	CurrentAt    time.Time    `json:"currentAt"`
	ElapsedHours int          `json:"elapsedHours"`
	NextDueAt    *time.Time   `json:"nextDueAt,omitempty"`
	Evaluations  []Evaluation `json:"evaluations"`
	Scenario     string       `json:"scenario"`
	AutoAdvance  bool         `json:"autoAdvance"`
}

var mockBaseTime = time.Date(2026, 8, 27, 17, 0, 0, 0, time.UTC)

func MockObservations(at time.Time, elapsed int) []Observation {
	return mockObservationsForScenario(at, elapsed, "stable")
}

func mockObservationsForScenario(at time.Time, elapsed int, scenario string) []Observation {
	price := func(base int, drops ...int) int {
		v := base
		for i, h := range []int{24, 48, 72, 168} {
			if elapsed >= h {
				v = drops[i]
			}
		}
		return v
	}
	type product struct {
		jan, model, capacity, color, title string
		purchase, buybackA, buybackB       int
	}
	products := []product{
		{"4900000000001", "MG854J/A", "256GB", "Silver", "Apple iPhone 17 Pro 256GB Silver local mock", 178000, price(188000, 187000, 183000, 178000, 175000), price(186000, 185000, 181000, 177000, 174000)},
		{"4900000000002", "MCA14J/A", "128GB", "Blue", "Apple iPad Air 128GB Blue local mock", 85000, price(92000, 92500, 93000, 91500, 87000), price(90000, 91000, 92000, 90500, 86500)},
	}
	if scenario == "crash" {
		products[0].buybackA = price(188000, 176000, 168000, 160000, 150000)
		products[0].buybackB = price(186000, 174000, 166000, 158000, 149000)
	}
	if scenario == "recovery" {
		products[0].buybackA = price(188000, 174000, 181000, 190000, 192000)
		products[0].buybackB = price(186000, 172000, 179000, 188000, 190000)
	}
	if scenario == "top_store_loss" && elapsed >= 48 {
		products[0].buybackA = 0
	}
	if scenario == "stockout" && elapsed >= 24 {
		products[0].purchase = 0
	}
	out := make([]Observation, 0, 6)
	for i, p := range products {
		id := fmt.Sprintf("mock-%d", i+1)
		common := Observation{Title: p.title, Stock: true, Condition: "new", JAN: p.jan, Model: p.model, Capacity: p.capacity, Color: p.color, CapturedAt: at, Raw: map[string]any{"environment": "local", "scenarioStepHours": elapsed}}
		x := common
		x.Source = "LOCAL MOCK STORE"
		x.Side = Purchase
		x.SourceProductID = id + "-purchase"
		x.Price = p.purchase
		out = append(out, x)
		x = common
		x.Source = "LOCAL MOCK BUYBACK A"
		x.Side = Buyback
		x.SourceProductID = id + "-buyback-a"
		x.Price = p.buybackA
		out = append(out, x)
		x = common
		x.Source = "LOCAL MOCK BUYBACK B"
		x.Side = Buyback
		x.SourceProductID = id + "-buyback-b"
		x.Price = p.buybackB
		out = append(out, x)
	}
	return out
}

func (s *Store) AdvanceMockMarket(ctx context.Context, hours int) (MockMarketStatus, error) {
	if hours < 0 || hours > 168 {
		return MockMarketStatus{}, fmt.Errorf("hours must be between 0 and 168")
	}
	now, elapsed, err := s.MockClock(ctx)
	if err != nil {
		return MockMarketStatus{}, err
	}
	elapsed += hours
	now = now.Add(time.Duration(hours) * time.Hour)
	if _, err = s.db.ExecContext(ctx, `INSERT INTO mock_market_clock(id,current_at,elapsed_hours) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET current_at=excluded.current_at,elapsed_hours=excluded.elapsed_hours`, now.Format(time.RFC3339Nano), elapsed); err != nil {
		return MockMarketStatus{}, err
	}
	scenario, _, err := s.MockControl(ctx)
	if err != nil {
		return MockMarketStatus{}, err
	}
	settings, err := s.GetResearchSettings(ctx)
	if err != nil {
		return MockMarketStatus{}, err
	}
	p := Pipeline{Store: s, InitialCapital: settings.InitialCapital, MinimumProfit: settings.MinimumProfit, MinimumConfidence: settings.MinimumConfidence, SaleShipping: settings.SaleShipping, Fees: settings.Fees}
	if _, err = p.Run(ctx, mockObservationsForScenario(now, elapsed, scenario), now); err != nil {
		return MockMarketStatus{}, err
	}
	return s.MockMarketStatus(ctx)
}

func (s *Store) MockClock(ctx context.Context) (time.Time, int, error) {
	var raw string
	var elapsed int
	err := s.db.QueryRowContext(ctx, `SELECT current_at,elapsed_hours FROM mock_market_clock WHERE id=1`).Scan(&raw, &elapsed)
	if err == nil {
		t, e := time.Parse(time.RFC3339Nano, raw)
		return t, elapsed, e
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, 0, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO mock_market_clock(id,current_at,elapsed_hours) VALUES(1,?,0)`, mockBaseTime.Format(time.RFC3339Nano))
	return mockBaseTime, 0, err
}

func (s *Store) MockMarketStatus(ctx context.Context) (MockMarketStatus, error) {
	now, elapsed, err := s.MockClock(ctx)
	if err != nil {
		return MockMarketStatus{}, err
	}
	evaluations, err := s.ListDecisionEvaluations(ctx, 200)
	if err != nil {
		return MockMarketStatus{}, err
	}
	var raw string
	var next *time.Time
	if e := s.db.QueryRowContext(ctx, `SELECT MIN(datetime(d.decided_at,'+'||h.hours||' hours')) FROM research_decisions d CROSS JOIN (SELECT 24 hours UNION ALL SELECT 48 UNION ALL SELECT 72 UNION ALL SELECT 168) h LEFT JOIN decision_evaluations e ON e.decision_id=d.id AND e.horizon_hours=h.hours WHERE e.decision_id IS NULL`).Scan(&raw); e == nil && raw != "" {
		if t, e := time.Parse("2006-01-02 15:04:05", raw); e == nil {
			t = t.UTC()
			next = &t
		}
	}
	scenario, auto, err := s.MockControl(ctx)
	if err != nil {
		return MockMarketStatus{}, err
	}
	return MockMarketStatus{CurrentAt: now, ElapsedHours: elapsed, NextDueAt: next, Evaluations: evaluations, Scenario: scenario, AutoAdvance: auto}, nil
}

func (s *Store) MockControl(ctx context.Context) (string, bool, error) {
	var scenario string
	var auto bool
	err := s.db.QueryRowContext(ctx, `SELECT scenario,auto_advance FROM mock_market_control WHERE id=1`).Scan(&scenario, &auto)
	return scenario, auto, err
}
func (s *Store) ConfigureMockMarket(ctx context.Context, scenario string, auto bool) (MockMarketStatus, error) {
	switch scenario {
	case "stable", "crash", "recovery", "stockout", "top_store_loss":
	default:
		return MockMarketStatus{}, fmt.Errorf("invalid scenario")
	}
	_, err := s.db.ExecContext(ctx, `UPDATE mock_market_control SET scenario=?,auto_advance=? WHERE id=1`, scenario, auto)
	if err != nil {
		return MockMarketStatus{}, err
	}
	return s.MockMarketStatus(ctx)
}
func (s *Store) ResetMockMarket(ctx context.Context) (MockMarketStatus, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MockMarketStatus{}, err
	}
	defer tx.Rollback()
	for _, table := range []string{"decision_evaluations", "trade_evaluations", "paper_trades", "research_decisions", "opportunity_features", "research_opportunities", "research_observations"} {
		if _, err = tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return MockMarketStatus{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO mock_market_clock(id,current_at,elapsed_hours) VALUES(1,?,0) ON CONFLICT(id) DO UPDATE SET current_at=excluded.current_at,elapsed_hours=0`, mockBaseTime.Format(time.RFC3339Nano)); err != nil {
		return MockMarketStatus{}, err
	}
	if err = tx.Commit(); err != nil {
		return MockMarketStatus{}, err
	}
	return s.AdvanceMockMarket(ctx, 0)
}

func (s *Store) ListDecisionEvaluations(ctx context.Context, limit int) ([]Evaluation, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT decision_id,horizon_hours,buyback_price,profit,target_met,outcome,evaluated_at FROM decision_evaluations ORDER BY evaluated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Evaluation{}
	for rows.Next() {
		var x Evaluation
		var raw string
		if err := rows.Scan(&x.DecisionID, &x.HorizonHours, &x.BuybackPrice, &x.Profit, &x.TargetMet, &x.Outcome, &raw); err != nil {
			return nil, err
		}
		x.EvaluatedAt, _ = time.Parse(time.RFC3339Nano, raw)
		out = append(out, x)
	}
	return out, rows.Err()
}
