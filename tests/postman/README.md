# Postman / Newman end-to-end suite

`shopverse.postman_collection.json` runs the full customer journey against a deployed environment, in order:

1. **Auth**: register (plus duplicate → 409), wrong password → 401, login, JWKS, `/me`, refresh rotation
   (reusing a rotated token → 401), protected route without a token → 401.
2. **Profile**: get the profile and add an address.
3. **Catalog and search**: list products, get one (cache-aside), 404/400 cases, full-text search
   (polls until the `catalog.events` projection has indexed the product), stock check.
4. **Cart and coupon**: clear, add two products, unknown product → 404, invalid coupon → 422, `WELCOME10` applied.
5. **Checkout, happy path**: create an order with an `Idempotency-Key`, replay it (→ the same order), **poll until
   `CONFIRMED`**, payment `AUTHORIZED`, shipment created, cart cleared, order history, `order_confirmed` notification.
6. **Checkout, compensation**: create an order with card token `tok_fail`, **poll until `CANCELLED`**
   (`failureReason=card_declined`, saga `COMPENSATED`), payment `FAILED`, stock restored by `ReleaseStock`,
   no shipment.
7. **Reviews, recommendations, media**: create a review (duplicate → 409, invalid rating → 400), list with a rating
   summary, co-purchase recommendation, presigned S3 upload URL, disallowed type → 400, product image as a customer → 403.
8. **Logout**: the refresh token is revoked.

Polling steps re-run themselves (`postman.setNextRequest`) with a 1-second pause, up to a limit, so eventual
consistency (Kafka consumers, saga) is asserted without fixed sleeps.

## Run with newman

```bash
npm i -g newman newman-reporter-htmlextra   # or: npx newman ...

newman run tests/postman/shopverse.postman_collection.json \
  -e tests/postman/dev.postman_environment.json \
  --bail failure --timeout-request 15000 \
  --reporters cli,junit,htmlextra \
  --reporter-junit-export reports/newman-dev.xml \
  --reporter-htmlextra-export reports/newman-dev.html
```

Environments: `dev`, `staging`, `prod` (`https://api.<env>.ganga888.in`) and `local` (`http://localhost:8080`,
the docker-compose gateway). Each set sets only `baseUrl` and `password`; the suite creates a fresh
`e2e-<timestamp>@example.com` user every run.

The suite expects the demo coupon `WELCOME10` (seeded when `SEED_SAMPLE_DATA=true`; in staging/prod create it once
through `POST /api/v1/promotions` as an admin) and at least two active, in-stock products.

In prod, run it as a post-deploy synthetic check only with the `prod` environment and a dedicated catalogue item, or
limit it to folders 01–04 (`--folder "01 Auth" --folder "03 Catalog & Search"`), because it places real orders.
