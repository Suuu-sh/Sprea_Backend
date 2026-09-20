-- A CSV import marks the materialized queue dirty.  Multiple manual requests
-- and cron invocations must not rebuild the same 5,000-row projection at once
-- (that duplicate work is enough to exhaust D1's daily write allowance).
ALTER TABLE product_discovery_queue_meta
  ADD COLUMN rebuild_lock INTEGER NOT NULL DEFAULT 0 CHECK(rebuild_lock IN (0, 1));

ALTER TABLE product_discovery_queue_meta
  ADD COLUMN rebuild_started_at TEXT;
