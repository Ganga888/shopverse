# k6 performance tests

| Script | Model | Purpose |
|---|---|---|
| `smoke.js` | 1 VU, 5 iterations | post-deploy sanity: browse, cart and one full checkout saga |
| `load.js` | `ramping-arrival-rate`, browse 70% / cart 20% / checkout 10% | expected peak; gates **p95 < 500 ms** and **error rate < 1 %** |
| `stress.js` | stepped arrival rate to 125% of `PEAK_RPS` | find the breaking point, watch autoscaling |
| `soak.js` | `constant-arrival-rate` for `DURATION` (4h) | leaks: memory, DB connections, Kafka lag, outbox backlog |
| `spike.js` | 10 → 300 rps in 20 s and back | burst absorption and recovery time |

`lib/config.js` holds the base URL and thresholds, `lib/api.js` the API calls (tagged by endpoint `name` and `flow`),
`lib/flows.js` the three user journeys. The checkout journey polls `GET /orders/:id` until `CONFIRMED`/`CANCELLED`
and records `saga_completion_ms` plus `saga_outcome{status}`.

## Running

```bash
# local compose stack (gateway on :8080)
k6 run -e BASE_URL=http://localhost:8080 smoke.js

# dev / staging
k6 run -e BASE_URL=https://api.dev.ganga888.in smoke.js
k6 run -e BASE_URL=https://api.staging.ganga888.in -e TARGET_RPS=80 -e USERS=50 load.js
k6 run -e BASE_URL=https://api.staging.ganga888.in -e PEAK_RPS=400 stress.js
k6 run -e BASE_URL=https://api.staging.ganga888.in -e RATE=30 -e DURATION=4h soak.js
k6 run -e BASE_URL=https://api.staging.ganga888.in -e BASE_RPS=10 -e SPIKE_RPS=300 spike.js

# results to Prometheus (Grafana k6 dashboard) instead of only stdout
K6_PROMETHEUS_RW_SERVER_URL=https://prometheus.staging.ganga888.in/api/v1/write \
  k6 run -o experimental-prometheus-rw --tag testid=load-$(date +%s) load.js
```

Environment knobs: `BASE_URL`, `USERS` (test accounts created in `setup()`), `RUN_ID`, `PAYMENT_TOKEN`
(`tok_fail` drives every checkout down the compensation path), `TARGET_RPS`, `RAMP`, `HOLD`, `PEAK_RPS`, `RATE`,
`DURATION`, `BASE_RPS`, `SPIKE_RPS`.

Checkouts consume stock. Before long runs, top it up as an admin (a user whose email is in auth-service's `ADMIN_EMAILS`):

```bash
for id in $(curl -s "$BASE_URL/api/v1/products?limit=100" | jq -r '.items[].id'); do
  curl -s -X PUT "$BASE_URL/api/v1/inventory/$id" -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'content-type: application/json' -d '{"available": 1000000}' >/dev/null
done
```

Never run stress/spike/soak against prod. The test accounts use `@loadtest.ganga888.in` addresses so they can be
filtered or purged.

## Watching HPA and Karpenter scale

Run these in separate terminals while `load.js`, `stress.js` or `spike.js` is running:

```bash
# HPAs (CPU 70%) and replica counts in the app namespace
kubectl -n shop get hpa -w
kubectl -n shop get deploy,rollout -o wide -w

# KEDA (Kafka lag) for inventory/payment/shipping/notification/audit
kubectl -n shop get scaledobject
kubectl -n shop get hpa -l scaledobject.keda.sh/name -w

# Pod CPU/memory against requests
watch -n5 'kubectl -n shop top pods --sort-by=cpu | head -25'

# Pending pods trigger Karpenter: watch NodeClaims appear and nodes join (spot/on-demand, zone)
kubectl get nodeclaims -w
kubectl get nodes -L karpenter.sh/capacity-type,topology.kubernetes.io/zone,node.kubernetes.io/instance-type -w
kubectl -n kube-system logs -l app.kubernetes.io/name=karpenter -f | grep -Ei 'launched|registered|disrupt|consolidat'

# Scheduling pressure and evictions
kubectl -n shop get events --sort-by=.lastTimestamp -w | grep -Ei 'scaled|FailedScheduling|Evicted|Killing'
```

What a healthy run looks like:
1. CPU passes 70% of requests on the hot services (catalog, search, cart, order), and HPA adds replicas within about 1 minute.
2. New pods stay `Pending` only until Karpenter launches a NodeClaim (about 45–90 s for a new node), then they spread
   across zones (topologySpreadConstraints).
3. During checkout-heavy phases, Kafka consumer lag rises and KEDA scales inventory/payment/shipping. The
   `saga_completion_ms` p95 recovers once lag drains.
4. After the run, HPA scales down (default 5-minute stabilisation) and Karpenter consolidates empty or under-used nodes.

Useful Grafana and PromQL checks during a run:

```promql
histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket{namespace="shop"}[1m])))
sum by (service) (rate(http_request_duration_seconds_count{status=~"5.."}[1m])) / sum by (service) (rate(http_request_duration_seconds_count[1m]))
sum by (result) (rate(saga_completed_total[5m]))
sum by (name) (circuit_breaker_state)
sum by (topic, result) (rate(kafka_messages_consumed_total[1m]))
```
