# Incident response

## Severity

| Sev | Definition | Response | Examples |
|---|---|---|---|
| SEV1 | Checkout / login down or data loss in prod | page, all hands, IC within 5 min, status page within 15 min | SLOErrorBudgetBurnFast on order/payment/auth, `NoReadyPods`, RDS down |
| SEV2 | Degraded prod (latency, one non-critical service down, saga backlog) | page on-call, IC within 15 min | KafkaConsumerLagCritical, p95 alerts on catalog/search |
| SEV3 | Staging broken, prod issue with workaround | ticket, next business day | SLOErrorBudgetBurnSlow, PodOOMKilled |

Critical alerts go to Slack + email (Alertmanager route `slack-and-email-critical`); warnings to Slack.

## Roles

- **Incident Commander (IC)**: owns decisions and comms, does not debug.
- **Ops lead**: hands on keyboard; one person changes prod at a time.
- **Comms**: status page + stakeholder updates every 30 min (SEV1) / 60 min (SEV2).
- **Scribe**: timeline in the incident doc (UTC timestamps).

## First 15 minutes

1. Acknowledge the alert; open `#inc-<date>-<slug>`, post: what is broken, since when, who is IC.
2. **Was there a change?** Check in this order:
   - ArgoCD history: `argocd app history <svc>` / Grafana deploy annotations on the RED dashboard
   - Rollouts: `kubectl argo rollouts -n shop list rollouts` (a canary in progress? Degraded?)
   - Terraform / platform PRs merged in the last 2 h
   If yes -> **roll back first, debug later** (`rollback.md`).
3. Scope it: *ShopVerse / Service RED overview* (which service, which route, 5xx vs latency),
   *Order saga funnel* (is checkout affected?), *Kafka consumer lag*.
4. Follow a slow/failed request: RED p95 panel exemplar -> Jaeger trace -> "Logs for this span" (Kibana by `trace_id`).
   For an order: Kibana `correlationId:"<orderId>"`.

## Quick diagnostics

```bash
kubectl -n shop get pods -o wide | grep -v Running
kubectl -n shop describe pod <pod> | tail -30                 # events: OOMKilled, probes, image pull, Kyverno
kubectl -n shop logs deploy/<svc> --since=15m | jq -c 'select(.level>=50)' | head
kubectl -n shop get externalsecrets                          # SecretSyncedError?
kubectl get nodes -L karpenter.sh/capacity-type,topology.kubernetes.io/zone
kubectl -n kube-system logs deploy/karpenter --since=15m | grep -i error
kubectl get policyreport -n shop                              # Kyverno blocks
argocd app get <svc> --show-operation
```

| Symptom | Likely cause | Action |
|---|---|---|
| Pods `ImagePullBackOff` right after promote | tag not pushed / unsigned (Kyverno) | check CI run; `kubectl get events -n shop --field-selector reason=PolicyViolation`; revert the promote PR |
| `CrashLoopBackOff` + `secret ... not found` | ESO cannot read Secrets Manager (IRSA, path, KMS) | `kubectl -n shop describe externalsecret <svc>-db`; see `secret-rotation.md` |
| 5xx only on canary hash | bad release in canary | `kubectl argo rollouts -n shop abort <svc>` |
| Saga timeouts rising, lag on inventory/payment | consumer slow or crashed, MSK issue | scale (`scaling.md`), check DLQ, broker health in CloudWatch |
| Pending pods | Karpenter limits / ICE / quota | `kubectl get nodeclaims`, NodePool limits, `kubectl -n shop describe quota` |
| 502/504 from ALB | nginx -> pod connectivity, NetworkPolicy, all pods unready | `kubectl -n ingress-nginx logs deploy/ingress-nginx-controller`, check readiness |
| WAF blocks legit traffic | new WAF rule | AWS WAF sampled requests; switch rule to Count via Terraform |

## Mitigation toolbox

- Roll back / abort canary: `rollback.md`
- Scale out: `kubectl -n shop scale deploy/<svc> --replicas=N` (HPA will take over again), raise KEDA max (`scaling.md`)
- Shed load: WAF rate-based rule (Terraform) or nginx `limit-rps` annotation on the service Ingress via values PR
- Pause a consumer: `kubectl -n shop annotate scaledobject <svc> autoscaling.keda.sh/paused-replicas=0 --overwrite`
- Feature off: config flag in `env:` of the service values -> PR -> ArgoCD (checksum restarts pods)
- Emergency manual change: allowed for the IC only; disable selfHeal first
  (`argocd app set <svc> --self-heal=false`), then make the change, then back-port to Git and re-enable.

## Closing

1. Confirm recovery (RED back to baseline 30 min, burn alerts resolved, saga funnel normal).
2. Re-enable automation you paused (selfHeal, ScaledObjects, sync windows).
3. Post-incident review within 5 business days (blameless): timeline, impact (orders lost/delayed,
   error budget consumed), root cause, what went well, action items with owners and due dates.
