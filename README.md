# Sprea Backend

Spreaの価格収集、商品照合、利益計算、履歴・通知APIです。

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

## 構成

- Go API + SQLite: ローカル開発
- 楽天市場Collector: `internal/collector/rakuten`
- 商品照合: `internal/matcher`
- 利益計算: `internal/profit`
- Cloudflare Workers + D1: `infra/worker`
- 毎時収集: `.github/workflows/collector.yml`

本番設定は [`docs/production.md`](docs/production.md) を参照してください。
