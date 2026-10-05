# Rollback

Git is the source of truth: a rollback is a **git revert of the promote commit**. Argo Rollouts
abort/undo are the fast, in-cluster levers while that PR is in flight.

## Decision tree

```
Bad release detected
 |- canary still in progress (order/payment/catalog in staging/prod)?
 |     -> 1. abort the rollout (seconds), then 3. revert in Git
 |- fully promoted Rollout?          -> 2. undo (seconds), then 3. revert in Git
 |- plain Deployment (other services)? -> 3. revert in Git (ArgoCD syncs in ~1-3 min)
 |                                        (emergency: argocd app rollback, then revert)
 '- bad config/secret, not image?    -> revert that values/secret change the same way
```

## 1. Abort a canary (Argo Rollouts)

Automatic: the AnalysisTemplate (`success-rate >= 99%`, `p95 <= threshold`) fails -> the Rollout aborts
itself, traffic returns to stable, `RolloutAborted` alert fires. Manual:

```bash
kubectl argo rollouts -n shop get rollout order-service          # see step, weights, analysis runs
kubectl argo rollouts -n shop abort order-service                # 100% traffic back to stable now
```

After an abort the Rollout is `Degraded` and Git still points at the bad tag - do step 3, otherwise the
next sync retries the same canary.

## 2. Undo a fully promoted Rollout

```bash
kubectl argo rollouts -n shop history order-service              # revisions + image tags
kubectl argo rollouts -n shop undo order-service --to-revision=<n>
```
This starts a canary back to the previous ReplicaSet (still analysed). ArgoCD will show OutOfSync
until Git is reverted (selfHeal would re-apply the bad tag): **disable self-heal while undoing**
`argocd app set order-service --self-heal=false`, then do step 3 and re-enable it.

## 3. Git revert (always)

```bash
git fetch origin && git checkout -b revert-order-service-<sha>
git log --oneline -- gitops/envs/prod/services/order-service/values.yaml | head -5
git revert <promote-commit-sha>             # restores the previous image.tag
git push -u origin HEAD && gh pr create --fill --label rollback
```
Rollback PRs need one approval and skip the soak requirement. After merge:
`argocd app sync order-service` (or wait for auto-sync) and watch
`kubectl argo rollouts -n shop get rollout order-service --watch`.

Revert in every environment the bad tag reached (prod first, then staging). Do not "fix forward" in
prod during an incident unless the revert is impossible (e.g. irreversible migration, see below).

## 4. Emergency ArgoCD rollback (plain Deployments, Git unavailable)

```bash
argocd app history cart-service
argocd app set cart-service --sync-policy none          # stop auto-sync re-applying HEAD
argocd app rollback cart-service <history-id>
```
Then revert in Git and restore the sync policy:
`argocd app set cart-service --sync-policy automated --auto-prune --self-heal`.

## Database migrations

The `db-migrate` Job runs before the new pods (ArgoCD Sync wave -1). Rolling the image back does
**not** roll the schema back. Rules that keep rollback safe:

- Migrations are **expand/contract**: release N adds columns/tables (backward compatible), release
  N+1 starts using them, release N+2 removes old ones. Never rename/drop in the same release that
  stops using a column.
- If a migration itself is broken: fix forward with a new migration; for data damage use RDS PITR
  (`dr-restore.md` section C) for the affected database only.

## Kafka consumers

Rolled-back consumers re-process from their committed offsets; handlers are idempotent
(`processed_events`). If the bad version wrote poison messages, they land in `<topic>.dlq`; replay
them after the fix (Kafka lag dashboard -> DLQ panel).

## Verify

- RED dashboard: 5xx/latency back to baseline; deploy annotation shows the old version
- `kubectl -n shop get pods -L app.kubernetes.io/version`
- No `RolloutAborted` / burn-rate alerts firing
