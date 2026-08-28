PRAGMA foreign_keys = ON;

ALTER TABLE buyback_quotes ADD COLUMN match_confidence REAL NOT NULL DEFAULT 0 CHECK(match_confidence >= 0 AND match_confidence <= 1);
ALTER TABLE buyback_quotes ADD COLUMN match_reason TEXT NOT NULL DEFAULT 'unresolved';

CREATE INDEX IF NOT EXISTS buyback_quotes_eligible_idx
  ON buyback_quotes(product_id, fetched_at DESC, price DESC)
  WHERE product_id IS NOT NULL AND condition = 'new' AND buyback_status = 'accepting' AND price > 0;
