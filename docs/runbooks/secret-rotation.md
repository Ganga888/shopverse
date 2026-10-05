# Secret rotation

All application secrets live in **AWS Secrets Manager** and reach pods only through External Secrets
Operator (ESO) - nothing secret is stored in Git.

| Secret (contract path) | Keys | Consumers | Rotation |
|---|---|---|---|
| `shopverse/<env>/rds/<service>` | username, password, host, port, dbname | `<service>-db` Secret -> DB_* env | every 90 days (Secrets Manager rotation Lambda, alternating users) |
| `shopverse/<env>/redis` | url | `<service>-redis` -> REDIS_URL | 180 days (ElastiCache AUTH token rotate with `--auth-token-update-strategy ROTATE`) |
| `shopverse/<env>/auth/jwt` | private_key, public_key | auth-service `<svc>-jwt` | yearly or on compromise (key roll, below) |
| `shopverse/<env>/payment/gateway` | api_key | payment-service | per provider policy / on compromise |
| `shopverse/<env>/monitoring/alertmanager` | slack_webhook_url, smtp_username, smtp_password, email_to | Alertmanager config | on staff change / compromise |
| in-cluster generated (ESO Password generator) | Grafana admin, ES users, Jaeger basic auth, dev Postgres superuser | platform | delete the target Secret -> regenerated (see below) |

## How a change propagates

1. Secret value changes in Secrets Manager.
2. ESO refreshes every `refreshInterval` (1h for services) - or force it:
   ```bash
   kubectl -n shop annotate externalsecret order-service-db force-sync=$(date +%s) --overwrite
   ```
3. The Kubernetes Secret is updated. Env vars are read at process start, so pods must restart:
   ```bash
   kubectl -n shop rollout restart deployment/<svc>               # Deployments
   kubectl argo rollouts -n shop restart <svc>                     # order/payment/catalog in staging/prod
   ```
   (Changing the ExternalSecret *mapping* in values restarts pods automatically via the
   `checksum/secrets` annotation; a value-only change does not.)

## RDS credentials (zero downtime)

Use the Secrets Manager *alternating users* rotation strategy: the Lambda clones the user
(`order_svc` / `order_svc_clone`), sets a new password on the inactive one, then flips the secret.
Old pods keep working with the previous user until they restart, so:

1. Trigger: `aws secretsmanager rotate-secret --secret-id shopverse/prod/rds/order-service`
2. Wait for `AWSCURRENT` to move (`aws secretsmanager describe-secret ...`).
3. Force ESO sync + restart (above). Watch the RED dashboard for auth errors.

In dev the in-cluster Postgres roles are created from the same secrets by the initdb script on first
start only; after rotating a dev secret either wait for the nightly rebuild or run
`ALTER ROLE ... PASSWORD` manually.

## JWT signing key roll (auth-service)

Tokens are verified by every service through `JWKS_URL`, so roll in two steps:

1. Add the new key pair as *next* (the auth-service JWKS publishes both public keys; keep
   `private_key` = old). Deploy, wait > max token TTL of JWKS caches (15 min).
2. Swap: `private_key` = new, keep the old public key in JWKS until refresh tokens signed with it
   expire. Then remove the old key.

## Regenerating platform-internal passwords

```bash
kubectl -n monitoring delete secret grafana-admin           # ESO re-creates from the generator
kubectl -n monitoring rollout restart deploy/kube-prometheus-stack-grafana
kubectl -n logging delete secret es-user-fluentbit          # ECK reloads the file realm; restart fluent-bit
kubectl -n logging rollout restart ds/fluent-bit
```

## Certificates

- Public TLS: ACM, DNS-validated, auto-renews ~60 days before expiry. `TLSCertificateExpiringSoon`
  (blackbox probe < 21 days) means renewal failed: check the `_xxx.ganga888.in` validation CNAME in Route 53.
- ECK internal CA/certs: managed and rotated by the operator.
- cosign signing key: KMS key `alias/shopverse-cosign`; rotation = new key + update the Kyverno policy
  `kms:` reference + re-sign current images (`security/README.md`).

## Compromise checklist

1. Rotate immediately (above), restart consumers.
2. Revoke at the source (payment provider dashboard, Slack webhook, IAM access keys for SES SMTP).
3. CloudTrail: who read the secret (`GetSecretValue` events for `shopverse/<env>/...`).
4. Incident per `incident-response.md`.
