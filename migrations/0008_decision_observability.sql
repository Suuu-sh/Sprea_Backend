-- Structured decision diagnostics. Additive and safe for existing opportunities.
ALTER TABLE research_opportunities ADD COLUMN decision_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_opportunities ADD COLUMN required_profit_yen INTEGER NOT NULL DEFAULT 5000 CHECK(required_profit_yen >= 0);
ALTER TABLE research_opportunities ADD COLUMN profit_gap_yen INTEGER NOT NULL DEFAULT 0 CHECK(profit_gap_yen >= 0);
ALTER TABLE research_opportunities ADD COLUMN required_confidence REAL NOT NULL DEFAULT 0.95 CHECK(required_confidence >= 0 AND required_confidence <= 1);
ALTER TABLE research_opportunities ADD COLUMN confidence_gap REAL NOT NULL DEFAULT 0 CHECK(confidence_gap >= 0 AND confidence_gap <= 1);

-- Historical thresholds are not available, so existing rows use the settings at
-- migration time. Newly created rows always capture their actual decision settings.
UPDATE research_opportunities
SET decision_reasons_json = CASE
  WHEN decision = 'BUY' THEN '[]'
  WHEN reason = 'profit_below_threshold' THEN '["profit_below_threshold"]'
  WHEN reason = 'resolver_confidence_below_threshold' THEN '["confidence_below_threshold"]'
  ELSE '["other"]'
END,
required_profit_yen = COALESCE((SELECT minimum_profit_yen FROM research_settings WHERE id=1), 5000),
profit_gap_yen = MAX(0, COALESCE((SELECT minimum_profit_yen FROM research_settings WHERE id=1), 5000) - market_profit_yen),
required_confidence = COALESCE((SELECT minimum_confidence FROM research_settings WHERE id=1), 0.95),
confidence_gap = MAX(0, COALESCE((SELECT minimum_confidence FROM research_settings WHERE id=1), 0.95) - resolver_confidence);

CREATE INDEX IF NOT EXISTS research_opportunities_decision_day_idx
  ON research_opportunities(decision, detected_at DESC);
