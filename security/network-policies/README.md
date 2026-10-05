# Reference NetworkPolicy set (namespace `shop`)

These manifests document the network model. They are **not** applied from this directory:

| Layer | Where it is actually applied |
|---|---|
| `00-default-deny.yaml`, `01-allow-dns.yaml` | `gitops/envs/<env>/platform/base/network-policies.yaml` (platform-base app) |
| `10-service-template.yaml` (per service) | rendered for every service by `charts/microservice/templates/networkpolicy.yaml` from `networkPolicy.*` values |
| dev `data` namespace policies | `gitops/envs/<env>/platform/base/network-policies.yaml` (dev only) |

Model: deny everything in `shop` (ingress and egress), then per service allow

- ingress on 8080 from `ingress-nginx` pods (north-south, after ALB + WAF),
- ingress on 8080 from `monitoring` (Prometheus scrape),
- ingress on 8080 from the listed caller services (`networkPolicy.callers`) - auth-service accepts
  all shop pods because every service fetches its JWKS,
- egress: DNS (kube-dns), 8080 to listed callee services + auth-service, Postgres 5432, Redis 6379,
  Kafka 9092 (plaintext, dev Strimzi) / 9094 (TLS, MSK) / 9096 (SASL/SCRAM, MSK), OTLP 4318 to the
  `tracing` namespace, HTTPS 443 (STS for IRSA, S3, SES, Secrets Manager, payment gateway).

In dev the datastore ports are additionally restricted to the `data` and `kafka` namespaces
(`networkPolicy.datastorePeers`). In staging/prod RDS/ElastiCache/MSK live outside the cluster and
are protected by their security groups (only the EKS node/pod security group may connect).

Kafka-driven flows (the saga) need no pod-to-pod rules: services only talk to the brokers.

Test a policy:

```bash
kubectl -n shop run np-test --rm -it --image=786896018375.dkr.ecr.ap-south-1.amazonaws.com/shopverse/cart-service:<sha> \
  --labels app.kubernetes.io/name=cart-service -- wget -qO- -T 3 http://catalog-service.shop:8080/healthz/ready
```
