PRAGMA foreign_keys = ON;

-- The first production CSV snapshot started at midnight JST on 2026-09-13.
-- Keep the compact/current CSV data and remove only pre-CSV discovery inputs.
-- The UTC instant below is 2026-09-13 00:00 JST.
DELETE FROM buyback_quotes
WHERE (source_type = 'csv'
       AND COALESCE(json_extract(attributes_json, '$.snapshotDate'), '') < '2026-09-13')
   OR (source_type <> 'csv' AND fetched_at < '2026-09-12T15:00:00.000Z');

-- Candidates not seen in the first CSV snapshot are no longer part of the
-- active exploration universe. Provider state and discovery results cascade.
DELETE FROM product_discovery_candidates
WHERE last_seen_at < '2026-09-12T15:00:00.000Z';

-- Discovery history is operational telemetry, not Paper Trading history.
UPDATE product_discovery_runs
SET status = 'failed',
    message = 'retention cleanup interrupted stale run',
    finished_at = CURRENT_TIMESTAMP
WHERE status = 'running'
  AND started_at < '2026-09-12T15:00:00.000Z';

DELETE FROM product_discovery_results
WHERE captured_at < '2026-09-12T15:00:00.000Z';
DELETE FROM product_discovery_runs
WHERE started_at < '2026-09-12T15:00:00.000Z';

DELETE FROM collector_runs
WHERE started_at < '2026-09-12T15:00:00.000Z';
DELETE FROM evaluator_runs
WHERE started_at < '2026-09-12T15:00:00.000Z';

-- Keep one month of compact buyback history for stability scoring.
DELETE FROM buyback_daily_stats
WHERE day < date('now', '-30 days');

-- Keep snapshots referenced by Paper Trading/evaluation records even when
-- their timestamps are old. Unreferenced snapshots are safe to prune.
DELETE FROM research_price_snapshots
WHERE date(captured_at) < date('now', '-30 days')
  AND NOT EXISTS (
    SELECT 1
    FROM research_opportunity_evaluations e
    WHERE e.retail_snapshot_id = research_price_snapshots.id
       OR e.buyback_snapshot_id = research_price_snapshots.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM research_evaluations e
    WHERE e.buyback_snapshot_id = research_price_snapshots.id
  );

DELETE FROM price_snapshots
WHERE date(captured_at) < date('now', '-30 days')
  AND NOT EXISTS (
    SELECT 1
    FROM opportunities o
    WHERE o.buy_snapshot_id = price_snapshots.id
       OR o.sell_snapshot_id = price_snapshots.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM evaluations e
    WHERE e.sell_snapshot_id = price_snapshots.id
  );
