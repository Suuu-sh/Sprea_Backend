PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_product_aliases (
  alias_type TEXT NOT NULL CHECK(alias_type IN ('gtin','mpn','composite')),
  alias_value TEXT NOT NULL,
  condition TEXT NOT NULL,
  canonical_product_id INTEGER NOT NULL REFERENCES canonical_products(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(alias_type,alias_value,condition)
);
CREATE INDEX IF NOT EXISTS canonical_alias_product_idx ON canonical_product_aliases(canonical_product_id);
INSERT OR IGNORE INTO canonical_product_aliases(alias_type,alias_value,condition,canonical_product_id,created_at)
SELECT 'gtin',REPLACE(REPLACE(REPLACE(UPPER(gtin),' ',''),'-',''),'_',''),condition,id,created_at FROM canonical_products WHERE gtin IS NOT NULL AND gtin<>'';
INSERT OR IGNORE INTO canonical_product_aliases(alias_type,alias_value,condition,canonical_product_id,created_at)
SELECT 'mpn',REPLACE(REPLACE(REPLACE(UPPER(manufacturer_part_number),' ',''),'-',''),'_','')||':'||REPLACE(REPLACE(REPLACE(UPPER(variant),' ',''),'-',''),'_',''),condition,id,created_at FROM canonical_products WHERE manufacturer_part_number IS NOT NULL AND manufacturer_part_number<>'';

ALTER TABLE research_opportunities ADD COLUMN sale_shipping_yen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_opportunities ADD COLUMN fixed_fees_yen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_paper_trades ADD COLUMN canonical_product_id INTEGER REFERENCES canonical_products(id);
ALTER TABLE research_paper_trades ADD COLUMN settlement_revenue_yen INTEGER;
UPDATE research_paper_trades SET canonical_product_id=(SELECT canonical_product_id FROM research_opportunities WHERE id=opportunity_id) WHERE canonical_product_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_trade_per_product_idx ON research_paper_trades(canonical_product_id) WHERE status='OPEN';

CREATE TABLE IF NOT EXISTS paper_settlement_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL UNIQUE REFERENCES research_paper_trades(id),
  reserved_yen INTEGER NOT NULL,
  revenue_yen INTEGER NOT NULL,
  profit_yen INTEGER NOT NULL,
  settled_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS paper_trade_validate_before_insert
BEFORE INSERT ON research_paper_trades
BEGIN
  SELECT CASE WHEN NEW.canonical_product_id IS NULL THEN RAISE(ABORT,'canonical product required') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM research_paper_trades WHERE canonical_product_id=NEW.canonical_product_id AND status='OPEN') THEN RAISE(ABORT,'open position already exists') END;
  SELECT CASE WHEN (SELECT available_cash_yen FROM research_paper_accounts WHERE id=1)<NEW.reserved_yen THEN RAISE(ABORT,'insufficient paper cash') END;
END;
CREATE TRIGGER IF NOT EXISTS paper_trade_debit_after_insert
AFTER INSERT ON research_paper_trades
BEGIN
  UPDATE research_paper_accounts SET available_cash_yen=available_cash_yen-NEW.reserved_yen,reserved_cash_yen=reserved_cash_yen+NEW.reserved_yen,updated_at=NEW.opened_at WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS paper_trade_settle_after_close
AFTER UPDATE OF status ON research_paper_trades
WHEN OLD.status='OPEN' AND NEW.status='CLOSED'
BEGIN
  SELECT CASE WHEN NEW.settlement_revenue_yen IS NULL OR NEW.closed_at IS NULL THEN RAISE(ABORT,'settlement details required') END;
  INSERT INTO paper_settlement_ledger(trade_id,reserved_yen,revenue_yen,profit_yen,settled_at) VALUES(NEW.id,OLD.reserved_yen,NEW.settlement_revenue_yen,NEW.settlement_revenue_yen-OLD.reserved_yen,NEW.closed_at);
  UPDATE research_paper_accounts SET available_cash_yen=available_cash_yen+NEW.settlement_revenue_yen,reserved_cash_yen=reserved_cash_yen-OLD.reserved_yen,updated_at=NEW.closed_at WHERE id=1;
END;

ALTER TABLE research_settings ADD COLUMN max_price_age_minutes INTEGER NOT NULL DEFAULT 60;
CREATE TRIGGER IF NOT EXISTS research_initial_capital_sync
AFTER UPDATE OF initial_capital_yen ON research_settings
WHEN NEW.initial_capital_yen<>OLD.initial_capital_yen
BEGIN
  SELECT CASE WHEN (SELECT available_cash_yen FROM research_paper_accounts WHERE id=1)+(NEW.initial_capital_yen-OLD.initial_capital_yen)<0 THEN RAISE(ABORT,'capital below committed amount') END;
  UPDATE research_paper_accounts SET initial_cash_yen=NEW.initial_capital_yen,available_cash_yen=available_cash_yen+(NEW.initial_capital_yen-OLD.initial_capital_yen),updated_at=NEW.updated_at WHERE id=1;
END;

CREATE TABLE IF NOT EXISTS research_model_runs (
  version TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('candidate','rejected','promoted','failed')),
  artifact_key TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  promoted_at TEXT
);
