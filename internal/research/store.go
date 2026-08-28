package research

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) migrate() error {
	_, err := s.db.Exec(`
	CREATE TABLE IF NOT EXISTS research_observations (
	 id INTEGER PRIMARY KEY, source TEXT NOT NULL, side TEXT NOT NULL, source_product_id TEXT NOT NULL,
	 title TEXT NOT NULL, price INTEGER NOT NULL, shipping INTEGER NOT NULL, stock INTEGER NOT NULL,
	 condition TEXT NOT NULL, jan TEXT NOT NULL, model TEXT NOT NULL, capacity TEXT NOT NULL, color TEXT NOT NULL,
	 captured_at TEXT NOT NULL, raw_json TEXT NOT NULL, canonical_key TEXT NOT NULL, resolver_confidence REAL NOT NULL,
	 match_reason TEXT NOT NULL, UNIQUE(source,side,source_product_id,captured_at));
	CREATE INDEX IF NOT EXISTS research_observations_product_time ON research_observations(canonical_key,captured_at);
	CREATE TABLE IF NOT EXISTS research_opportunities (
	 id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL, title TEXT NOT NULL, purchase_source TEXT NOT NULL,
	 buyback_source TEXT NOT NULL, purchase_price INTEGER NOT NULL, purchase_shipping INTEGER NOT NULL,
	 buyback_price INTEGER NOT NULL, sale_shipping INTEGER NOT NULL, fees INTEGER NOT NULL,
	 certain_rewards INTEGER NOT NULL, market_profit INTEGER NOT NULL, profit_rate REAL NOT NULL,
	 resolver_confidence REAL NOT NULL, detected_at TEXT NOT NULL,
	 UNIQUE(canonical_key,purchase_source,buyback_source,detected_at));
	CREATE TABLE IF NOT EXISTS opportunity_features (
	 canonical_key TEXT NOT NULL, detected_at TEXT NOT NULL, buyback_store_count INTEGER NOT NULL,
	 second_buyback_price INTEGER NOT NULL, top_two_spread_rate REAL NOT NULL, capital_days INTEGER NOT NULL,
	 annualized_return REAL NOT NULL, return_30_days REAL NOT NULL, sprea_score INTEGER NOT NULL,
	 PRIMARY KEY(canonical_key,detected_at));
	CREATE TABLE IF NOT EXISTS research_decisions (
	 id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL, title TEXT NOT NULL, decision TEXT NOT NULL,
	 reason TEXT NOT NULL, strategy TEXT NOT NULL, purchase_price INTEGER NOT NULL,
	 purchase_shipping INTEGER NOT NULL, sale_shipping INTEGER NOT NULL, fees INTEGER NOT NULL,
	 entry_profit INTEGER NOT NULL, sprea_score INTEGER NOT NULL, decided_at TEXT NOT NULL,
	 UNIQUE(canonical_key,strategy,decided_at));
	CREATE TABLE IF NOT EXISTS decision_evaluations (
	 decision_id INTEGER NOT NULL, horizon_hours INTEGER NOT NULL, buyback_price INTEGER NOT NULL,
	 profit INTEGER NOT NULL, target_met INTEGER NOT NULL, outcome TEXT NOT NULL, evaluated_at TEXT NOT NULL,
	 PRIMARY KEY(decision_id,horizon_hours));
	CREATE TABLE IF NOT EXISTS paper_trades (
	 id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL, title TEXT NOT NULL, purchase_source TEXT NOT NULL,
	 buyback_source TEXT NOT NULL, purchase_price INTEGER NOT NULL, locked_capital INTEGER NOT NULL,
	 entry_buyback_price INTEGER NOT NULL, entry_profit INTEGER NOT NULL, opened_at TEXT NOT NULL,
	 closed_at TEXT, status TEXT NOT NULL DEFAULT 'open');
	CREATE UNIQUE INDEX IF NOT EXISTS one_open_trade_per_product ON paper_trades(canonical_key) WHERE status='open';
	CREATE TABLE IF NOT EXISTS trade_evaluations (
	 trade_id INTEGER NOT NULL, horizon_hours INTEGER NOT NULL, buyback_price INTEGER NOT NULL,
	 profit INTEGER NOT NULL, target_met INTEGER NOT NULL, evaluated_at TEXT NOT NULL,
	 PRIMARY KEY(trade_id,horizon_hours));
	CREATE TABLE IF NOT EXISTS reality_calibrations (
	 id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL, purchase_source TEXT NOT NULL, buyback_source TEXT NOT NULL,
	 predicted_profit INTEGER NOT NULL, actual_purchase_price INTEGER NOT NULL, actual_payout INTEGER NOT NULL,
	 actual_costs INTEGER NOT NULL, actual_profit INTEGER NOT NULL, slippage INTEGER NOT NULL,
	 delivery_days REAL NOT NULL, reduction_reason TEXT NOT NULL, recorded_at TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS model_experiments (
	 id INTEGER PRIMARY KEY, name TEXT NOT NULL, candidate_version TEXT NOT NULL, baseline_version TEXT NOT NULL,
	 dataset_cutoff TEXT NOT NULL, precision REAL NOT NULL, recall REAL NOT NULL, average_profit REAL NOT NULL,
	 maximum_loss INTEGER NOT NULL, promoted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS source_policies (
	 source TEXT PRIMARY KEY, method TEXT NOT NULL, terms_url TEXT NOT NULL, robots_url TEXT NOT NULL,
	 status TEXT NOT NULL, reviewed_at TEXT NOT NULL, notes TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS mock_market_clock (id INTEGER PRIMARY KEY CHECK(id=1), current_at TEXT NOT NULL, elapsed_hours INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS mock_market_control (id INTEGER PRIMARY KEY CHECK(id=1), scenario TEXT NOT NULL DEFAULT 'stable', auto_advance INTEGER NOT NULL DEFAULT 0);
	CREATE TABLE IF NOT EXISTS research_settings (id INTEGER PRIMARY KEY CHECK(id=1), initial_capital INTEGER NOT NULL, minimum_profit INTEGER NOT NULL, minimum_confidence REAL NOT NULL, sale_shipping INTEGER NOT NULL, fees INTEGER NOT NULL, evaluation_hours TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS evaluator_runs (id INTEGER PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, evaluated_count INTEGER NOT NULL, message TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL);
	INSERT OR IGNORE INTO mock_market_control(id,scenario,auto_advance) VALUES(1,'stable',0);`)
	return err
}

func (s *Store) SaveObservations(ctx context.Context, items []ResolvedObservation) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, x := range items {
		raw, _ := json.Marshal(x.Raw)
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO research_observations(source,side,source_product_id,title,price,shipping,stock,condition,jan,model,capacity,color,captured_at,raw_json,canonical_key,resolver_confidence,match_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, x.Source, x.Side, x.SourceProductID, x.Title, x.Price, x.Shipping, x.Stock, x.Condition, x.JAN, x.Model, x.Capacity, x.Color, x.CapturedAt.UTC().Format(time.RFC3339Nano), string(raw), x.CanonicalKey, x.Confidence, x.MatchReason)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) SaveOpportunities(ctx context.Context, items []Opportunity) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, x := range items {
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO research_opportunities(canonical_key,title,purchase_source,buyback_source,purchase_price,purchase_shipping,buyback_price,sale_shipping,fees,certain_rewards,market_profit,profit_rate,resolver_confidence,detected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, x.CanonicalKey, x.Title, x.PurchaseSource, x.BuybackSource, x.PurchasePrice, x.PurchaseShipping, x.BuybackPrice, x.SaleShipping, x.Fees, x.CertainRewards, x.MarketProfit, x.ProfitRate, x.ResolverConfidence, x.DetectedAt.UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO opportunity_features(canonical_key,detected_at,buyback_store_count,second_buyback_price,top_two_spread_rate,capital_days,annualized_return,return_30_days,sprea_score) VALUES(?,?,?,?,?,?,?,?,?)`, x.CanonicalKey, x.DetectedAt.UTC().Format(time.RFC3339Nano), x.BuybackStoreCount, x.SecondBuybackPrice, x.TopTwoSpreadRate, x.CapitalDays, x.AnnualizedReturn, x.Return30Days, x.SpreaScore)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) SaveDecisions(ctx context.Context, opportunities []Opportunity, minProfit int, minConfidence float64) ([]ResearchDecision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := make([]ResearchDecision, 0, len(opportunities))
	for _, o := range opportunities {
		d := DecisionSkip
		reason := "profit below baseline"
		if o.ResolverConfidence < minConfidence {
			reason = "resolver confidence below baseline"
		} else if o.MarketProfit >= minProfit {
			d = DecisionBuy
			reason = "rule baseline passed"
		}
		res, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO research_decisions(canonical_key,title,decision,reason,strategy,purchase_price,purchase_shipping,sale_shipping,fees,entry_profit,sprea_score,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, o.CanonicalKey, o.Title, d, reason, "rule-v1", o.PurchasePrice, o.PurchaseShipping, o.SaleShipping, o.Fees, o.MarketProfit, o.SpreaScore, o.DetectedAt.UTC().Format(time.RFC3339Nano))
		if e != nil {
			return nil, e
		}
		id, _ := res.LastInsertId()
		n, _ := res.RowsAffected()
		if n > 0 {
			out = append(out, ResearchDecision{ID: id, CanonicalKey: o.CanonicalKey, Title: o.Title, Decision: d, Reason: reason, Strategy: "rule-v1", PurchasePrice: o.PurchasePrice, PurchaseShipping: o.PurchaseShipping, SaleShipping: o.SaleShipping, Fees: o.Fees, EntryProfit: o.MarketProfit, SpreaScore: o.SpreaScore, DecidedAt: o.DetectedAt})
		}
	}
	return out, tx.Commit()
}

func (s *Store) EvaluateDecisions(ctx context.Context, now time.Time, targetProfit int) ([]Evaluation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,decision,purchase_price,purchase_shipping,sale_shipping,fees,decided_at FROM research_decisions`)
	if err != nil {
		return nil, err
	}
	type row struct {
		id                                     int64
		key, decision                          string
		purchase, shipping, saleShipping, fees int
		decided                                string
	}
	var decisions []row
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.id, &x.key, &x.decision, &x.purchase, &x.shipping, &x.saleShipping, &x.fees, &x.decided); err != nil {
			rows.Close()
			return nil, err
		}
		decisions = append(decisions, x)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := []Evaluation{}
	for _, d := range decisions {
		decided, e := time.Parse(time.RFC3339Nano, d.decided)
		if e != nil {
			return nil, e
		}
		for _, h := range []int{24, 48, 72, 168} {
			due := decided.Add(time.Duration(h) * time.Hour)
			if now.Before(due) {
				continue
			}
			var price int
			var captured string
			e = tx.QueryRowContext(ctx, `SELECT price,captured_at FROM research_observations WHERE canonical_key=? AND side=? AND stock=1 AND captured_at>=? AND captured_at<=? ORDER BY captured_at LIMIT 1`, d.key, Buyback, due.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano)).Scan(&price, &captured)
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			if e != nil {
				return nil, e
			}
			profit := price - d.saleShipping - d.fees - d.purchase - d.shipping
			met := profit >= targetProfit
			outcome := "skip_correct"
			if d.decision == string(DecisionBuy) && met {
				outcome = "buy_correct"
			} else if d.decision == string(DecisionBuy) {
				outcome = "buy_failed"
			} else if met {
				outcome = "missed_opportunity"
			}
			evaluated, _ := time.Parse(time.RFC3339Nano, captured)
			res, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO decision_evaluations(decision_id,horizon_hours,buyback_price,profit,target_met,outcome,evaluated_at) VALUES(?,?,?,?,?,?,?)`, d.id, h, price, profit, met, outcome, evaluated.UTC().Format(time.RFC3339Nano))
			if e != nil {
				return nil, e
			}
			n, _ := res.RowsAffected()
			if n > 0 {
				out = append(out, Evaluation{DecisionID: d.id, HorizonHours: h, BuybackPrice: price, Profit: profit, TargetMet: met, Outcome: outcome, EvaluatedAt: evaluated})
			}
		}
	}
	return out, tx.Commit()
}

func (s *Store) StrategyMetrics(ctx context.Context, strategy string, horizon int) (StrategyMetrics, error) {
	m := StrategyMetrics{Strategy: strategy, HorizonHours: horizon}
	var correctBuys, opportunities, totalProfit int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN d.decision='buy' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN d.decision='buy' AND e.target_met=1 THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN e.target_met=1 THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN e.outcome='missed_opportunity' THEN 1 ELSE 0 END),0),COALESCE(SUM(e.profit),0),COALESCE(MIN(e.profit),0) FROM research_decisions d JOIN decision_evaluations e ON e.decision_id=d.id WHERE d.strategy=? AND e.horizon_hours=?`, strategy, horizon).Scan(&m.Evaluated, &m.BuyCount, &correctBuys, &opportunities, &m.MissedOpportunities, &totalProfit, &m.MaximumLoss)
	if err != nil {
		return m, err
	}
	if m.BuyCount > 0 {
		m.Precision = float64(correctBuys) / float64(m.BuyCount)
	}
	if opportunities > 0 {
		m.Recall = float64(correctBuys) / float64(opportunities)
	}
	if m.Evaluated > 0 {
		m.AverageProfit = float64(totalProfit) / float64(m.Evaluated)
	}
	return m, nil
}

func (s *Store) RecordRealityCalibration(ctx context.Context, x RealityCalibration) (RealityCalibration, error) {
	x.ActualProfit = x.ActualPayout - x.ActualPurchasePrice - x.ActualCosts
	x.Slippage = x.ActualProfit - x.PredictedProfit
	if x.RecordedAt.IsZero() {
		x.RecordedAt = time.Now().UTC()
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO reality_calibrations(canonical_key,purchase_source,buyback_source,predicted_profit,actual_purchase_price,actual_payout,actual_costs,actual_profit,slippage,delivery_days,reduction_reason,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, x.CanonicalKey, x.PurchaseSource, x.BuybackSource, x.PredictedProfit, x.ActualPurchasePrice, x.ActualPayout, x.ActualCosts, x.ActualProfit, x.Slippage, x.DeliveryDays, x.ReductionReason, x.RecordedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return x, err
	}
	x.ID, _ = res.LastInsertId()
	return x, nil
}

// SaveModelExperiment only promotes a candidate when the caller's backtest
// beats the supplied baseline on the precision-first safety gates.
func (s *Store) SaveModelExperiment(ctx context.Context, x ModelExperiment, baseline StrategyMetrics) (ModelExperiment, error) {
	if x.CreatedAt.IsZero() {
		x.CreatedAt = time.Now().UTC()
	}
	x.Promoted = x.Precision > baseline.Precision && x.AverageProfit >= baseline.AverageProfit && x.MaximumLoss >= baseline.MaximumLoss
	res, err := s.db.ExecContext(ctx, `INSERT INTO model_experiments(name,candidate_version,baseline_version,dataset_cutoff,precision,recall,average_profit,maximum_loss,promoted,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, x.Name, x.CandidateVersion, x.BaselineVersion, x.DatasetCutoff.UTC().Format(time.RFC3339Nano), x.Precision, x.Recall, x.AverageProfit, x.MaximumLoss, x.Promoted, x.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return x, err
	}
	x.ID, _ = res.LastInsertId()
	return x, nil
}

func (s *Store) SaveSourcePolicy(ctx context.Context, x SourcePolicy) error {
	if x.ReviewedAt.IsZero() {
		return fmt.Errorf("reviewedAt is required")
	}
	switch x.Status {
	case "approved", "credential_required", "review_required", "manual_only", "blocked":
	default:
		return fmt.Errorf("invalid source policy status")
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO source_policies(source,method,terms_url,robots_url,status,reviewed_at,notes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET method=excluded.method,terms_url=excluded.terms_url,robots_url=excluded.robots_url,status=excluded.status,reviewed_at=excluded.reviewed_at,notes=excluded.notes`, x.Source, x.Method, x.TermsURL, x.RobotsURL, x.Status, x.ReviewedAt.UTC().Format(time.RFC3339Nano), x.Notes)
	return err
}

func (s *Store) SourceAllowed(ctx context.Context, source, method string) (bool, error) {
	var status, allowedMethod string
	err := s.db.QueryRowContext(ctx, `SELECT status,method FROM source_policies WHERE source=?`, source).Scan(&status, &allowedMethod)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "approved" && allowedMethod == method, nil
}

func (s *Store) LatestOpportunities(ctx context.Context, limit int) ([]Opportunity, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT o.canonical_key,o.title,o.purchase_source,o.buyback_source,o.purchase_price,o.purchase_shipping,o.buyback_price,o.sale_shipping,o.fees,o.certain_rewards,o.market_profit,o.profit_rate,o.resolver_confidence,o.detected_at,f.buyback_store_count,f.second_buyback_price,f.top_two_spread_rate,f.capital_days,f.annualized_return,f.return_30_days,f.sprea_score FROM research_opportunities o JOIN opportunity_features f ON f.canonical_key=o.canonical_key AND f.detected_at=o.detected_at JOIN (SELECT canonical_key,MAX(detected_at) detected_at FROM research_opportunities GROUP BY canonical_key) latest ON latest.canonical_key=o.canonical_key AND latest.detected_at=o.detected_at ORDER BY o.market_profit DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Opportunity{}
	for rows.Next() {
		var x Opportunity
		var detected string
		if err := rows.Scan(&x.CanonicalKey, &x.Title, &x.PurchaseSource, &x.BuybackSource, &x.PurchasePrice, &x.PurchaseShipping, &x.BuybackPrice, &x.SaleShipping, &x.Fees, &x.CertainRewards, &x.MarketProfit, &x.ProfitRate, &x.ResolverConfidence, &detected, &x.BuybackStoreCount, &x.SecondBuybackPrice, &x.TopTwoSpreadRate, &x.CapitalDays, &x.AnnualizedReturn, &x.Return30Days, &x.SpreaScore); err != nil {
			return nil, err
		}
		x.DetectedAt, _ = time.Parse(time.RFC3339Nano, detected)
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) LatestDecisions(ctx context.Context, limit int) ([]ResearchDecision, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,title,decision,reason,strategy,purchase_price,purchase_shipping,sale_shipping,fees,entry_profit,sprea_score,decided_at FROM research_decisions ORDER BY decided_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResearchDecision{}
	for rows.Next() {
		var x ResearchDecision
		var decided string
		if err := rows.Scan(&x.ID, &x.CanonicalKey, &x.Title, &x.Decision, &x.Reason, &x.Strategy, &x.PurchasePrice, &x.PurchaseShipping, &x.SaleShipping, &x.Fees, &x.EntryProfit, &x.SpreaScore, &decided); err != nil {
			return nil, err
		}
		x.DecidedAt, _ = time.Parse(time.RFC3339Nano, decided)
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) Dashboard(ctx context.Context) (Dashboard, error) {
	p, err := s.Portfolio(ctx, 300000)
	if err != nil {
		return Dashboard{}, err
	}
	o, err := s.LatestOpportunities(ctx, 100)
	if err != nil {
		return Dashboard{}, err
	}
	d, err := s.LatestDecisions(ctx, 100)
	if err != nil {
		return Dashboard{}, err
	}
	m, err := s.StrategyMetrics(ctx, "rule-v1", 48)
	if err != nil {
		return Dashboard{}, err
	}
	return Dashboard{Portfolio: p, Opportunities: o, Decisions: d, Metrics48h: m}, nil
}

func (s *Store) Portfolio(ctx context.Context, initial int) (Portfolio, error) {
	var locked, count, realized int
	err := s.db.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(CASE WHEN t.status='open' THEN t.locked_capital ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN t.status='open' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN t.status='closed' THEN e.profit ELSE 0 END),0)
		FROM paper_trades t LEFT JOIN trade_evaluations e ON e.trade_id=t.id AND e.horizon_hours=72`).Scan(&locked, &count, &realized)
	return Portfolio{InitialCapital: initial, LockedCapital: locked, AvailableCash: initial + realized - locked, OpenTrades: count}, err
}
func (s *Store) OpenTrades(ctx context.Context, opportunities []Opportunity, initial, minProfit int, minConfidence float64) ([]PaperTrade, error) {
	portfolio, err := s.Portfolio(ctx, initial)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	opened := []PaperTrade{}
	for _, o := range opportunities {
		capital := o.PurchasePrice + o.PurchaseShipping
		if o.MarketProfit < minProfit || o.ResolverConfidence < minConfidence || capital > portfolio.AvailableCash {
			continue
		}
		res, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO paper_trades(canonical_key,title,purchase_source,buyback_source,purchase_price,locked_capital,entry_buyback_price,entry_profit,opened_at) VALUES(?,?,?,?,?,?,?,?,?)`, o.CanonicalKey, o.Title, o.PurchaseSource, o.BuybackSource, o.PurchasePrice, capital, o.BuybackPrice, o.MarketProfit, o.DetectedAt.UTC().Format(time.RFC3339Nano))
		if e != nil {
			return nil, e
		}
		id, _ := res.LastInsertId()
		affected, _ := res.RowsAffected()
		if affected == 0 {
			continue
		}
		portfolio.AvailableCash -= capital
		opened = append(opened, PaperTrade{ID: id, CanonicalKey: o.CanonicalKey, Title: o.Title, PurchaseSource: o.PurchaseSource, BuybackSource: o.BuybackSource, PurchasePrice: o.PurchasePrice, LockedCapital: capital, EntryBuybackPrice: o.BuybackPrice, EntryProfit: o.MarketProfit, OpenedAt: o.DetectedAt, Status: "open"})
	}
	return opened, tx.Commit()
}

func (s *Store) EvaluateDue(ctx context.Context, now time.Time, saleShipping, fees, targetProfit int) ([]Evaluation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,locked_capital,opened_at FROM paper_trades`)
	if err != nil {
		return nil, err
	}
	type trade struct {
		id      int64
		key     string
		capital int
		opened  string
	}
	var trades []trade
	for rows.Next() {
		var t trade
		if err := rows.Scan(&t.id, &t.key, &t.capital, &t.opened); err != nil {
			rows.Close()
			return nil, err
		}
		trades = append(trades, t)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := []Evaluation{}
	for _, t := range trades {
		opened, e := time.Parse(time.RFC3339Nano, t.opened)
		if e != nil {
			return nil, e
		}
		for _, h := range []int{24, 48, 72, 168} {
			due := opened.Add(time.Duration(h) * time.Hour)
			if now.Before(due) {
				continue
			}
			var price int
			var captured string
			e = tx.QueryRowContext(ctx, `SELECT price,captured_at FROM research_observations WHERE canonical_key=? AND side=? AND stock=1 AND captured_at>=? AND captured_at<=? ORDER BY captured_at ASC LIMIT 1`, t.key, Buyback, due.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano)).Scan(&price, &captured)
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			if e != nil {
				return nil, e
			}
			profit := price - saleShipping - fees - t.capital
			evaluated, _ := time.Parse(time.RFC3339Nano, captured)
			met := profit >= targetProfit
			res, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO trade_evaluations(trade_id,horizon_hours,buyback_price,profit,target_met,evaluated_at) VALUES(?,?,?,?,?,?)`, t.id, h, price, profit, met, evaluated.UTC().Format(time.RFC3339Nano))
			if e != nil {
				return nil, e
			}
			n, _ := res.RowsAffected()
			if n > 0 {
				out = append(out, Evaluation{TradeID: t.id, HorizonHours: h, BuybackPrice: price, Profit: profit, TargetMet: met, EvaluatedAt: evaluated})
			}
		}
		if !now.Before(opened.Add(72 * time.Hour)) {
			var n int
			if e := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM trade_evaluations WHERE trade_id=? AND horizon_hours=72`, t.id).Scan(&n); e != nil {
				return nil, e
			}
			if n > 0 {
				if _, e := tx.ExecContext(ctx, `UPDATE paper_trades SET status='closed',closed_at=? WHERE id=?`, now.UTC().Format(time.RFC3339Nano), t.id); e != nil {
					return nil, e
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit evaluations: %w", err)
	}
	return out, nil
}
