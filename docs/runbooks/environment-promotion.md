# Environment promotion (dev -> staging -> prod)

The only thing that moves between environments is the **image tag** (the git SHA of the service
build). The same signed image digest runs in dev, staging and prod; only values differ.

```
merge to main (services/<svc>)
   -> CI: test, Sonar, scans, build, push ECR :<sha>, cosign sign + SBOM attest (KMS)
   -> promote workflow opens PR #1: gitops/envs/dev/services/<svc>/values.yaml image.tag=<sha>   (auto-merge)
        ArgoCD syncs dev (Deployment rolling update)
   -> promote workflow (manual dispatch or after dev smoke tests) opens PR #2: staging image.tag=<sha>
        1 approval; ArgoCD syncs staging (canary for order/payment/catalog)
        e2e + k6 smoke suite (tests/) against staging; soak >= 1 h
   -> promote workflow opens PR #3: prod image.tag=<sha>
        2 approvals (code owner + platform), change window, no active SEV1/SEV2,
        error budget not exhausted (SLOErrorBudgetExhausted not firing)
        ArgoCD syncs prod; canary 20% -> 50% -> 100% with Prometheus analysis
```

## The promote workflow

`.github/workflows` (owned by the CI part of the repo) runs, per service and target env:

```bash
yq -i '.image.tag = strenv(TAG)' gitops/envs/$TARGET/services/$SVC/values.yaml
git commit -m "promote($SVC): $TARGET -> $TAG"
gh pr create --base main --title "promote $SVC to $TARGET ($TAG)" --label promotion
```
It refuses to promote a tag to staging that is not currently running in dev, or to prod that is not
running in staging (reads `image.tag` of the lower env), and verifies the cosign signature before
opening the PR. Multiple services can be promoted together (one PR, one commit per service).

## Gates per environment

| Gate | dev | staging | prod |
|---|---|---|---|
| CI green + image signed | yes | yes | yes |
| Kyverno signature enforcement | Audit | Enforce | Enforce |
| PR approvals | auto-merge | 1 | 2 (CODEOWNERS) |
| Automated tests after sync | smoke | e2e + load smoke | synthetic probes |
| Progressive delivery | rolling | canary (order/payment/catalog) | canary + analysis |
| Sync window | always | always | deny Fri 18:00 - Mon 06:00 IST (manual sync allowed for fixes) |

## Watching a prod promotion

```bash
argocd app get order-service
kubectl argo rollouts -n shop get rollout order-service --watch
```
Grafana *Service RED overview*: the "Canary vs stable success rate" panel compares the two hashes.
If analysis fails the Rollout aborts automatically; follow `rollback.md` (revert the promote PR).

## Config changes (not image)

Changes to `env`, resources, autoscaling, secrets mapping in values files go through the same PR
flow, env by env, starting with dev. Chart changes (`charts/microservice`) affect **all**
environments at once because the ApplicationSet uses `main` - test them with
`helm template` against every env's values in CI and merge outside the prod change freeze.
For risky chart changes, pin prod to the previous chart revision first (set `targetRevision` of the
chart source in `gitops/envs/prod/apps/services-appset.yaml` to a tag), then roll forward.

## Hotfix path

1. Fix on a branch, merge to main (CI builds `<sha>`).
2. Promote directly with `--hotfix`: dev and staging PRs can be merged immediately after their syncs
   are healthy (no soak), prod still needs 2 approvals and the canary analysis.
3. During the prod freeze window, sync manually: `argocd app sync <svc>` (windows allow manual sync).

## Audit trail

Every environment change is a commit in `gitops/envs/<env>/` with the PR, approvers and CI run;
ArgoCD history (`argocd app history <svc>`) maps sync revisions to those commits.
