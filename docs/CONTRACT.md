# ShopVerse platform contract (single source of truth for names)

Every part of the repo (Terraform, services, Helm, GitOps, CI, docs) MUST use the names below.

## Global
- Project / app name: `shopverse`  (resource prefix `shopverse-<env>`)
- AWS region: `ap-south-1` (Mumbai). CloudFront ACM cert + CloudFront WAF live in `us-east-1`.
- Account ID placeholder: `111122223333` (never hardcode real IDs; use variables / data sources).
- Environments: `dev`, `staging`, `prod`. Same Terraform modules + same Helm chart; only tfvars / values differ.
- Mandatory tags on every AWS resource: `Project=shopverse`, `Environment=<env>`, `Owner=platform-team`, `CostCenter=shopverse`, `ManagedBy=terraform`.
- Kubernetes app namespace: `shop` (label `pod-security.kubernetes.io/enforce=restricted`).
- Platform namespaces: `argocd`, `ingress-nginx`, `kube-system` (aws-load-balancer-controller, external-dns, karpenter), `external-secrets`, `monitoring`, `logging`, `tracing`, `keda`, `velero`, `kubecost`, `argo-rollouts`, `kyverno`, `kafka` (Strimzi, dev only), `data` (in-cluster Postgres/Redis, dev only).

## DNS (Route 53 hosted zone `ganga888.in`)
| Env | Web (CloudFront -> S3 SPA, /api/* -> ALB) | API (ALB + regional WAF) | Ops tools |
|---|---|---|---|
| prod | `ganga888.in`, `www.ganga888.in` | `api.ganga888.in` | `argocd.ganga888.in`, `grafana.ganga888.in`, `kibana.ganga888.in`, `jaeger.ganga888.in` |
| staging | `staging.ganga888.in` | `api.staging.ganga888.in` | `<tool>.staging.ganga888.in` |
| dev | `dev.ganga888.in` | `api.dev.ganga888.in` | `<tool>.dev.ganga888.in` |
- Media/images: `cdn.ganga888.in` (prod), `cdn.<env>.ganga888.in` -> CloudFront -> S3 media bucket.
- Traffic path: Client -> Route 53 -> (CloudFront + WAF) -> ALB (ACM TLS, regional WAF) -> ingress-nginx -> Service -> Pods.
  ALB is created by AWS Load Balancer Controller from an `alb` Ingress whose backend is the `ingress-nginx-controller` Service; ingress-nginx does path routing `/api/v1/<route>` -> service.
- ExternalDNS manages records; ACM certs validated via Route 53 DNS.

## Microservices (15) — Node.js 22 + TypeScript, Fastify
All listen on port `8080`. Endpoints on every service: `GET /healthz/live`, `GET /healthz/ready`, `GET /metrics` (Prometheus), plus API under `/api/v1/<route>`.
Image: `<account>.dkr.ecr.ap-south-1.amazonaws.com/shopverse/<service>:<git-sha>`. ECR repo name: `shopverse/<service>`.

| # | Service | Route prefix | Datastore | Kafka produces | Kafka consumes |
|---|---|---|---|---|---|
| 1 | auth-service | /api/v1/auth | Postgres `auth` + Redis (refresh tokens) | users.events (UserRegistered) | - |
| 2 | user-service | /api/v1/users | Postgres `users` | - | users.events |
| 3 | catalog-service | /api/v1/products | Postgres `catalog` + Redis cache | catalog.events | - |
| 4 | search-service | /api/v1/search | Postgres `search` (tsvector) | - | catalog.events |
| 5 | inventory-service | /api/v1/inventory | Postgres `inventory` | inventory.events | inventory.commands, orders.events |
| 6 | cart-service | /api/v1/cart | Redis | - | orders.events (clear cart) |
| 7 | order-service (saga orchestrator) | /api/v1/orders | Postgres `orders` (+ outbox table) | orders.events, inventory.commands, payments.commands | inventory.events, payments.events |
| 8 | payment-service | /api/v1/payments | Postgres `payments` (idempotency keys) | payments.events | payments.commands |
| 9 | shipping-service | /api/v1/shipping | Postgres `shipping` | shipping.events | orders.events |
| 10 | notification-service | /api/v1/notifications | Redis pub/sub (+ SES in prod) | - | orders.events, shipping.events, users.events |
| 11 | review-service | /api/v1/reviews | Postgres `reviews` | reviews.events | - |
| 12 | promotion-service | /api/v1/promotions | Postgres `promotions` | - | - |
| 13 | recommendation-service | /api/v1/recommendations | Redis | - | orders.events |
| 14 | media-service | /api/v1/media | S3 bucket `shopverse-<env>-media` (presigned URLs) | - | - |
| 15 | audit-service | /api/v1/audit | Postgres `audit` + S3 `shopverse-<env>-audit` archive | - | all `*.events` |
Plus `web` = static SPA (not a microservice) built to S3 `shopverse-<env>-web`, served by CloudFront.

## Configuration (env vars every service reads)
`SERVICE_NAME, PORT=8080, NODE_ENV, LOG_LEVEL, DB_HOST, DB_PORT=5432, DB_NAME, DB_USER, DB_PASSWORD, REDIS_URL, KAFKA_BROKERS (comma list), KAFKA_SSL (true for MSK), OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.tracing:4318, JWT_ISSUER=https://api.<domain>/api/v1/auth, JWKS_URL=http://auth-service.shop:8080/api/v1/auth/.well-known/jwks.json, AWS_REGION, S3_BUCKET`.
Secrets come ONLY from AWS Secrets Manager via External Secrets Operator. Secret paths: `shopverse/<env>/rds/<service>` (keys `username`,`password`,`host`,`port`,`dbname`), `shopverse/<env>/redis` (key `url`), `shopverse/<env>/auth/jwt` (keys `private_key`,`public_key`), `shopverse/<env>/payment/gateway` (key `api_key`). ClusterSecretStore name: `aws-secrets-manager`.

## Kafka
Topics (6 partitions prod / 3 dev, RF 3 prod / 1 dev): `users.events, catalog.events, orders.events, inventory.commands, inventory.events, payments.commands, payments.events, shipping.events, reviews.events` + `<topic>.dlq` dead letter topics.
Envelope (CloudEvents-style JSON): `{ "id", "type", "source", "time", "correlationId", "data" }`. `correlationId` = sagaId = orderId.
Consumer group = service name. Producers use idempotent producer; consumers are idempotent via `processed_events(id)` table.

## Order saga (orchestration by order-service, transactional outbox)
1. POST /api/v1/orders -> order `PENDING`, outbox: `OrderCreated` (orders.events) + `ReserveStock` (inventory.commands).
2. inventory -> `StockReserved` | `StockReservationFailed` (inventory.events).
3. on StockReserved -> order `STOCK_RESERVED`, send `AuthorizePayment` (payments.commands).
4. payment -> `PaymentAuthorized` | `PaymentFailed` (payments.events).
5. PaymentAuthorized -> order `CONFIRMED`, emit `OrderConfirmed`; inventory commits stock; shipping creates shipment; notification emails; cart cleared; recommendation updated.
6. Compensation: StockReservationFailed -> `CANCELLED`(OrderCancelled). PaymentFailed -> send `ReleaseStock` -> `CANCELLED`. Saga timeout 5 min -> compensate.

## Kubernetes conventions
- Helm chart: `charts/microservice` (generic). Release name == service name. Service DNS `<service>.shop.svc.cluster.local:8080`.
- Labels: `app.kubernetes.io/name=<service>`, `app.kubernetes.io/part-of=shopverse`, `app.kubernetes.io/version=<tag>`.
- ServiceAccount `<service>`, IRSA role `shopverse-<env>-<service>` (only media/audit/notification need AWS perms).
- Every pod: requests/limits, liveness+readiness+startup probes, runAsNonRoot uid 10001, readOnlyRootFilesystem, drop ALL caps, PDB minAvailable 1 (prod 2 replicas min), HPA cpu 70%, topologySpreadConstraints across zones.
- KEDA ScaledObject (Kafka lag) for consumers: inventory, payment, shipping, notification, audit.
- Argo Rollouts canary (20%->50%->100% with Prometheus analysis) for order-service, payment-service, catalog-service in staging/prod.
- GitOps layout: `gitops/envs/<env>/services/<service>/values.yaml` (image tag lives here), `gitops/envs/<env>/platform/`, ArgoCD app-of-apps `gitops/bootstrap/<env>-root.yaml`.

## Sizing defaults
- dev: 1 NAT GW, EKS system nodegroup 2x t3.medium, Karpenter spot; in-cluster Postgres/Redis/Strimzi (toggle `use_managed_data=false`); destroyed nightly.
- staging: 1 NAT, RDS db.t4g.medium single-AZ, ElastiCache cache.t4g.small 1 replica, MSK kafka.t3.small x2.
- prod: 3 NAT (one per AZ), 3 AZs, RDS db.r6g.large Multi-AZ + PITR, ElastiCache 2 shards x 1 replica Multi-AZ, MSK kafka.m5.large x3, Karpenter on-demand+spot mix.

## Integration decisions (reconciled after the first build)
- **Kafka auth:** staging/prod use MSK SASL/SCRAM-SHA-512 on 9096. Brokers + credentials live in Secrets Manager `AmazonMSK_shopverse_<env>_app` (keys `brokers`, `username`, `password`; the `AmazonMSK_` prefix is required by MSK). Services read `KAFKA_BROKERS`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` from that secret and `KAFKA_SSL=true`, `KAFKA_SASL_MECHANISM=scram-sha-512`. KEDA uses a TriggerAuthentication on the same Secret; kafka-exporter uses `kafka-exporter-scram`. The unauthenticated TLS listener (9094) is off (`msk_allow_unauthenticated_tls=false`). Dev Strimzi is plaintext 9092 inside the cluster.
- **Redis:** non-cluster replication group everywhere (prod: 1 shard, primary + 2 replicas over 3 AZs), `rediss://` URL with AUTH in `shopverse/<env>/redis`.
- **Databases:** Terraform writes `shopverse/<env>/rds/<service>`; the `db-init` Job (`gitops/envs/<staging|prod>/platform/db-init`, namespace `db-admin`) creates the roles and databases with the RDS-managed master secret. Services apply their own SQL migrations at startup (advisory-locked). Dev does the same through the Bitnami initdb script.
- **Metrics:** `http_request_duration_seconds{route,method,status}`, `orders_created_total`, `saga_completed_total{result}`.
- **Alertmanager receivers:** `shopverse/<env>/monitoring/alertmanager` (keys `slack_webhook_url`, `smtp_username`, `smtp_password`, `email_to`), placeholder created by Terraform, real values set out-of-band.
- **Image tags:** Jenkins owns `gitops/envs/dev/services/*/values.yaml`; `.github/workflows/promote.yml` owns staging and prod via PRs.
- **CI host:** Jenkins + SonarQube on EC2 from `terraform/ci` (CI VPC `10.50.0.0/16`, `https://jenkins.ganga888.in`, `https://sonarqube.ganga888.in`, admin-IP allowlist on the ALB). AWS access via the instance role `shopverse-ci-jenkins` (policy `shopverse-jenkins-ci`); Jenkins credentials in Secrets Manager `shopverse/ci/jenkins` (keys `JENKINS_ADMIN_PASSWORD`, `SONAR_DB_PASSWORD`, `GITHUB_USER`, `GITHUB_TOKEN`, `SONAR_TOKEN`). Configured by `ansible/playbooks/jenkins.yml` over SSM (`ansible/inventories/ci`).
