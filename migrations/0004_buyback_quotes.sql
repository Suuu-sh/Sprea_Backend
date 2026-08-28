PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buyback_quotes (
  id TEXT PRIMARY KEY,
  product_id INTEGER REFERENCES canonical_products(id),
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('scraper','csv','manual','api','partner_feed')),
  external_id TEXT,
  product_name TEXT NOT NULL,
  jan TEXT,
  model_number TEXT,
  brand TEXT,
  category TEXT,
  condition TEXT NOT NULL CHECK(condition IN ('new','unused','used','refurbished','unknown')),
  attributes_json TEXT NOT NULL DEFAULT '{}',
  price INTEGER NOT NULL CHECK(price > 0),
  shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK(shipping_fee >= 0),
  fee INTEGER NOT NULL DEFAULT 0 CHECK(fee >= 0),
  buyback_status TEXT NOT NULL CHECK(buyback_status IN ('accepting','paused','unavailable','unknown')),
  product_url TEXT,
  fetched_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS buyback_quotes_provider_external_idx
  ON buyback_quotes(provider, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
CREATE INDEX IF NOT EXISTS buyback_quotes_provider_idx ON buyback_quotes(provider);
CREATE INDEX IF NOT EXISTS buyback_quotes_jan_idx ON buyback_quotes(jan) WHERE jan IS NOT NULL AND jan <> '';
CREATE INDEX IF NOT EXISTS buyback_quotes_model_number_idx ON buyback_quotes(model_number) WHERE model_number IS NOT NULL AND model_number <> '';
CREATE INDEX IF NOT EXISTS buyback_quotes_product_idx ON buyback_quotes(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS buyback_quotes_fetched_idx ON buyback_quotes(fetched_at DESC);
