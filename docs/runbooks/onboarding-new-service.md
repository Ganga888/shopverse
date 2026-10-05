# Onboarding a new microservice

Example: adding `wishlist-service` (route `/api/v1/wishlist`, Postgres `wishlist`, consumes `catalog.events`).
Everything is a PR; nothing is created by hand.

## 1. Contract first

Add the service to `docs/CONTRACT.md` (route prefix, datastore, produced/consumed topics). Reviewers:
platform-team + owners of the topics it consumes. Names follow `<noun>-service`; consumer group = service name.

## 2. Code (services/)

Copy an existing service skeleton. Mandatory:

- Fastify on port **8080**; `GET /healthz/live`, `GET /healthz/ready` (checks DB/Kafka), `GET /metrics`
- `http_request_duration_seconds` histogram (`method`, `route`, `status_code`) - alerts, SLOs and canary
  analysis depend on it (`observability/README.md`)
- pino JSON logs with `trace_id`, `span_id`, `correlationId`; OTel SDK exporting to `OTEL_EXPORTER_OTLP_ENDPOINT`
- read config only from the contract env vars; no secrets in code or images
- Dockerfile: non-root uid 10001, works with a read-only root filesystem (write only to `/tmp`)
- migrations runnable as `node dist/migrate.js` (chart `migration.command`), expand/contract only
- idempotent consumers (`processed_events`), dead letters to `<topic>.dlq`

## 3. AWS (terraform/)

- ECR repository `shopverse/wishlist-service` (immutable tags, scan on push)
- RDS database/user + secret `shopverse/<env>/rds/wishlist-service` (keys username, password, host, port, dbname)
- IRSA role `shopverse-<env>-wishlist-service` **only if** it calls AWS APIs
- MSK topics if it produces new ones (+ `.dlq`); dev topics go in `gitops/envs/dev/platform/kafka/topics.yaml`

## 4. CI (.github/, ci/)

Add the service to the build matrix: lint/test -> Sonar -> dependency scan -> build -> Trivy -> SBOM ->
push -> cosign sign/attest (KMS). Kyverno rejects unsigned images in staging/prod.

## 5. GitOps values (one directory per env = one ArgoCD Application)

The `shopverse-services` ApplicationSet discovers `gitops/envs/<env>/services/*` automatically.

```bash
for env in dev staging prod; do
  mkdir -p gitops/envs/$env/services/wishlist-service
  cp gitops/envs/$env/services/review-service/values.yaml gitops/envs/$env/services/wishlist-service/values.yaml
done
```
Edit each copy:

```yaml
image:
  repository: 786896018375.dkr.ecr.ap-south-1.amazonaws.com/shopverse/wishlist-service
  tag: bootstrap                      # first real tag arrives via the promote workflow
ingress:
  enabled: true
  path: /api/v1/wishlist
externalSecrets:
  items:
    - name: db
      remoteKey: shopverse/<env>/rds/wishlist-service
      keys: { DB_USER: username, DB_PASSWORD: password }        # dev (+ DB_HOST/DB_NAME in env:)
      # staging/prod: DB_HOST: host, DB_PORT: port, DB_NAME: dbname, DB_USER: username, DB_PASSWORD: password
networkPolicy:
  callers: []                          # services that call it over HTTP
  egressToServices: [catalog-service]  # services it calls
  egress: { postgres: true, redis: false, kafka: true }
migration:
  enabled: true
# consumer? add KEDA:
keda:
  enabled: true
  topics: [catalog.events]
  lagThreshold: "50"
```
If another service calls it, add `wishlist-service` to that service's `networkPolicy.egressToServices`
and the caller to this service's `networkPolicy.callers`.

Validate locally:

```bash
for env in dev staging prod; do
  helm lint charts/microservice -f gitops/envs/$env/services/wishlist-service/values.yaml
  helm template wishlist-service charts/microservice -n shop -f gitops/envs/$env/services/wishlist-service/values.yaml | kubeconform -strict -summary
done
```
The values schema rejects wrong secret paths, unknown topic names, `:latest`, ports other than 8080
and relaxed security contexts.

## 6. Observability - automatic

ServiceMonitor, per-service PrometheusRule (5xx, p95, restarts, no ready pods), SLO burn-rate alerts,
dashboards (the `service` variable picks it up), logs and traces need no extra work. Add business
metrics/dashboards to `observability/grafana-dashboards` if useful.

## 7. Roll out

1. Merge -> dev deploys `bootstrap` tag until CI's first promote PR for dev.
2. Promote to staging and prod via the promote workflow (`environment-promotion.md`).
3. Consider `rollout.enabled: true` (canary) for revenue-critical services.

## Definition of done

- [ ] Contract updated, ECR + secrets + (IRSA) in Terraform
- [ ] Values in all three envs, lint/template/kubeconform green
- [ ] `/healthz/*` and `/metrics` respond; pod Ready in dev; appears on the RED dashboard
- [ ] Traces visible in Jaeger with `service.name=wishlist-service`; logs in Kibana with `trace_id`
- [ ] NetworkPolicy verified (callers can reach it, nothing else can)
- [ ] Runbook notes for service-specific failure modes added to its README
