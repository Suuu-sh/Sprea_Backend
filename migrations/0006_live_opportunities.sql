PRAGMA foreign_keys = ON;

ALTER TABLE latest_prices ADD COLUMN stock_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(stock_status IN ('in_stock','low_stock','out_of_stock','preorder','unknown'));
UPDATE latest_prices SET stock_status=CASE WHEN stock>0 THEN 'in_stock' ELSE 'out_of_stock' END;
CREATE INDEX IF NOT EXISTS latest_prices_retail_eligibility_idx
  ON latest_prices(captured_at DESC, stock_status, price_yen);

ALTER TABLE research_opportunities ADD COLUMN best_buyback_provider TEXT;
ALTER TABLE research_opportunities ADD COLUMN second_buyback_provider TEXT;
ALTER TABLE research_opportunities ADD COLUMN third_buyback_price_yen INTEGER;
ALTER TABLE research_opportunities ADD COLUMN third_buyback_provider TEXT;
ALTER TABLE research_opportunities ADD COLUMN best_second_spread_yen INTEGER;
