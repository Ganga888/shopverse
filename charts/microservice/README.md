# charts/microservice

Generic Helm chart used by all 15 ShopVerse microservices (see `docs/CONTRACT.md`).
One chart, per-environment values in `gitops/envs/<env>/services/<service>/values.yaml`.
**Release name == service name** and everything is installed into namespace `shop`.

## What it renders

| Template | Kind | When |
|---|---|---|
| `deployment.yaml` | Deployment (RollingUpdate, maxUnavailable 0) | `rollout.enabled=false` |
| `rollout.yaml` | Argo Rollout, canary 20% -> 50% -> 100% with analysis after each pause, nginx traffic routing | `rollout.enabled=true` |
| `analysistemplate.yaml` | AnalysisTemplate: canary success-rate >= `successRateThreshold` (0.99) and p95 <= `p95LatencyThreshold` from Prometheus | `rollout.enabled=true` |
| `service.yaml` | Service `<svc>` (stable), `<svc>-canary` (rollout only), headless `<svc>-metrics` (scrape target for stable+canary pods) | always |
| `serviceaccount.yaml` | ServiceAccount `<svc>`; IRSA annotation `arn:aws:iam::<account>:role/shopverse-<env>-<svc>` | `serviceAccount.irsa.enabled` (media, audit, notification) |
| `hpa.yaml` | HPA autoscaling/v2 on CPU 70% + memory | `autoscaling.enabled` and NOT `keda.enabled` |
| `scaledobject.yaml` | KEDA ScaledObject: one Kafka lag trigger per topic + cpu/memory triggers | `keda.enabled` (inventory, payment, shipping, notification, audit) |
| `pdb.yaml` | PodDisruptionBudget (`minAvailable` 1, prod 2) | `podDisruptionBudget.enabled` |
| `servicemonitor.yaml` | ServiceMonitor (job label = service name, `rollouts-pod-template-hash` as target label) | `metrics.serviceMonitor.enabled` |
| `prometheusrule.yaml` | Per-service alerts: high 5xx ratio, p95 latency, pod restarts, no ready pods | `prometheusRule.enabled` |
| `networkpolicy.yaml` | Ingress from ingress-nginx, monitoring and listed callers; egress DNS, 8080 to listed services + auth-service, 5432, 6379, 9092/9094/9096, OTLP 4318 (tracing ns), 443 | `networkPolicy.enabled` |
| `externalsecret.yaml` | One ExternalSecret per `externalSecrets.items[]` from ClusterSecretStore `aws-secrets-manager`; secret keys are env var names | `externalSecrets.enabled` |
| `configmap.yaml` | `<svc>-env` with contract env (SERVICE_NAME, PORT, NODE_ENV, LOG_LEVEL, OTEL_EXPORTER_OTLP_ENDPOINT, JWT_ISSUER, JWKS_URL, AWS_REGION) merged with `env` | always |
| `ingress.yaml` | nginx Ingress `api.<domain>` + `/api/v1/<route>` (also the Rollout stableIngress) | `ingress.enabled` |
| `migration-job.yaml` | DB migration Job (ArgoCD Sync hook wave -1 / helm post-install,pre-upgrade) | `migration.enabled` (services with Postgres) |

Pods always get: requests/limits, startup + liveness (`/healthz/live`) + readiness (`/healthz/ready`) probes,
uid/gid 10001, `runAsNonRoot`, `readOnlyRootFilesystem` (+ `/tmp` emptyDir), drop ALL capabilities,
`seccompProfile: RuntimeDefault` (restricted PSS), zone + hostname `topologySpreadConstraints`,
a `preStop` sleep so nginx/ALB drain before SIGTERM, and config/secret checksums for automatic restarts.

## ArgoCD sync ordering

| Wave | Resources |
|---|---|
| -2 | ConfigMap, ExternalSecrets |
| -1 | db-migrate Job (Sync hook, `BeforeHookCreation`) |
| 0 | everything else (Deployment/Rollout, Service, HPA/ScaledObject, ...) |

## Key values

| Key | Default | Notes |
|---|---|---|
| `global.env` / `global.domain` | `dev` / `dev.ganga888.in` | drive JWT_ISSUER, ingress host, IRSA ARN |
| `image.repository` | `<account>.dkr.ecr.ap-south-1.amazonaws.com/shopverse/<svc>` | |
| `image.tag` | `bootstrap` | bumped by the promote workflow; `latest` rejected by schema |
| `image.digest` | `""` | optional `sha256:` pin (Kyverno verifies signatures by digest) |
| `externalSecrets.items[]` | `[]` | `{name, remoteKey: shopverse/<env>/..., keys: {ENV_VAR: property}}` |
| `keda.topics` / `keda.lagThreshold` | `[]` / `"50"` | consumer group defaults to the service name |
| `rollout.analysis.successRateThreshold` | `0.99` | |
| `rollout.analysis.p95LatencyThreshold` | `0.5` (s) | |
| `networkPolicy.callers` / `egressToServices` | `[]` | service names in `shop` |
| `networkPolicy.datastorePeers` | `[]` | restricts 5432/6379/9092-9096 egress (dev: `data`, `kafka` namespaces) |

All keys are validated by `values.schema.json` (env enum, `*.ganga888.in` domain, secret paths under
`shopverse/<env>/`, topic names from the contract, restricted securityContext constants, port 8080).

## Metrics contract (what the services must expose on `GET /metrics`)

- `http_request_duration_seconds` histogram with labels `method`, `route`, `status`
  (used by alerts, canary analysis, RED dashboard, SLO rules).
- order-service: `orders_created_total`, `saga_completed_total{result="confirmed|cancelled|timed_out"}`.

## Usage

```bash
helm lint charts/microservice -f gitops/envs/prod/services/order-service/values.yaml
helm template order-service charts/microservice -n shop --kube-version 1.31 \
  -f gitops/envs/prod/services/order-service/values.yaml
```

In the cluster, ArgoCD renders it via the `services` ApplicationSet (multi-source: chart from
`charts/microservice`, values from `gitops/envs/<env>/services/<svc>/values.yaml`).
