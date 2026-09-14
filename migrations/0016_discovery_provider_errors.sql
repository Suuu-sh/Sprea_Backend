-- Keep the latest provider error beside the bounded run summary so the UI can
-- explain a failed batch without scanning the per-candidate queue.
ALTER TABLE product_discovery_provider_runs
  ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
