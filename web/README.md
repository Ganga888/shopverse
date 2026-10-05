# ShopVerse web

Dependency-free SPA (ES modules, hash routing): product list, search, cart + coupon, checkout, order status polling.
It calls the API same-origin at `/api/v1/*` (CloudFront forwards `/api/*` to the ALB), so it needs no CORS.

- Local: `docker compose up` in `services/` serves this folder at http://localhost:8080 through the local nginx gateway.
- Build: `npm run build` copies the static files to `dist/`.
- Deploy: `ENV=dev npm run deploy` (syncs to `s3://shopverse-dev-web`), then invalidate the CloudFront distribution.

Test cards: `tok_visa` approves; `tok_fail` is declined (the order ends `CANCELLED` and the saga releases the stock).
