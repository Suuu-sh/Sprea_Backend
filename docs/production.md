# Sprea production setup (Cloudflare + GitHub Actions)

本番は、画面をCloudflare Pages、APIをWorkers、データをD1、定期収集をGitHub Actionsで動かす構成です。この文書の手順は環境を作成しますが、リポジトリから自動デプロイする設定を完了するまでは本番公開されません。

## 構成

```text
Browser -> Cloudflare Pages (Next.js)
        -> Cloudflare Worker (infra/worker)
        -> Cloudflare D1

GitHub Actions -> Go collector -> POST /api/ingest/opportunities
```

Workerは一覧、詳細、価格履歴、ユーザー設定APIを提供します。収集APIだけはBearer tokenが必須です。ユーザー設定は現在 `X-User-ID` 単位で保存します。本番公開前に認証サービスが発行した改ざん不能なIDへ置き換えてください。

## 1. WorkerとD1の準備

Node.js 22以上とCloudflareアカウントが必要です。

```bash
cd infra/worker
npm install
npx wrangler login
npx wrangler d1 create sprea-db
```

表示されたD1のIDを `infra/worker/wrangler.toml` の `database_id` に設定します。次にDBを初期化します。

```bash
npm run db:migrate:remote
npx wrangler secret put INGEST_API_KEY
npm run deploy
```

`INGEST_API_KEY` は十分に長いランダム値にし、Gitへ保存しません。`ALLOWED_ORIGIN` はPagesの独自ドメインへ変更します。ローカル確認は次で行えます。

```bash
npm run db:migrate:local
npm run dev
```

主なAPI:

- `GET /health`
- `GET /api/opportunities?pointAdjustment=3`
- `GET /api/opportunities/:id`
- `GET /api/opportunities/:id/history`（`/api/history/:id` も利用可）
- `GET /api/settings` (`X-User-ID`)
- `PUT /api/settings` (`X-User-ID`)
- `POST /api/ingest/opportunities`（`/api/ingest` も利用可、`Authorization: Bearer ...`）

## 2. Pagesの準備

Cloudflare PagesでGitHubリポジトリを接続し、`infra/pages/README.md` の値を設定します。Frontendには次の環境変数が必要です。

```text
NEXT_PUBLIC_API_URL=https://sprea-api.<account>.workers.dev
```

プレビューと本番は別のWorker/D1を利用するのが安全です。現在のNext.js機能とCloudflareの対応状況をデプロイ時に確認し、必要なら公式のNext.jsアダプターをFrontendへ導入します。

## 3. 定期Collectorの準備

GitHub repository settingsで以下を登録します。

### Secrets

| 名前 | 用途 |
|---|---|
| `SPREA_API_URL` | Worker URL（例: `https://sprea-api.example.workers.dev`） |
| `SPREA_INGEST_API_KEY` | Workerの `INGEST_API_KEY` と同じ値 |
| `RAKUTEN_APPLICATION_ID` | 楽天API application ID |
| `RAKUTEN_ACCESS_KEY` | 楽天API access key |
| `RAKUTEN_AFFILIATE_ID` | 楽天affiliate ID（不要なら未設定） |

### Variables

| 名前 | 初期値 | 用途 |
|---|---:|---|
| `SPREA_COLLECTOR_MODE` | `live` | 実データ取得のみ |
| `SPREA_ENABLE_PRODUCTION_INGEST` | `false` | `true` のときだけ定期実行から送信 |

`.github/workflows/collector.yml` は毎時17分に実データCollectorを起動します。初期状態では定期実行がdry-runになるため、まずAPI資格情報を設定して `dry_run=true` で確認し、最後に `dry_run=false` にします。

Collectorが読む環境変数は次の通りです。

```text
SPREA_API_URL
SPREA_INGEST_API_KEY
SPREA_COLLECTOR_MODE=live
SPREA_DRY_RUN=true|false
RAKUTEN_APPLICATION_ID
RAKUTEN_AFFILIATE_ID
```

## 4. 公開前チェック

1. Workerの `ALLOWED_ORIGIN` を本番Pages URLへ限定する
2. 収集キーをGitHub SecretsとWorker Secretにだけ保存する
3. D1に実データ以外が入っていないことを確認する
4. 認証を導入し、クライアント指定の `X-User-ID` を信用しない
5. 楽天・各買取先のAPI規約、レート制限、表示義務を確認する
6. GitHub Actionsのdry-runログに秘密値や取得データが出ないことを確認する
7. Worker/Pages/D1/GitHub Actionsの利用量アラートを有効にする

## ロールバック

WorkerはCloudflare dashboardから直前deploymentへ戻せます。DB schemaは追加型migrationを基本とし、破壊的変更前にはD1 backup/exportを取得します。Collectorに異常があれば `SPREA_ENABLE_PRODUCTION_INGEST=false` に戻すと次回から送信を停止できます。
