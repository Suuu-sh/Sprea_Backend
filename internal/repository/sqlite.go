package repository

import (
	"context"
	"database/sql"
	"errors"
	"github.com/Suuu-sh/Sprea_Backend/internal/domain"
	_ "modernc.org/sqlite"
)

type SQLite struct{ db *sql.DB }

func NewSQLite(path string) (*SQLite, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS opportunities (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
		source TEXT NOT NULL, buyer TEXT NOT NULL, image_url TEXT NOT NULL,
		purchase_price INTEGER NOT NULL, buyback_price INTEGER NOT NULL,
		base_point_rate INTEGER NOT NULL, updated_at TEXT NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS price_history (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, purchase_price INTEGER NOT NULL, buyback_price INTEGER NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
	CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, point_adjustment INTEGER NOT NULL DEFAULT 0, minimum_profit INTEGER NOT NULL DEFAULT 1000, minimum_profit_rate REAL NOT NULL DEFAULT 3);
	CREATE TABLE IF NOT EXISTS alert_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL, minimum_profit INTEGER NOT NULL, minimum_profit_rate REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &SQLite{db: db}, nil
}

func (s *SQLite) RecordSnapshots(ctx context.Context, items []domain.Opportunity) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, o := range items {
		if _, err = tx.ExecContext(ctx, `INSERT INTO price_history(opportunity_id,purchase_price,buyback_price) VALUES(?,?,?)`, o.ID, o.PurchasePrice, o.BuybackPrice); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *SQLite) History(ctx context.Context, id int64, limit int) ([]domain.PriceSnapshot, error) {
	if limit < 1 || limit > 365 {
		limit = 30
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,opportunity_id,purchase_price,buyback_price,captured_at FROM price_history WHERE opportunity_id=? ORDER BY id DESC LIMIT ?`, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PriceSnapshot
	for rows.Next() {
		var x domain.PriceSnapshot
		if err := rows.Scan(&x.ID, &x.OpportunityID, &x.PurchasePrice, &x.BuybackPrice, &x.CapturedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *SQLite) GetSettings(ctx context.Context, user string) (domain.UserSettings, error) {
	var x domain.UserSettings
	err := s.db.QueryRowContext(ctx, `SELECT user_id,point_adjustment,minimum_profit,minimum_profit_rate FROM user_settings WHERE user_id=?`, user).Scan(&x.UserID, &x.PointAdjustment, &x.MinimumProfit, &x.MinimumProfitRate)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserSettings{UserID: user, MinimumProfit: 1000, MinimumProfitRate: 3}, nil
	}
	return x, err
}
func (s *SQLite) SaveSettings(ctx context.Context, x domain.UserSettings) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO user_settings(user_id,point_adjustment,minimum_profit,minimum_profit_rate) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET point_adjustment=excluded.point_adjustment,minimum_profit=excluded.minimum_profit,minimum_profit_rate=excluded.minimum_profit_rate`, x.UserID, x.PointAdjustment, x.MinimumProfit, x.MinimumProfitRate)
	return err
}
func (s *SQLite) ListAlerts(ctx context.Context, user string) ([]domain.AlertRule, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,user_id,name,minimum_profit,minimum_profit_rate,enabled FROM alert_rules WHERE user_id=? ORDER BY id DESC`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AlertRule
	for rows.Next() {
		var x domain.AlertRule
		if err := rows.Scan(&x.ID, &x.UserID, &x.Name, &x.MinimumProfit, &x.MinimumProfitRate, &x.Enabled); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *SQLite) CreateAlert(ctx context.Context, x domain.AlertRule) (domain.AlertRule, error) {
	r, err := s.db.ExecContext(ctx, `INSERT INTO alert_rules(user_id,name,minimum_profit,minimum_profit_rate,enabled) VALUES(?,?,?,?,?)`, x.UserID, x.Name, x.MinimumProfit, x.MinimumProfitRate, x.Enabled)
	if err != nil {
		return x, err
	}
	x.ID, _ = r.LastInsertId()
	return x, nil
}

func (s *SQLite) Close() error { return s.db.Close() }

func (s *SQLite) List(ctx context.Context) ([]domain.Opportunity, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,updated_at FROM opportunities ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []domain.Opportunity
	for rows.Next() {
		var o domain.Opportunity
		if err := rows.Scan(&o.ID, &o.Name, &o.Category, &o.Source, &o.Buyer, &o.ImageURL, &o.PurchasePrice, &o.BuybackPrice, &o.BasePointRate, &o.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

func (s *SQLite) Find(ctx context.Context, id int64) (domain.Opportunity, error) {
	var o domain.Opportunity
	err := s.db.QueryRowContext(ctx, `SELECT id,name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,updated_at FROM opportunities WHERE id=?`, id).
		Scan(&o.ID, &o.Name, &o.Category, &o.Source, &o.Buyer, &o.ImageURL, &o.PurchasePrice, &o.BuybackPrice, &o.BasePointRate, &o.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return o, sql.ErrNoRows
	}
	return o, err
}

func (s *SQLite) SaveAll(ctx context.Context, items []domain.Opportunity) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, o := range items {
		_, err = tx.ExecContext(ctx, `INSERT INTO opportunities(name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, o.Name, o.Category, o.Source, o.Buyer, o.ImageURL, o.PurchasePrice, o.BuybackPrice, o.BasePointRate, o.UpdatedAt)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLite) ReplaceAll(ctx context.Context, items []domain.Opportunity) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "DELETE FROM opportunities"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM sqlite_sequence WHERE name='opportunities'"); err != nil {
		return err
	}
	for _, o := range items {
		_, err = tx.ExecContext(ctx, `INSERT INTO opportunities(name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, o.Name, o.Category, o.Source, o.Buyer, o.ImageURL, o.PurchasePrice, o.BuybackPrice, o.BasePointRate, o.UpdatedAt)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
