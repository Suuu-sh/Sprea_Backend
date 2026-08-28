package research

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type ProductHistoryPoint struct {
	Source      string    `json:"source"`
	Side        Side      `json:"side"`
	Price       int       `json:"price"`
	Stock       bool      `json:"stock"`
	CapturedAt  time.Time `json:"capturedAt"`
	Confidence  float64   `json:"confidence"`
	MatchReason string    `json:"matchReason"`
}
type ProductDetail struct {
	CanonicalKey string                `json:"canonicalKey"`
	Title        string                `json:"title"`
	JAN          string                `json:"jan"`
	Model        string                `json:"model"`
	Capacity     string                `json:"capacity"`
	Color        string                `json:"color"`
	History      []ProductHistoryPoint `json:"history"`
	Decisions    []ResearchDecision    `json:"decisions"`
	Evaluations  []Evaluation          `json:"evaluations"`
}
type ResearchSettings struct {
	InitialCapital    int     `json:"initialCapital"`
	MinimumProfit     int     `json:"minimumProfit"`
	MinimumConfidence float64 `json:"minimumConfidence"`
	SaleShipping      int     `json:"saleShipping"`
	Fees              int     `json:"fees"`
	EvaluationHours   []int   `json:"evaluationHours"`
}
type EvaluationSchedule struct {
	DecisionID   int64     `json:"decisionId"`
	CanonicalKey string    `json:"canonicalKey"`
	Title        string    `json:"title"`
	HorizonHours int       `json:"horizonHours"`
	DueAt        time.Time `json:"dueAt"`
	Status       string    `json:"status"`
	Outcome      string    `json:"outcome,omitempty"`
	Profit       int       `json:"profit,omitempty"`
}
type EvaluatorRun struct {
	ID             int64     `json:"id"`
	Trigger        string    `json:"trigger"`
	Status         string    `json:"status"`
	EvaluatedCount int       `json:"evaluatedCount"`
	Message        string    `json:"message"`
	StartedAt      time.Time `json:"startedAt"`
	FinishedAt     time.Time `json:"finishedAt"`
}

func (s *Store) GetProductDetail(ctx context.Context, key string) (ProductDetail, error) {
	d := ProductDetail{CanonicalKey: key, History: []ProductHistoryPoint{}, Decisions: []ResearchDecision{}, Evaluations: []Evaluation{}}
	rows, err := s.db.QueryContext(ctx, `SELECT source,side,price,stock,captured_at,resolver_confidence,match_reason,title,jan,model,capacity,color FROM research_observations WHERE canonical_key=? ORDER BY captured_at`, key)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var p ProductHistoryPoint
		var raw, title, jan, model, cap, color string
		if err := rows.Scan(&p.Source, &p.Side, &p.Price, &p.Stock, &raw, &p.Confidence, &p.MatchReason, &title, &jan, &model, &cap, &color); err != nil {
			return d, err
		}
		p.CapturedAt, _ = time.Parse(time.RFC3339Nano, raw)
		d.History = append(d.History, p)
		if d.Title == "" {
			d.Title, d.JAN, d.Model, d.Capacity, d.Color = title, jan, model, cap, color
		}
	}
	if d.Title == "" {
		return d, sql.ErrNoRows
	}
	dr, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,title,decision,reason,strategy,purchase_price,purchase_shipping,sale_shipping,fees,entry_profit,sprea_score,decided_at FROM research_decisions WHERE canonical_key=? ORDER BY decided_at`, key)
	if err != nil {
		return d, err
	}
	defer dr.Close()
	ids := map[int64]bool{}
	for dr.Next() {
		var x ResearchDecision
		var raw string
		if err := dr.Scan(&x.ID, &x.CanonicalKey, &x.Title, &x.Decision, &x.Reason, &x.Strategy, &x.PurchasePrice, &x.PurchaseShipping, &x.SaleShipping, &x.Fees, &x.EntryProfit, &x.SpreaScore, &raw); err != nil {
			return d, err
		}
		x.DecidedAt, _ = time.Parse(time.RFC3339Nano, raw)
		d.Decisions = append(d.Decisions, x)
		ids[x.ID] = true
	}
	ev, err := s.ListDecisionEvaluations(ctx, 500)
	if err != nil {
		return d, err
	}
	for _, x := range ev {
		if ids[x.DecisionID] {
			d.Evaluations = append(d.Evaluations, x)
		}
	}
	return d, nil
}

func defaultResearchSettings() ResearchSettings {
	return ResearchSettings{300000, 5000, .95, 1000, 0, []int{24, 48, 72, 168}}
}
func (s *Store) GetResearchSettings(ctx context.Context) (ResearchSettings, error) {
	x := defaultResearchSettings()
	var hours string
	err := s.db.QueryRowContext(ctx, `SELECT initial_capital,minimum_profit,minimum_confidence,sale_shipping,fees,evaluation_hours FROM research_settings WHERE id=1`).Scan(&x.InitialCapital, &x.MinimumProfit, &x.MinimumConfidence, &x.SaleShipping, &x.Fees, &hours)
	if errors.Is(err, sql.ErrNoRows) {
		return x, nil
	}
	if err != nil {
		return x, err
	}
	x.EvaluationHours = []int{}
	for _, h := range []int{24, 48, 72, 168} {
		if containsCSVInt(hours, h) {
			x.EvaluationHours = append(x.EvaluationHours, h)
		}
	}
	return x, nil
}
func containsCSVInt(s string, n int) bool {
	needle := fmt.Sprintf(",%d,", n)
	return len(s) > 0 && contains(","+s+",", needle)
}
func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
func (s *Store) SaveResearchSettings(ctx context.Context, x ResearchSettings) (ResearchSettings, error) {
	if x.InitialCapital <= 0 || x.MinimumProfit < 0 || x.MinimumConfidence < .5 || x.MinimumConfidence > 1 || x.SaleShipping < 0 || x.Fees < 0 {
		return x, fmt.Errorf("invalid settings")
	}
	hours := ""
	for i, h := range x.EvaluationHours {
		if h != 24 && h != 48 && h != 72 && h != 168 {
			return x, fmt.Errorf("invalid evaluation hours")
		}
		if i > 0 {
			hours += ","
		}
		hours += fmt.Sprint(h)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO research_settings(id,initial_capital,minimum_profit,minimum_confidence,sale_shipping,fees,evaluation_hours) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET initial_capital=excluded.initial_capital,minimum_profit=excluded.minimum_profit,minimum_confidence=excluded.minimum_confidence,sale_shipping=excluded.sale_shipping,fees=excluded.fees,evaluation_hours=excluded.evaluation_hours`, x.InitialCapital, x.MinimumProfit, x.MinimumConfidence, x.SaleShipping, x.Fees, hours)
	return x, err
}

func (s *Store) ListPaperTrades(ctx context.Context) ([]PaperTrade, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,title,purchase_source,buyback_source,purchase_price,locked_capital,entry_buyback_price,entry_profit,opened_at,closed_at,status FROM paper_trades ORDER BY opened_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PaperTrade{}
	for rows.Next() {
		var x PaperTrade
		var opened string
		var closed sql.NullString
		if err := rows.Scan(&x.ID, &x.CanonicalKey, &x.Title, &x.PurchaseSource, &x.BuybackSource, &x.PurchasePrice, &x.LockedCapital, &x.EntryBuybackPrice, &x.EntryProfit, &opened, &closed, &x.Status); err != nil {
			return nil, err
		}
		x.OpenedAt, _ = time.Parse(time.RFC3339Nano, opened)
		if closed.Valid {
			t, _ := time.Parse(time.RFC3339Nano, closed.String)
			x.ClosedAt = &t
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *Store) ClosePaperTrade(ctx context.Context, id int64, at time.Time) (PaperTrade, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE paper_trades SET status='closed',closed_at=? WHERE id=? AND status='open'`, at.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return PaperTrade{}, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return PaperTrade{}, sql.ErrNoRows
	}
	items, err := s.ListPaperTrades(ctx)
	if err != nil {
		return PaperTrade{}, err
	}
	for _, x := range items {
		if x.ID == id {
			return x, nil
		}
	}
	return PaperTrade{}, sql.ErrNoRows
}

func (s *Store) EvaluationSchedules(ctx context.Context) ([]EvaluationSchedule, error) {
	settings, err := s.GetResearchSettings(ctx)
	if err != nil {
		return nil, err
	}
	enabled := map[int]bool{}
	for _, h := range settings.EvaluationHours {
		enabled[h] = true
	}
	rows, err := s.db.QueryContext(ctx, `SELECT d.id,d.canonical_key,d.title,h.hours,datetime(d.decided_at,'+'||h.hours||' hours'),CASE WHEN e.decision_id IS NULL THEN 'pending' ELSE 'completed' END,COALESCE(e.outcome,''),COALESCE(e.profit,0) FROM research_decisions d CROSS JOIN (SELECT 24 hours UNION ALL SELECT 48 UNION ALL SELECT 72 UNION ALL SELECT 168) h LEFT JOIN decision_evaluations e ON e.decision_id=d.id AND e.horizon_hours=h.hours ORDER BY 5`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EvaluationSchedule{}
	for rows.Next() {
		var x EvaluationSchedule
		var raw string
		if err := rows.Scan(&x.DecisionID, &x.CanonicalKey, &x.Title, &x.HorizonHours, &raw, &x.Status, &x.Outcome, &x.Profit); err != nil {
			return nil, err
		}
		x.DueAt, _ = time.Parse("2006-01-02 15:04:05", raw)
		if !enabled[x.HorizonHours] {
			continue
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *Store) RunEvaluator(ctx context.Context, trigger string, now time.Time) (EvaluatorRun, error) {
	x := EvaluatorRun{Trigger: trigger, Status: "running", StartedAt: time.Now().UTC()}
	res, err := s.db.ExecContext(ctx, `INSERT INTO evaluator_runs(trigger,status,evaluated_count,message,started_at,finished_at) VALUES(?,?,?,?,?,?)`, trigger, x.Status, 0, "", x.StartedAt.Format(time.RFC3339Nano), x.StartedAt.Format(time.RFC3339Nano))
	if err != nil {
		return x, err
	}
	x.ID, _ = res.LastInsertId()
	settings, settingsErr := s.GetResearchSettings(ctx)
	if settingsErr != nil {
		return x, settingsErr
	}
	a, e1 := s.EvaluateDue(ctx, now, settings.SaleShipping, settings.Fees, settings.MinimumProfit)
	b, e2 := s.EvaluateDecisions(ctx, now, settings.MinimumProfit)
	x.EvaluatedCount = len(a) + len(b)
	x.FinishedAt = time.Now().UTC()
	if e1 != nil || e2 != nil {
		x.Status = "failed"
		x.Message = fmt.Sprint(e1, e2)
	} else {
		x.Status = "succeeded"
	}
	_, err = s.db.ExecContext(ctx, `UPDATE evaluator_runs SET status=?,evaluated_count=?,message=?,finished_at=? WHERE id=?`, x.Status, x.EvaluatedCount, x.Message, x.FinishedAt.Format(time.RFC3339Nano), x.ID)
	return x, err
}
func (s *Store) ListEvaluatorRuns(ctx context.Context) ([]EvaluatorRun, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,trigger,status,evaluated_count,message,started_at,finished_at FROM evaluator_runs ORDER BY id DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EvaluatorRun{}
	for rows.Next() {
		var x EvaluatorRun
		var a, b string
		if err := rows.Scan(&x.ID, &x.Trigger, &x.Status, &x.EvaluatedCount, &x.Message, &a, &b); err != nil {
			return nil, err
		}
		x.StartedAt, _ = time.Parse(time.RFC3339Nano, a)
		x.FinishedAt, _ = time.Parse(time.RFC3339Nano, b)
		out = append(out, x)
	}
	return out, rows.Err()
}
