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
	CREATE TABLE IF NOT EXISTS paper_trades (
	 id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL, title TEXT NOT NULL, purchase_source TEXT NOT NULL,
	 buyback_source TEXT NOT NULL, purchase_price INTEGER NOT NULL, locked_capital INTEGER NOT NULL,
	 entry_buyback_price INTEGER NOT NULL, entry_profit INTEGER NOT NULL, opened_at TEXT NOT NULL,
	 closed_at TEXT, status TEXT NOT NULL DEFAULT 'open');
	CREATE UNIQUE INDEX IF NOT EXISTS one_open_trade_per_product ON paper_trades(canonical_key) WHERE status='open';
	CREATE TABLE IF NOT EXISTS trade_evaluations (
	 trade_id INTEGER NOT NULL, horizon_hours INTEGER NOT NULL, buyback_price INTEGER NOT NULL,
	 profit INTEGER NOT NULL, target_met INTEGER NOT NULL, evaluated_at TEXT NOT NULL,
	 PRIMARY KEY(trade_id,horizon_hours));`)
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
	}
	return tx.Commit()
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
	rows, err := s.db.QueryContext(ctx, `SELECT id,canonical_key,locked_capital,opened_at FROM paper_trades WHERE status='open'`)
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
		for _, h := range []int{24, 48, 72} {
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
