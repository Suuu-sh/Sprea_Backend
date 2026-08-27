# Sprea Research v1

Sprea Research は公開サービスではなく、個人利用向けの価格差研究基盤です。最初の目的は「現在の差額」を表示することではなく、Apple 新品の価格履歴と Paper Trading の答え合わせを蓄積し、後から Agent・機械学習を比較できる教材を作ることです。

## 縦切り

```text
Collector
  → Product Resolver
  → Price History
  → Opportunity Engine
  → Paper Trader（初期資金 300,000 円）
  → Evaluator（24h / 48h / 72h）
```

- Collector の共通入力は `research.Observation`。取得元固有の応答は `raw` に残す。
- Resolver は Apple・新品に限定し、JAN または型番＋容量でのみ確定する。曖昧な名前一致は取引対象にしない。
- Market Profit は `買取価格 - 商品価格 - 購入送料 - 売却送料 - 確定手数料 + 確実な還元`。
- 初期 Baseline は利益 5,000 円以上、Resolver 信頼度 95% 以上、1商品1個。
- Paper Trader は 30 万円を超えて仕入れず、72時間評価完了まで資金を拘束する。
- Evaluator は各期限以後で最初に取得できた買取価格を採用し、同一 Trade・同一期限を二重採点しない。24h / 48h / 72h に加え7日後も評価する。
- BUYだけでなくSKIPも保存し、`buy_correct` / `buy_failed` / `skip_correct` / `missed_opportunity` の4分類で評価する。
- 資金効率として3日拘束想定の年率換算値を保存し、最高買取店舗数、2位価格、1位と2位の差、Sprea Scoreも特徴量として残す。
- 実取引開始後に、予測利益と実現利益の差、配送日数、減額理由をReality Calibrationへ保存できる。
- 新モデルはPrecision、平均利益、最大損失がBaselineを上回った場合だけ昇格可能とする。

## 安全なデータ取得方針

2026-08-28 時点の確認結果です。規約は変わるため、Collector を有効化する前に再確認します。

| 取得元 | v1 の扱い | 理由 |
|---|---|---|
| Apple 公式サイト | 自動取得しない | Website Terms of Use が page-scrape、robot 等による取得・監視を禁止しているため |
| 楽天市場 | 公式 Rakuten Web Service API のみ | 商品検索用の公式 API と利用規約が提供されているため。アプリID・アクセスキー、表示条件、レート制限を守る |
| 買取店 | 審査済み API が見つかるまで CSV 手動取込 | 各店の利用規約と robots.txt の両方を確認できるまで HTTP Collector を作らない |

robots.txt は許可証ではありません。robots.txt が許可していても利用規約が禁止する場合は取得しません。逆に明示的な公式 API がある場合は API 規約を優先して実装します。

参照:

- Apple Website Terms of Use: https://www.apple.com/legal/internet-services/terms/site.html
- Rakuten Web Service 利用規約: https://webservice.rakuten.co.jp/guide/rule
- 楽天市場 API 一覧: https://webservice.rakuten.co.jp/documentation

## ローカル実行

デモデータで縦切りを一度動かします。

```bash
cd backend
go run ./cmd/research
```

手動 CSV を使う場合:

```bash
go run ./cmd/research -input examples/apple_observations.csv
```

デモが実データを汚さないよう、CLIの既定保存先は `backend/data/sprea-research-demo.db` です。実運用では `-db data/sprea-research.db -input ...` を明示します。CSV の列は `source, side, source_product_id, title, price, shipping, stock, condition, jan, model, capacity, color, captured_at, source_url` です。実データでは監査できるよう取得元URLを必ず残します。

## 次の実装順

1. 楽天公式 API の取得結果を `Observation` に変換し、Apple 新品だけを取り込む。
2. 利用条件を個別確認できた買取元だけ Collector を追加する。それまでは CSV。
3. Collector run の件数・成功率・異常値を記録し、信用できない run を自動隔離する。
4. 価格履歴が十分に貯まってから Rule / Machine Learning / Agent を同じ評価データで比較する。

## 現在の実装範囲

- 実装済み: 6コンポーネントの縦切り、30万円資金拘束、BUY/SKIP、24h/48h/72h/7d評価、Rule v1指標、Sprea Scoreの初期式、Reality Calibration、モデル昇格ゲート、取得元ポリシー。
- データ待ち: LightGBM学習、将来価格確率、価格安定性、類似案件成功率。履歴がない状態で擬似精度を作らない。
- 規約確認待ち: 買取店HTTP Collector。未承認ソースはコード上も許可済み扱いにしない。
- 将来段階: LLM Agentによる失敗分析、会員制、配信人数制限、Matching Engine、購入支援。

## Research API

- `GET /api/research/portfolio`: 30万円口座の利用可能額と拘束額
- `GET /api/research/metrics?horizon=48`: Rule v1のPrecision、Recall、見逃し、平均利益、最大損失
- `POST /api/research/reality`: 少額実取引の実績とSlippageを保存
