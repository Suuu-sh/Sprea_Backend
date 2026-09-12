-- Keep the paged discovery query ordered without sorting the full candidate table.
CREATE INDEX IF NOT EXISTS discovery_candidates_priority_idx
  ON product_discovery_candidates(buyback_provider_count DESC, best_buyback_price_yen DESC, id DESC);

-- Result counts and latest prices are resolved per candidate page.
CREATE INDEX IF NOT EXISTS discovery_results_candidate_source_captured_idx
  ON product_discovery_results(candidate_id, source, captured_at DESC);
