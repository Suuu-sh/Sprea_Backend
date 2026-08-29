PRAGMA foreign_keys = ON;

ALTER TABLE research_opportunities ADD COLUMN score_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE research_opportunities ADD COLUMN score_reason_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS research_opportunity_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES research_opportunities(id) ON DELETE CASCADE,
  horizon_hours INTEGER NOT NULL CHECK(horizon_hours IN (24,48,72,168)),
  evaluation_status TEXT NOT NULL CHECK(evaluation_status IN ('pending_data','completed')),
  retail_snapshot_id INTEGER REFERENCES research_price_snapshots(id),
  buyback_snapshot_id INTEGER REFERENCES research_price_snapshots(id),
  entry_market_profit_yen INTEGER NOT NULL,
  retail_price_yen INTEGER,
  buyback_price_yen INTEGER,
  market_profit_yen INTEGER,
  decay_yen INTEGER,
  decay_rate REAL,
  label_48h INTEGER CHECK(label_48h IN (0,1)),
  outcome TEXT CHECK(outcome IN ('buy_correct','buy_failed','skip_correct','missed_opportunity')),
  target_at TEXT NOT NULL,
  evaluated_at TEXT,
  checked_at TEXT NOT NULL,
  UNIQUE(opportunity_id, horizon_hours)
);
CREATE INDEX IF NOT EXISTS research_opportunity_evaluations_status_idx
  ON research_opportunity_evaluations(evaluation_status, target_at);
CREATE INDEX IF NOT EXISTS research_opportunities_score_idx
  ON research_opportunities(sprea_score DESC, market_profit_yen DESC, detected_at DESC);
