# Phase 1 現行構造

調査日: 2026-08-29

| 関心事 | 現在の実装場所 | 補足 |
|---|---|---|
| Product / Canonical Product | `src/types.ts` の `ProductIdentity`、`migrations/0002_research_api.sql` の `canonical_products` | 正規商品の解決結果はD1へ保存 |
| Retail Listing | `src/types.ts` の `ListingObservation`（`side: "purchase"`）、`research_listings` / `latest_prices` | Phase 1の共通Domain型は `src/domain/retail-listing.ts` に追加 |
| Product Resolver | `src/pipeline.ts` の `resolveProduct` | JAN、メーカー型番、複合属性の順でPrecision重視 |
| Opportunity | `src/pipeline.ts` の `createOpportunities`、`research_opportunities` | 利益計算・BUY/SKIPを担当 |
| Paper Trading | `src/pipeline.ts` のTrade作成、`src/index.ts` の一覧・決済、D1 trigger | 今回変更なし |
| Evaluator | `src/pipeline.ts` の `evaluateDue`、`src/index.ts` のEvaluator API | 24/48/72/168時間を追跡。今回変更なし |
| Provider / Collector | `src/types.ts` の既存 `Collector`、`src/collectors/` | Yahoo/Rakuten/Mockは既存契約を継続。新Provider契約はAdapterを追加できる準備のみ |
| D1 Repository | 独立Repository classはなく、`src/pipeline.ts` と `src/index.ts` のprepared statement | 大規模分離・Migrationは今回行わない |
| Worker Handler | `src/index.ts` の `fetch` / `scheduled` とroute関数 | HTTP、Cron、認証を担当 |

`src/domain/` は将来のProvider AdapterとApplication層から利用する依存のないDomain型・純粋関数に限定する。既存の稼働中CollectorやD1 DTOは互換性維持のため変更していない。
