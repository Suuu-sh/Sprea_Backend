INSERT OR IGNORE INTO opportunities
  (external_key,name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,product_url,updated_at)
VALUES
  ('demo-switch-oled','Nintendo Switch（有機ELモデル）','ゲーム','楽天市場','じゃんぱら','',34980,36000,8,'','2026-08-27T00:00:00Z'),
  ('demo-airpods-pro-2','AirPods Pro（第2世代）USB-C','オーディオ','楽天市場','ゲオ','',32800,35000,6,'','2026-08-27T00:00:00Z');

INSERT INTO price_history(opportunity_id,purchase_price,buyback_price,base_point_rate,recorded_at)
SELECT id,purchase_price,buyback_price,base_point_rate,updated_at FROM opportunities
WHERE external_key IN ('demo-switch-oled','demo-airpods-pro-2')
  AND NOT EXISTS (SELECT 1 FROM price_history);
