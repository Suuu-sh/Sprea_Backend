PRAGMA foreign_keys = ON;

-- One row per JAN/provider/day keeps stability calculations bounded.
CREATE TABLE IF NOT EXISTS buyback_daily_stats (
  jan TEXT NOT NULL,
  provider TEXT NOT NULL,
  day TEXT NOT NULL,
  latest_price INTEGER NOT NULL CHECK(latest_price > 0),
  latest_fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (jan, provider, day)
);

CREATE INDEX IF NOT EXISTS buyback_daily_stats_jan_day_idx
  ON buyback_daily_stats(jan, day DESC);

-- Seed the compact table from the existing history once. Later imports maintain it incrementally.
INSERT OR REPLACE INTO buyback_daily_stats(jan, provider, day, latest_price, latest_fetched_at, updated_at)
SELECT jan, provider, date(fetched_at), price, fetched_at, updated_at
FROM (
  SELECT jan, provider, price, fetched_at, updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY jan, provider, date(fetched_at)
           ORDER BY fetched_at DESC, updated_at DESC, id DESC
         ) AS rank
  FROM buyback_quotes
  WHERE jan IS NOT NULL AND jan <> '' AND price > 0
)
WHERE rank = 1;
