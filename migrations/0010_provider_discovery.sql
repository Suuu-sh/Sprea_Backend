CREATE TABLE IF NOT EXISTS product_discovery_provider_state (
  candidate_id INTEGER NOT NULL REFERENCES product_discovery_candidates(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_searched_at TEXT,
  next_search_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(candidate_id,provider)
);
CREATE INDEX IF NOT EXISTS discovery_provider_queue_idx ON product_discovery_provider_state(provider,next_search_at,status);

CREATE TABLE IF NOT EXISTS product_discovery_provider_runs (
  run_id INTEGER NOT NULL REFERENCES product_discovery_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  searched_count INTEGER NOT NULL DEFAULT 0,
  found_count INTEGER NOT NULL DEFAULT 0,
  listing_count INTEGER NOT NULL DEFAULT 0,
  profitable_count INTEGER NOT NULL DEFAULT 0,
  threshold_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(run_id,provider)
);
