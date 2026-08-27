CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  buyer TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
  buyback_price INTEGER NOT NULL CHECK (buyback_price >= 0),
  base_point_rate INTEGER NOT NULL DEFAULT 0 CHECK (base_point_rate BETWEEN 0 AND 100),
  product_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS opportunities_updated_at_idx ON opportunities(updated_at DESC);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  purchase_price INTEGER NOT NULL,
  buyback_price INTEGER NOT NULL,
  base_point_rate INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS price_history_opportunity_idx
  ON price_history(opportunity_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  point_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (point_adjustment BETWEEN -20 AND 50),
  min_profit INTEGER NOT NULL DEFAULT 0,
  min_profit_rate REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
