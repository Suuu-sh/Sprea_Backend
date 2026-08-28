PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jan TEXT, model_number TEXT NOT NULL, capacity_gb INTEGER NOT NULL,
  name TEXT NOT NULL, condition TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL,
  UNIQUE(model_number, capacity_gb, condition)
);
CREATE TABLE source_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
  source TEXT NOT NULL, external_id TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  title TEXT NOT NULL, raw_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES products(id), UNIQUE(source, external_id)
);
CREATE TABLE price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL,
  price_yen INTEGER NOT NULL CHECK(price_yen >= 0), shipping_yen INTEGER NOT NULL DEFAULT 0,
  fee_yen INTEGER NOT NULL DEFAULT 0, reward_yen INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 1, captured_at TEXT NOT NULL,
  FOREIGN KEY(listing_id) REFERENCES source_listings(id), UNIQUE(listing_id, captured_at)
);
CREATE INDEX idx_snapshots_listing_time ON price_snapshots(listing_id, captured_at DESC);
CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, buy_snapshot_id INTEGER NOT NULL,
  sell_snapshot_id INTEGER NOT NULL, buy_cost_yen INTEGER NOT NULL, expected_revenue_yen INTEGER NOT NULL,
  market_profit_yen INTEGER NOT NULL, resolver_confidence REAL NOT NULL, features_json TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('BUY','SKIP')), detected_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE paper_accounts (
  id INTEGER PRIMARY KEY CHECK(id=1), initial_cash_yen INTEGER NOT NULL,
  available_cash_yen INTEGER NOT NULL, reserved_cash_yen INTEGER NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO paper_accounts VALUES(1,300000,300000,0,datetime('now'));
CREATE TABLE paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 1, reserved_yen INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
  opened_at TEXT NOT NULL, closed_at TEXT, FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, trade_id INTEGER,
  horizon_hours INTEGER NOT NULL CHECK(horizon_hours IN (24,48,72,168)), sell_snapshot_id INTEGER,
  realized_profit_yen INTEGER, outcome TEXT CHECK(outcome IN ('buy_correct','buy_failed','skip_correct','missed_opportunity')),
  evaluated_at TEXT NOT NULL, FOREIGN KEY(opportunity_id) REFERENCES opportunities(id),
  UNIQUE(opportunity_id, horizon_hours)
);
CREATE TABLE model_runs (
  version TEXT PRIMARY KEY, status TEXT NOT NULL, artifact_key TEXT NOT NULL,
  metrics_json TEXT NOT NULL, created_at TEXT NOT NULL, promoted_at TEXT
);
CREATE TABLE model_pointer (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL, updated_at TEXT NOT NULL);
