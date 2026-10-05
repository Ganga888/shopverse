# ShopVerse services

Fifteen Node.js 22 / TypeScript / Fastify 5 microservices plus a shared library, managed as one npm workspace.
Names, routes, datastores, topics and env vars follow [`docs/CONTRACT.md`](../docs/CONTRACT.md).

```
services/
├── libs/common/              shared runtime (@shopverse/common)
│   ├── src/config.ts         env loader (zod) – the contract env vars + per-service extras
│   ├── src/logger.ts         pino JSON logs with trace_id/span_id from the active span
│   ├── src/metrics.ts        prom-client registry, http_request_duration_seconds{route,method,status}, Kafka/outbox/breaker metrics
│   ├── src/tracing.ts        OpenTelemetry NodeSDK + auto-instrumentations, OTLP/HTTP (loaded with --import)
│   ├── src/server.ts         runService(): bootstrap, health, readiness, graceful SIGTERM shutdown
│   ├── src/kafka.ts          kafkajs (SSL/SASL toggles), idempotent producer, consumer with envelope validation,
│   │                         idempotency (processed_events / Redis), retries with backoff, DLQ (<topic>.dlq)
│   ├── src/outbox.ts         transactional outbox writer + relay (FOR UPDATE SKIP LOCKED)
│   ├── src/migrate.ts        plain-SQL migration runner (advisory lock, schema_migrations)
│   ├── src/auth.ts           JWT (RS256) verification via JWKS (jose) behind a circuit breaker
│   ├── src/breaker.ts        opossum circuit breaker + JSON HTTP client for service-to-service calls
│   ├── src/errors.ts         AppError, zod parse(), Fastify error handler
│   └── migrations/           outbox + processed_events (applied to every Postgres service first)
├── <service>/                src/, migrations/*.sql, test/*.test.ts, Dockerfile, sonar-project.properties
├── docker-compose.yml        local stack
├── local/                    postgres init script, nginx gateway (mimics ingress-nginx routing)
└── scripts/create-topics.sh  Kafka topics + DLQs
```

## Services

| Service | Route | Storage | Notes |
|---|---|---|---|
| auth-service | /api/v1/auth | Postgres `auth`, Redis | register/login/refresh/logout/me, RS256 signing, `/.well-known/jwks.json`, login lockout, emits `UserRegistered` |
| user-service | /api/v1/users | Postgres `users` | profile + addresses, provisioned from `users.events` |
| catalog-service | /api/v1/products | Postgres `catalog`, Redis | CRUD (admin), cache-aside with per-product keys + list generation counter invalidation, emits `catalog.events` |
| search-service | /api/v1/search | Postgres `search` | `tsvector` generated column + GIN, websearch syntax, version-guarded upserts from `catalog.events` |
| inventory-service | /api/v1/inventory | Postgres `inventory` | all-or-nothing reservation with `SELECT … FOR UPDATE` in product-id order; release/commit |
| cart-service | /api/v1/cart | Redis hash per user (7d TTL) | prices from catalog (breaker), coupons via promotion, cleared on `OrderConfirmed` |
| order-service | /api/v1/orders | Postgres `orders` | saga orchestrator: orders, order_items, saga_state, outbox, 5-minute timeout sweeper |
| payment-service | /api/v1/payments | Postgres `payments` | mock gateway behind a breaker, `Idempotency-Key` API, once-per-order authorization, void compensation |
| shipping-service | /api/v1/shipping | Postgres `shipping` | shipment per confirmed order, forward-only status updates, emits `shipping.events` |
| notification-service | /api/v1/notifications | Redis list + pub/sub | SSE stream (`?access_token=`), SES email when `SES_ENABLED=true` |
| review-service | /api/v1/reviews | Postgres `reviews` | one review per user/product, rating summary, emits `reviews.events` |
| promotion-service | /api/v1/promotions | Postgres `promotions` | coupon rules (percent/fixed, caps, window, usage limit), atomic redeem |
| recommendation-service | /api/v1/recommendations | Redis sorted sets | co-purchase counts, popular fallback, per-user recommendations |
| media-service | /api/v1/media | S3 `shopverse-<env>-media` | presigned PUT/GET, content-type/size allow-list, per-user key prefixes |
| audit-service | /api/v1/audit | Postgres `audit`, S3 `shopverse-<env>-audit` | consumes every `*.events` topic, archives gzipped JSONL batches (`events/dt=…/hour=…`) |

Every service exposes `GET /healthz/live` (process up), `GET /healthz/ready` (Postgres/Redis/Kafka reachable and not
draining) and `GET /metrics`.

## Order saga

```
POST /orders ─► PENDING ──StockReserved──► STOCK_RESERVED ──PaymentAuthorized──► CONFIRMED (OrderConfirmed)
                  │                              │
                  │ StockReservationFailed       │ PaymentFailed  → ReleaseStock
                  │ timeout → ReleaseStock       │ timeout        → ReleaseStock + VoidPayment
                  └──────────────► CANCELLED (OrderCancelled) ◄──┘
late StockReserved after cancel → ReleaseStock;  late PaymentAuthorized after cancel → VoidPayment
```

All commands/events are written to the `outbox` table in the same transaction as the state change and relayed to Kafka.
Consumers dedupe on the envelope `id` (`processed_events`), so redelivery is safe. Keys are the order id, so all
messages of one saga stay on one partition. The mock gateway declines token `tok_fail` and amounts ending in `.13`.

## Running locally

Prerequisites: Docker with Compose v2, Node 22.

```bash
cd services
npm ci                       # workspace install (generates nothing outside node_modules)
npm run build                # tsc -b: libs/common first, then every service
npm test                     # vitest unit tests (all workspaces)
npm run lint

docker compose up -d --build # postgres, redis, kafka (+ topic init), jaeger, 15 services, gateway
open http://localhost:8080   # web SPA + API at /api/v1/*
open http://localhost:16686  # Jaeger
```

Sample data (`SEED_SAMPLE_DATA=true` in compose): six products with 100 units of stock each and coupons `WELCOME10`
and `FLAT500`. Registering `admin@shopverse.local` grants the `admin` role (`ADMIN_EMAILS`).

```bash
# quick e2e from the shell
curl -s localhost:8080/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"Passw0rd!","name":"Me"}'
TOKEN=$(curl -s localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"Passw0rd!"}' | jq -r .accessToken)
curl -s localhost:8080/api/v1/products | jq '.items[0]'
```

The full end-to-end flow (including the compensation path) is in `tests/postman`; load tests are in `tests/k6`.

Each service can also run outside Docker against the compose infrastructure:

```bash
docker compose up -d postgres redis kafka kafka-init jaeger
cd order-service && SERVICE_NAME=order-service DB_HOST=localhost DB_NAME=orders DB_USER=shopverse DB_PASSWORD=shopverse \
  DB_SSL=false REDIS_URL=redis://localhost:6379 KAFKA_BROKERS=localhost:29092 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  JWKS_URL=http://localhost:8081/api/v1/auth/.well-known/jwks.json JWT_ISSUER=http://localhost:8080/api/v1/auth npm run dev
```

## Configuration

Common env vars (contract): `SERVICE_NAME, PORT, NODE_ENV, LOG_LEVEL, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
REDIS_URL, KAFKA_BROKERS, KAFKA_SSL, OTEL_EXPORTER_OTLP_ENDPOINT, JWT_ISSUER, JWKS_URL, AWS_REGION, S3_BUCKET`.

Additional knobs (all optional, sensible defaults):

| Variable | Default | Used by |
|---|---|---|
| `DB_SSL` | `true` when `NODE_ENV=production` | all Postgres services (set `false` for in-cluster dev Postgres) |
| `DB_SSL_CA_PATH` | `/etc/ssl/certs/rds-global-bundle.pem` (baked into images) | all Postgres services |
| `DB_POOL_MAX` | `10` | all Postgres services |
| `KAFKA_SASL_MECHANISM` / `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` | unset | SASL/SCRAM for MSK |
| `KAFKA_MAX_RETRIES` | `5` | consumers: attempts before `<topic>.dlq` |
| `SHUTDOWN_DELAY_MS` / `SHUTDOWN_TIMEOUT_MS` | `5000` / `25000` | all (keep below `terminationGracePeriodSeconds`) |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | ephemeral outside production | auth-service (`shopverse/<env>/auth/jwt`) |
| `ADMIN_EMAILS` | empty | auth-service |
| `PAYMENT_GATEWAY_API_KEY` | required | payment-service (`shopverse/<env>/payment/gateway`) |
| `CATALOG_URL` / `PROMOTION_URL` | `http://<svc>.shop:8080` | order, cart, review |
| `SAGA_TIMEOUT_MS` (or `SAGA_TIMEOUT_SECONDS`) / `SAGA_SWEEP_INTERVAL_MS` | `300000` / `15000` | order-service |
| `OUTBOX_POLL_INTERVAL_MS` | `250` | services with an outbox |
| `CACHE_TTL_SECONDS` | `300` | catalog-service (product cache) |
| `SES_ENABLED` (or `EMAIL_PROVIDER=ses`) / `SES_FROM_ADDRESS` (or `EMAIL_FROM`) | `false` / `no-reply@ganga888.in` | notification-service |
| `CDN_BASE_URL`, `MEDIA_MAX_BYTES`, `PRESIGN_TTL_SEC` (or `PRESIGNED_URL_TTL_SECONDS`) | – / 5 MiB / 300 | media-service |
| `ARCHIVE_ENABLED`, `ARCHIVE_INTERVAL_MS`, `ARCHIVE_BATCH_SIZE`, `AUDIT_RETENTION_DAYS` | true / 60000 / 5000 / 30 | audit-service |
| `SEED_SAMPLE_DATA` | `false` | catalog, inventory, promotion |

## Container images

Each `Dockerfile` builds with `services/` as context so `libs/common` is included:

```bash
docker build -f order-service/Dockerfile -t shopverse/order-service:$(git rev-parse --short HEAD) .
```

Multi-stage: `node:22-alpine` builder (`npm ci -w <svc>`, `tsc -b`, prod-only reinstall) → `node:22-alpine` runtime
with npm removed, uid `10001`, `NODE_ENV=production`, port 8080, nothing written outside `/tmp`
(works with `readOnlyRootFilesystem: true` + an `emptyDir` at `/tmp`). Tracing is preloaded with
`node --import @shopverse/common/tracing dist/index.js`.

Kubernetes notes: SIGTERM → readiness fails immediately → wait `SHUTDOWN_DELAY_MS` for endpoint removal → Fastify stops
accepting and drains in-flight requests → Kafka consumer finishes its current message and commits → background loops
(outbox relay, saga sweeper, archiver) stop → producer, Postgres pool, Redis closed → spans flushed → exit 0.
