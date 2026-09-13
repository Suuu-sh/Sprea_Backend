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

GitHub Actions は UTC 00:10（日本時間 09:10）に次の処理を自動実行します。

1. `/api/data-export/today/status` で当日分の生成状況とアドオン契約を確認
2. 未生成なら `/api/data-export/today/generate` を 1 回だけ呼び出す（409 は生成済みとして継続）
3. `/api/data-export/today/download` を取得
4. Sprea Worker の `/admin/kaitorix-csv/upload` へ gzip のまま転送し、R2 の `kaitorix/csv/YYYY-MM-DD.csv.gz` に保存
5. Actions側でCSVを展開し、JANが正確で新品・未使用、アクセサリー以外、商品/買取価格が10,000円以上の行だけを候補化（買取価格上位10,000件まで。`KAITORIX_MAX_CANDIDATES`で調整可能）
6. 候補を500件ずつ `/admin/kaitorix-csv/import-candidates` へ送り、D1には商品ごとの最高買取価格と上位店舗情報だけを保存
7. Spreaの探索キューを起動し、候補×販売先の待機行を一度だけ作成（Workerは5分ごとに期限到来分だけ進める）
8. `collector_runs` に成功・失敗と保存先を記録

APIキーは GitHub Actions Secret `KAITORIX_API_KEY`、転送認証には既存の `ADMIN_TOKEN` を使います。手動実行は Actions の `Download KaitoriX CSV` から行えます。Workerの受信確認は `/api/kaitorix/csv/status` でできます。

Workerから買取Xへ直接アクセスすると買取X側のエッジ保護で403になるため、外向きAPI取得はGitHub Actions、WorkerはR2保存とステータス記録に分担しています。

CSV全件を毎日そのままD1へ展開することはしません。25,000商品・37店舗のスナップショットを約75,000件の見積もりに分解すると、D1無料枠の読み書きを再び圧迫するためです。原本はR2に保持し、Actionsで高額かつ本人確認できる候補だけを抽出します。D1には商品ごとの最高買取価格を投影し、上位店舗と店舗数は属性として残します。候補インポートは同じJANを上書きするため、途中で失敗しても同じ日のActionsを再実行できます。販売APIの探索は候補ごとのプロバイダー状態をキューとして一度だけマテリアライズし、期限到来分をインデックスで取得します。失敗後も次回から再開します。CSVの更新がない5分間隔の実行では、買取見積もりや候補全体を再スキャンしません。

探索キューが空のときは実行履歴を書き込まず、Dashboard・Analyticsなどの集計APIは短時間キャッシュします。これにより、結果の更新を止めずにアイドル時のD1読み書きを抑えます。
