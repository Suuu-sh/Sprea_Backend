# Cloudflare Pages settings

Cloudflare Pages に `frontend` を接続するときの設定値です。

| 項目 | 値 |
|---|---|
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `.next` |
| Node.js version | `22` |
| Environment variable | `NEXT_PUBLIC_API_URL=https://sprea-api.<account>.workers.dev` |

Next.js のSSR機能を使う場合は Cloudflare の現行Next.jsアダプターを追加する必要があります。現状の画面を静的配信へ固定するか、アダプターを導入するかはデプロイ前にFrontendの構成に合わせて選びます。プレビュー環境では `NEXT_PUBLIC_API_URL` をプレビュー用Worker URLへ分離してください。
