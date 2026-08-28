# Sprea Research v1

Spreaの現行実装は、個人利用専用の **Cloudflare Workers + D1 + R2** 価格差研究基盤です。バックエンドはTypeScriptのResearch Workerへ統一しています。

## Cloudflare Research v1

個人利用専用の価格差研究基盤です。本番環境ではMock Collectorを無効化し、承認済みの実データだけを扱います。ローカルテストではMock Collectorから一周を実行できます。D1 に商品、価格履歴、Opportunity、30万円の Paper Trading、24h/48h/72h/7d 評価を保存します。Python/LightGBM は毎日 GitHub Actions で学習・バックテストし、厳しい昇格条件を通ったモデルだけを R2 に保存します。

## 処理の流れ

`Collector → Product Resolver → Price History → Opportunity Engine → Paper Trader → Evaluator → Training → Promotion`

- Market Profit = 売却価格 − 売却送料 − 確定手数料 − 商品価格 − 購入送料 + 確実な還元
- BUY baseline: Market Profit 5,000円以上、解決信頼度95%以上、1商品1個
- 48時間ラベル: **48時間後に Market Profit が5,000円以上なら1**（5,000円を含む）
- Precisionを最優先し、最低選択件数を満たさない候補は不採用
- 現行モデルがある場合、Precisionと平均利益がともに向上し、最大損失が悪化しない場合だけ昇格
- Worker は当面 rule baseline で判断します。R2のLightGBM text artifactは学習ライフサイクル検証用で、Workerで直接推論しているとは扱いません。

実サイト用Collectorは `Collector` interfaceで分離しています。購入側は公式の楽天市場商品検索APIとYahoo!ショッピング商品検索APIだけを利用し、HTMLスクレイピングは行いません。買取側の外部CollectorはPublicな [sprea-collectors](https://github.com/Suuu-sh/sprea-collectors) に分離しています。買取1丁目・森森買取・イオシスは規約または明示的な自動取得許可を確認できていないためfail-closedで無効です。許可済み公式API/feedを得るまで本番データとして実行しません。

公式APIのレスポンスだけでは送料額を確定できないため、送料無料と明示された新品・在庫あり商品だけを採用します。また、誤照合防止のためApple型番と容量をタイトルから確定できない商品は保存しません。ポイントはログイン状態やキャンペーンに依存し得るため、v1では確実な還元として計上しません。

- [楽天市場商品検索API（2026-07-01）](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)
- [Rakuten Web Service 利用規約](https://webservice.rakuten.co.jp/guide/rule)
- [Yahoo!ショッピング 商品検索 v3](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html)

## ローカル実行

Node.js 22、Python 3.12、SQLite CLIを用意します。通常のローカル実行は外部通信しないモックです。

```bash
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev
```

別のターミナルから手動実行します。`.dev.vars` に設定した値を使ってください。

```bash
curl -X POST http://localhost:8787/admin/run \
  -H 'Authorization: Bearer replace-with-a-long-random-value'
curl http://localhost:8787/api/portfolio \
  -H 'Authorization: Bearer replace-with-a-long-random-value'
curl 'http://localhost:8787/api/metrics?horizon=48' \
  -H 'Authorization: Bearer replace-with-a-long-random-value'
```

実CollectorはWorker内でスクレイピングせず、規約確認済みの公式APIやfeedを別プロセスで取得して、共通listing契約へ変換します。送信先は認証必須の `POST /api/ingest/listings` です。

```bash
curl -X POST http://localhost:8787/api/ingest/listings \
  -H 'Authorization: Bearer replace-with-a-separate-long-random-value' \
  -H 'Content-Type: application/json' \
  --data '{
    "runId":"official-feed-20260828T030000Z",
    "source":"official-feed",
    "listings":[{
      "source":"official-feed","sourceType":"retailer","externalId":"sku-123",
      "productName":"Camera X Body","jan":"4900000000001",
      "modelNumber":"CAM-X-BODY","brand":"Maker","category":"camera","condition":"new",
      "attributes":{"kitType":"Body","color":"Black"},
      "price":80000,"shippingFee":0,"fee":0,"reward":0,"stock":1,
      "productUrl":"https://partner.example/items/sku-123",
      "fetchedAt":"2026-08-28T03:00:00.000Z"
    }]
  }'
```

ResolverはPrecisionを優先し、GTIN完全一致、メーカー型番完全一致、またはbrand/model/variantの完全一致だけを受理します。曖昧なタイトル類似だけでは商品を作りません。`latest_prices` は毎回更新され、価格・送料・手数料・還元・在庫のいずれかが変化したときだけ履歴snapshotを追加します。同一商品の複数買取店を保持し、最高値、次点価格、店舗数、価格差、解決信頼度からSprea Scoreを計算します。

Cloudflare Cronは15分ごと（UTC）です。同じ時刻の再実行では価格・取引・評価を重複させません。Evaluatorは各期限以後で最初の売却価格を使います。GitHub Actionsから別のCollectorを定期実行する経路は設けません。

## テスト

```bash
npm run typecheck
npm test
python3 -m venv .venv
. .venv/bin/activate
pip install -r ml/requirements.txt
pytest -q ml
```

学習のローカル確認にはD1のSQLite exportを渡します。20件以上かつ両方のラベルが必要で、不足時は安全側で失敗します。

```bash
python ml/train.py --db /path/to/research.db --out artifacts/candidate
python ml/promote.py --candidate artifacts/candidate/metrics.json --incumbent artifacts/incumbent.json
```

## Cloudflare準備

1. `wrangler d1 create sprea-research` と `wrangler r2 bucket create sprea-models` を実行
2. `wrangler.jsonc` の `REPLACE_WITH_D1_DATABASE_ID` を発行されたIDに置換
3. `wrangler secret put ADMIN_TOKEN` で長いランダム値を登録
4. `wrangler secret put INGEST_API_KEY` でCollector専用の別tokenを登録
5. `ALLOWED_ORIGIN` を許可するFrontend originへ設定
6. `npx wrangler d1 migrations apply DB --remote`、`npm run deploy`

公式Collectorを有効にする場合は `SPREA_ENV=production` と `SPREA_COLLECTOR_SOURCE=rakuten` または `yahoo` をWorker varsへ設定し、必要な値を `wrangler secret put` で登録します。

- 楽天: `RAKUTEN_APPLICATION_ID`、`RAKUTEN_ACCESS_KEY`（任意var: `RAKUTEN_KEYWORD`）
- Yahoo!: `YAHOO_CLIENT_ID`（任意var: `YAHOO_QUERY`）

`SPREA_COLLECTOR_SOURCE=mock` はproductionで起動時に拒否されます。楽天のAccess KeyはHTTP headerで送り、ログやURLへ含めません。Yahoo!のClient IDと楽天Application IDは各公式仕様どおりquery parameterへ入るため、リクエストURLをログ出力しないでください。

D1/R2 bindingには実行時credentialは不要です。GitHubには次のRepository Secretsだけを登録します。

- `CLOUDFLARE_API_TOKEN`: 対象accountだけに Workers Scripts/D1/R2 editを与えた最小権限token（Global API Keyは禁止）
- `CLOUDFLARE_ACCOUNT_ID`

`.dev.vars`、token、credential、実データはcommitしません。ActionsはPRではテストのみ、mainでデプロイ、毎日03:00 JSTに学習します。候補は `models/<version>/` に先に保存し、全upload成功後に `models/current.json` を最後に更新します。rollbackはこのpointerを以前のversionへ戻します。

## API

- `GET /health`
- `POST /admin/run` — `ADMIN_TOKEN` Bearer認証必須。Mock専用
- `POST /admin/collect` — `ADMIN_TOKEN` Bearer認証必須。本番の公式API Collectorを即時実行
- `POST /api/ingest/listings` — `INGEST_API_KEY` Bearer認証必須。最大500件、source単位
- `GET /api/research/dashboard`
- `GET /api/research/products/:canonicalKey` — 商品属性・全価格履歴・判断・評価
- `GET /api/research/paper-trades`
- `POST /api/research/paper-trades/:id/close` — `ADMIN_TOKEN` Bearer認証必須
- `GET /api/research/settings`
- `PUT /api/research/settings` — `ADMIN_TOKEN` Bearer認証必須
- `GET /api/research/evaluator`
- `POST /api/research/evaluator/run` — `ADMIN_TOKEN` Bearer認証必須
- `GET /api/collector/status?limit=20`
- `GET /api/portfolio`
- `GET /api/metrics?horizon=48`

`/health` と ingest endpoint を除く全APIは `ADMIN_TOKEN` Bearer認証必須です。ingest endpointだけは権限を分離した `INGEST_API_KEY` を使います。

公開サービスではありません。本番では`ADMIN_TOKEN`と`INGEST_API_KEY`を別々の十分に長い乱数にし、必要ならCloudflare Accessも追加してください。認証値をquery parameterやlistingの`raw`へ入れないでください。
