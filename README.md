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

Collectorの安全な確認:

```bash
SPREA_COLLECTOR_MODE=mock SPREA_DRY_RUN=true go run ./cmd/collector
```

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
