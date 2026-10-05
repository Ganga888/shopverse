# Scaling: HPA, KEDA and Karpenter

Three layers, from fastest to slowest:

| Layer | Scales | Signal | Reaction time | Config |
|---|---|---|---|---|
| HPA | pods of HTTP services | CPU 70% / memory 80% of requests | 15-60 s | `autoscaling.*` in service values |
| KEDA | pods of Kafka consumers (inventory, payment, shipping, notification, audit) | consumer-group lag per topic + CPU/memory | `pollingInterval` 15 s | `keda.*` in service values |
| Karpenter | EC2 nodes | unschedulable pods | 45-90 s for a new node | `gitops/envs/<env>/platform/karpenter/` |

## HPA

Defaults (`charts/microservice/values.yaml`): scale up immediately (+100% or +4 pods per 30 s,
whichever is more), scale down slowly (-50% per minute after a 5 min stabilisation window).

Tuning guidance:

- Utilisation is relative to **requests**. If pods sit at 30% CPU but latency is bad, the bottleneck is
  elsewhere (DB, downstream) - do not lower the target, find it in Jaeger.
- Node.js is single-threaded: keep CPU requests <= 1 core and scale out, not up. Keep
  `NODE_OPTIONS=--max-old-space-size` at ~75% of the memory limit (set in values) or the pod is
  OOMKilled before V8 garbage-collects.
- `HPAMaxedOut` firing for 15 min -> raise `maxReplicas` (check the shop `ResourceQuota` and the
  NodePool CPU limit first).
- minReplicas: dev 2, staging 2, prod 3 (one per AZ; PDB `minAvailable` 2 in prod).

## KEDA (Kafka consumers)

The ScaledObject (`charts/microservice/templates/scaledobject.yaml`) creates the HPA `<svc>-keda`
with one `kafka` trigger per consumed topic plus CPU/memory triggers. Desired replicas =
`ceil(total lag / lagThreshold)` (per topic, max across triggers), capped by partitions because
`allowIdleConsumers: false`.

| Knob | Meaning | Current |
|---|---|---|
| `lagThreshold` | target lag per replica | dev 20, staging 50, prod 100 |
| `activationLagThreshold` | lag needed to scale from min | 5 |
| `maxReplicaCount` | upper bound - **never above the topic partition count** (prod 6, dev 3) or extra pods idle | dev 4, staging 8, prod 20 |
| `minReplicaCount` | floor (= PDB-compatible) | 2/2/3 |

Tuning: if `KafkaConsumerLagHigh` fires while replicas == partitions, more pods will not help -
increase partitions (Terraform for MSK, `KafkaTopic` for dev; consumers rebalance automatically) or
make the handler faster (batching, DB indexes). Check `keda_scaler_errors_total` if replicas do not move
(TLS/brokers reachability, consumer group name == service name).

Pause a consumer (e.g. during a DB restore):
```bash
kubectl -n shop annotate scaledobject payment-service autoscaling.keda.sh/paused-replicas=0 --overwrite
kubectl -n shop annotate scaledobject payment-service autoscaling.keda.sh/paused-replicas-     # resume
```

## Karpenter

- `EC2NodeClass default`: AL2023, gp3 50 GiB encrypted, IMDSv2 hop limit 1, subnets/SGs by
  `karpenter.sh/discovery=shopverse-<env>`.
- NodePools: dev `general` (spot only, consolidate after 30 s); staging `general` (spot + on-demand);
  prod `on-demand-baseline` (weight 50, up to 48 vCPU on-demand) + `general` (weight 10, spot preferred)
  -> guaranteed on-demand floor, spot for bursts.
- Disruption: `WhenEmptyOrUnderutilized`, budget 10% of nodes; prod blocks underutilisation/drift
  disruption 09:00-21:00 IST. PDBs (chart) are respected; nodes are force-drained only after
  `terminationGracePeriod` 24h.
- Instance families c/m/r generation > 5, no nano/micro/small/metal, amd64.

Pending pods checklist:
```bash
kubectl get pods -A --field-selector=status.phase=Pending
kubectl get nodeclaims -o wide
kubectl -n kube-system logs deploy/karpenter | grep -Ei 'could not schedule|insufficient|limit'
kubectl get nodepool general -o jsonpath='{.status.resources}'
kubectl -n shop describe resourcequota shop-compute
```
Causes: NodePool `limits` reached (raise in Git), spot ICE (`general` falls back to on-demand outside
dev), quota exhausted, topology spread `DoNotSchedule` in prod with an AZ impaired (temporarily set
`topologySpread.zoneWhenUnsatisfiable: ScheduleAnyway` for the service).

## Capacity planning

Use *ShopVerse / Node & cluster capacity* (requests vs allocatable, spot share) and Kubecost
(`cost-governance.md`). Right-size requests quarterly from p95 usage over 14 days:
`quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{namespace="shop"}[5m])[14d:5m])`.

## Load test before big events

1. Scale minimums up the day before (PR on `autoscaling.minReplicas` / `keda.minReplicaCount`).
2. Pre-warm: raise NodePool limits; for MSK, check broker CPU < 60%.
3. Run the k6 suite (`tests/`) against staging at 2x expected peak; watch RED + saga funnel.
