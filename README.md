# Sprea Backend

Spreaの価格収集、商品照合、利益計算、履歴・通知APIです。現在の優先実装は、個人利用専用の **Sprea Research v1** です。

Research v1 の Collector → Product Resolver → Price History → Opportunity Engine → 30万円 Paper Trader → 24h/48h/72h Evaluator は [`docs/research-v1.md`](docs/research-v1.md) を参照してください。

## ローカル起動

```bash
cp .env.example .env
# 必要な値を設定してから
set -a; source .env; set +a
go run ./cmd/api
```

ローカルCollectorはネットワークへ接続せず、明示的なモックデータだけを使います:

```bash
SPREA_ENV=local SPREA_COLLECTOR_MODE=mock SPREA_DRY_RUN=true go run ./cmd/collector
```

本番だけ `SPREA_ENV=production` と `SPREA_COLLECTOR_MODE=live` を設定し、公式APIの実データを取得します。環境とモードが食い違う場合は安全のため起動に失敗します。

Research v1 のローカル縦切り:

```bash
go run ./cmd/research
```

## 構成

- Go API + SQLite: ローカル開発
- 楽天市場Collector: `internal/collector/rakuten`
- 商品照合: `internal/matcher`
- 利益計算: `internal/profit`
- Cloudflare Workers + D1: `infra/worker`
- 毎時収集: `.github/workflows/collector.yml`

本番設定は [`docs/production.md`](docs/production.md) を参照してください。

---

## Cloudflare Research v1

個人利用専用の価格差研究基盤です。Cloudflare Worker が Mock Collector から一周を実行し、D1 に商品、価格履歴、Opportunity、30万円の Paper Trading、24h/48h/72h/7d 評価を保存します。Python/LightGBM は毎日 GitHub Actions で学習・バックテストし、厳しい昇格条件を通ったモデルだけを R2 に保存します。

## 処理の流れ

`Collector → Product Resolver → Price History → Opportunity Engine → Paper Trader → Evaluator → Training → Promotion`

- Market Profit = 売却価格 − 売却送料 − 確定手数料 − 商品価格 − 購入送料 + 確実な還元
- BUY baseline: Market Profit 5,000円以上、解決信頼度95%以上、1商品1個
- 48時間ラベル: **48時間後に Market Profit が5,000円以上なら1**（5,000円を含む）
- Precisionを最優先し、最低選択件数を満たさない候補は不採用
- 現行モデルがある場合、Precisionと平均利益がともに向上し、最大損失が悪化しない場合だけ昇格
- Worker は当面 rule baseline で判断します。R2のLightGBM text artifactは学習ライフサイクル検証用で、Workerで直接推論しているとは扱いません。

実サイト用Collectorは `Collector` interfaceを実装して追加できますが、公式API・利用規約・robots.txtを個別確認するまで有効化しません。

## ローカル実行

Node.js 22、Python 3.12、SQLite CLIを用意します。

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
curl http://localhost:8787/api/portfolio
curl 'http://localhost:8787/api/metrics?horizon=48'
```

Cronは15分ごと（UTC）です。同じ時刻の再実行では価格・取引・評価を重複させません。Evaluatorは各期限以後で最初の売却価格を使います。

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
4. `npx wrangler d1 migrations apply DB --remote`、`npm run deploy`

D1/R2 bindingには実行時credentialは不要です。GitHubには次のRepository Secretsだけを登録します。

- `CLOUDFLARE_API_TOKEN`: 対象accountだけに Workers Scripts/D1/R2 editを与えた最小権限token（Global API Keyは禁止）
- `CLOUDFLARE_ACCOUNT_ID`

`.dev.vars`、token、credential、実データはcommitしません。ActionsはPRではテストのみ、mainでデプロイ、毎日03:00 JSTに学習します。候補は `models/<version>/` に先に保存し、全upload成功後に `models/current.json` を最後に更新します。rollbackはこのpointerを以前のversionへ戻します。

## API

- `GET /health`
- `POST /admin/run` — `ADMIN_TOKEN`が設定されている場合Bearer認証必須
- `GET /api/portfolio`
- `GET /api/metrics?horizon=48`

公開サービスではありません。本番では必ず`ADMIN_TOKEN`を設定し、必要ならCloudflare Accessも追加してください。
