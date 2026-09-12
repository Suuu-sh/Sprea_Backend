# 買取X CSV取り込みの検証

## 現在の検証範囲

`test/fixtures/kaitorix-sample.csv` は、買取XのCSV形式（基本列、店舗別価格、店舗別取得日時）を小さく再現したダミーです。

次のテストで、CSVをSpreaの買取見積もり入力へ変換できます。

```bash
npm test -- --run test/kaitorix-csv.test.ts
```

CSVの1行は商品単位ですが、Sprea内部では店舗ごとに1件の買取見積もりへ展開します。取得日時は買取Xの日本時間表記からUTCへ変換し、店舗名を`provider`として保持します。

## 本番接続時に変わる仕様

- CSV全件をそのままD1へ保存せず、ストリーム処理後に候補と集計値だけを保存する
- CSVに状態・送料・手数料・商品URLがないため、状態は商品名から確定できない場合に`unknown`として除外する
- `msrp`は買取見積もり本体ではなく属性として保持し、仕入れ価格は販売側データと照合する
- 同じJANでも店舗ごとに価格と取得時刻が異なるため、最高値だけでなく店舗数と次点価格を集計する
- 日次CSVはスナップショットなので、7日・14日・30日の安定度はSprea側で日次の派生値として蓄積する

## 本番の日次取得

本番 Worker は UTC 00:10（日本時間 09:10）に次の処理を自動実行します。

1. `/api/data-export/today/status` で当日分の生成状況とアドオン契約を確認
2. 未生成なら `/api/data-export/today/generate` を 1 回だけ呼び出す（409 は生成済みとして継続）
3. `/api/data-export/today/download` を取得し、gzip のまま R2 の `kaitorix/csv/YYYY-MM-DD.csv.gz` に保存
4. `collector_runs` に成功・失敗と保存先を記録

APIキーは Worker Secret `KAITORIX_API_KEY` に設定します。取得処理は `/admin/kaitorix-csv/run`（`ADMIN_TOKEN` が必要）から手動再実行でき、`/api/kaitorix/csv/status` で最終結果を確認できます。

CSV全件を毎日そのままD1へ展開することはしません。25,000商品・37店舗のスナップショットを約75,000件の見積もりに分解すると、D1無料枠の読み書きを再び圧迫するためです。原本はR2に保持し、D1への候補化・必要商品の取り込みは別のキュー処理で段階的に行います。
