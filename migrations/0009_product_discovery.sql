CREATE TABLE IF NOT EXISTS product_discovery_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL UNIQUE,
  canonical_product_id INTEGER REFERENCES canonical_products(id),
  jan TEXT,
  model_number TEXT,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  condition TEXT NOT NULL DEFAULT 'new',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  best_buyback_price_yen INTEGER NOT NULL CHECK(best_buyback_price_yen > 0),
  best_buyback_provider TEXT NOT NULL,
  buyback_provider_count INTEGER NOT NULL DEFAULT 1,
  resolver_status TEXT NOT NULL CHECK(resolver_status IN ('candidate','resolved','searchable','retail_found','unresolved','ambiguous')),
  resolver_confidence REAL NOT NULL DEFAULT 0,
  resolver_reason TEXT NOT NULL DEFAULT '',
  search_query TEXT,
  target_purchase_price_yen INTEGER,
  discovery_ceiling_yen INTEGER,
  last_searched_at TEXT,
  next_search_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS discovery_candidates_queue_idx ON product_discovery_candidates(resolver_status,next_search_at,last_searched_at);
CREATE INDEX IF NOT EXISTS discovery_candidates_product_idx ON product_discovery_candidates(canonical_product_id);

CREATE TABLE IF NOT EXISTS product_discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  quote_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  canonical_count INTEGER NOT NULL DEFAULT 0,
  searched_count INTEGER NOT NULL DEFAULT 0,
  yahoo_found_count INTEGER NOT NULL DEFAULT 0,
  purchasable_count INTEGER NOT NULL DEFAULT 0,
  profitable_count INTEGER NOT NULL DEFAULT 0,
  threshold_count INTEGER NOT NULL DEFAULT 0,
  buy_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS product_discovery_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES product_discovery_runs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES product_discovery_candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price_yen INTEGER NOT NULL,
  product_url TEXT NOT NULL,
  within_discovery_ceiling INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  UNIQUE(run_id,candidate_id,source,external_id)
);
CREATE INDEX IF NOT EXISTS discovery_results_candidate_idx ON product_discovery_results(candidate_id,captured_at DESC);
