-- The provider-state table is the durable discovery queue.  Keep a single
-- metadata row so scheduled runs can tell whether the queue needs rebuilding
-- without scanning the candidate or buyback tables on every invocation.
CREATE TABLE IF NOT EXISTS product_discovery_queue_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0, 1)),
  reset_requested INTEGER NOT NULL DEFAULT 1 CHECK(reset_requested IN (0, 1)),
  provider_signature TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL DEFAULT 0,
  quote_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  canonical_count INTEGER NOT NULL DEFAULT 0,
  rebuilt_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO product_discovery_queue_meta
  (id, dirty, reset_requested, provider_signature, generation, quote_count,
   candidate_count, canonical_count, rebuilt_at, updated_at)
VALUES (1, 1, 1, '', 0, 0, 0, 0, NULL, CURRENT_TIMESTAMP);

ALTER TABLE product_discovery_provider_state
  ADD COLUMN queue_priority_yen INTEGER NOT NULL DEFAULT 0;

UPDATE product_discovery_provider_state
SET queue_priority_yen = COALESCE(
  (SELECT best_buyback_price_yen
   FROM product_discovery_candidates
   WHERE product_discovery_candidates.id = product_discovery_provider_state.candidate_id),
  0
);

-- Due-item reads are now driven by provider and next attempt time instead of
-- a candidate x provider cross join with an OR predicate.
CREATE INDEX IF NOT EXISTS discovery_provider_due_idx
  ON product_discovery_provider_state(provider, next_search_at, queue_priority_yen DESC, candidate_id);

-- Run-overlap checks happen on every tick and must not scan the full
-- execution history as the run log grows.
CREATE INDEX IF NOT EXISTS discovery_runs_status_started_idx
  ON product_discovery_runs(status, started_at DESC);
