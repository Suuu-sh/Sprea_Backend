PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_key TEXT NOT NULL UNIQUE,
  gtin TEXT,
  manufacturer_part_number TEXT,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  capacity TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS canonical_products_gtin_idx ON canonical_products(gtin, condition) WHERE gtin IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS canonical_products_mpn_idx ON canonical_products(manufacturer_part_number, variant, condition) WHERE manufacturer_part_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product_id INTEGER NOT NULL REFERENCES canonical_products(id),
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('purchase','buyback')),
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  resolver_confidence REAL NOT NULL,
  match_reason TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS research_listings_product_idx ON research_listings(canonical_product_id, side);

CREATE TABLE IF NOT EXISTS latest_prices (
  listing_id INTEGER PRIMARY KEY REFERENCES research_listings(id) ON DELETE CASCADE,
  price_yen INTEGER NOT NULL CHECK(price_yen >= 0),
  shipping_yen INTEGER NOT NULL DEFAULT 0 CHECK(shipping_yen >= 0),
  fee_yen INTEGER NOT NULL DEFAULT 0 CHECK(fee_yen >= 0),
  reward_yen INTEGER NOT NULL DEFAULT 0 CHECK(reward_yen >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES research_listings(id) ON DELETE CASCADE,
  price_yen INTEGER NOT NULL,
  shipping_yen INTEGER NOT NULL,
  fee_yen INTEGER NOT NULL,
  reward_yen INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE(listing_id, captured_at)
);
CREATE INDEX IF NOT EXISTS research_snapshots_listing_time_idx ON research_price_snapshots(listing_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS research_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product_id INTEGER NOT NULL REFERENCES canonical_products(id),
  purchase_listing_id INTEGER NOT NULL REFERENCES research_listings(id),
  buyback_listing_id INTEGER NOT NULL REFERENCES research_listings(id),
  purchase_price_yen INTEGER NOT NULL,
  purchase_shipping_yen INTEGER NOT NULL,
  buyback_price_yen INTEGER NOT NULL,
  buy_cost_yen INTEGER NOT NULL,
  expected_revenue_yen INTEGER NOT NULL,
  market_profit_yen INTEGER NOT NULL,
  profit_rate REAL NOT NULL,
  buyback_store_count INTEGER NOT NULL,
  second_buyback_price_yen INTEGER,
  top_two_spread_rate REAL,
  resolver_confidence REAL NOT NULL,
  sprea_score REAL NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('BUY','SKIP')),
  reason TEXT NOT NULL,
  features_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS research_opportunities_detected_idx ON research_opportunities(detected_at DESC);

CREATE TABLE IF NOT EXISTS research_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  initial_capital_yen INTEGER NOT NULL,
  minimum_profit_yen INTEGER NOT NULL,
  minimum_confidence REAL NOT NULL,
  sale_shipping_yen INTEGER NOT NULL,
  fees_yen INTEGER NOT NULL,
  evaluation_hours_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO research_settings VALUES(1,300000,5000,0.95,0,0,'[24,48,72,168]',datetime('now'));

CREATE TABLE IF NOT EXISTS research_paper_accounts (
  id INTEGER PRIMARY KEY CHECK(id=1),
  initial_cash_yen INTEGER NOT NULL,
  available_cash_yen INTEGER NOT NULL,
  reserved_cash_yen INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO research_paper_accounts VALUES(1,300000,300000,0,datetime('now'));

CREATE TABLE IF NOT EXISTS research_paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL UNIQUE REFERENCES research_opportunities(id),
  reserved_yen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS research_trades_status_idx ON research_paper_trades(status, opened_at DESC);

CREATE TABLE IF NOT EXISTS research_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES research_opportunities(id),
  trade_id INTEGER REFERENCES research_paper_trades(id),
  horizon_hours INTEGER NOT NULL CHECK(horizon_hours IN (24,48,72,168)),
  buyback_snapshot_id INTEGER NOT NULL REFERENCES research_price_snapshots(id),
  buyback_price_yen INTEGER NOT NULL,
  profit_yen INTEGER NOT NULL,
  target_met INTEGER NOT NULL CHECK(target_met IN (0,1)),
  outcome TEXT NOT NULL CHECK(outcome IN ('buy_correct','buy_failed','skip_correct','missed_opportunity')),
  evaluated_at TEXT NOT NULL,
  UNIQUE(opportunity_id, horizon_hours)
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS collector_runs_id_idx ON collector_runs(id DESC);

CREATE TABLE IF NOT EXISTS evaluator_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  evaluated_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT ''
);
