CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  minimum_profit INTEGER NOT NULL DEFAULT 0,
  minimum_profit_rate REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS alert_rules_user_idx ON alert_rules(user_id, id DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  alert_rule_id INTEGER NOT NULL,
  opportunity_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(alert_rule_id, opportunity_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS notification_outbox_user_idx ON notification_outbox(user_id, id DESC);

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
CREATE INDEX IF NOT EXISTS collector_runs_finished_idx ON collector_runs(id DESC);
