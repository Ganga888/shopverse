# Cost governance

## Principles

1. Every AWS resource carries the contract tags `Project=shopverse`, `Environment=<env>`,
   `Owner=platform-team`, `CostCenter=shopverse`, `ManagedBy=terraform` - Terraform `default_tags`,
   plus the same tags on resources created by controllers (ALB controller `defaultTags`, ALB Ingress
   `tags` annotation, Karpenter `EC2NodeClass.spec.tags`, gp3 StorageClass `tagSpecification_*`).
   Enforced by the tfsec custom check `CUS001` and AWS Organizations tag policies.
2. Activate these as **cost allocation tags** in the Billing console so Cost Explorer can group by
   `Environment` and `CostCenter`.
3. Every container has requests **and** limits (Kyverno `require-requests-limits`), so Kubecost can
   attribute node cost to services.

## Budgets and alerts (AWS Budgets, Terraform)

| Budget | Monthly limit (indicative) | Alerts |
|---|---|---|
| `shopverse-dev` | low (nightly destroy, spot only) | 80% forecast, 100% actual -> Slack + email |
| `shopverse-staging` | medium | 80% forecast, 100% actual |
| `shopverse-prod` | baseline x 1.2 | 80% / 100% / 120% actual; anomaly detection monitor on service level |

AWS Cost Anomaly Detection monitors per linked account and per `Environment` tag, daily summary to Slack.

## Kubecost (in-cluster allocation)

- Deployed in every env (`kubecost` namespace), reads the shared Prometheus (no second Prometheus).
- Label mapping: `app.kubernetes.io/name` -> product (service), `app.kubernetes.io/part-of` -> owner,
  `shopverse.io/env` -> environment.
- Access: `kubectl -n kubecost port-forward svc/kubecost-cost-analyzer 9090` -> http://localhost:9090
- Weekly review (platform-team, 30 min): top 5 services by cost, idle cost %, efficiency
  (usage / requests), spot share, abandoned PVCs.

## Requests / limits policy

| Rule | Why |
|---|---|
| CPU request = p95 usage over 14 days (Kubecost *Savings -> Request right-sizing*), min 50m | HPA percentages and bin-packing are based on requests |
| Memory request = p99 usage + 20%; memory limit 1.5-2x request; `NODE_OPTIONS` heap ~75% of limit | avoid OOMKills, keep pods packable |
| CPU limit = 2-4x request | Node.js bursts at startup; avoid throttling the event loop |
| Shop namespace `ResourceQuota` (`gitops/envs/<env>/platform/base/shop-quota.yaml`) | hard ceiling per env; raising it is a reviewed PR |
| `LimitRange` defaults | a container without resources still gets sane values (Kyverno blocks it in shop anyway) |

Right-sizing PRs edit `resources` in `gitops/envs/<env>/services/<svc>/values.yaml`; canaries
validate them like any release.

## Compute levers

- **Karpenter consolidation** (`WhenEmptyOrUnderutilized`) bin-packs continuously; prod holds a
  48 vCPU on-demand baseline and bursts on spot; dev is spot only.
- **Spot**: diversified c/m/r families gen > 5; spot-to-spot consolidation on; interruption queue
  `shopverse-<env>-karpenter` drains nodes gracefully.
- **dev nightly destroy** (`nightly-destroy-and-recreate.md`) saves ~60% of dev compute + NAT hours.
- **Savings Plans**: buy a 1-year Compute Savings Plan for ~70% of the steady prod on-demand
  baseline (RDS/ElastiCache reserved instances for prod data tier) once usage is stable for 3 months.
- Graviton (arm64) is a future lever: requires multi-arch images and an `arm64` requirement in the NodePools.

## Data and network levers

- Prometheus retention dev 3d / staging 7d / prod 15d; Elasticsearch ILM 7/14/30 days; Velero TTL
  30d (daily) / 48h (hourly) - longer retention is a cost decision, not a default.
- 1 NAT gateway in dev/staging, 3 only in prod (per-AZ resilience). Use VPC endpoints (S3 gateway,
  ECR, STS, Secrets Manager) to keep image pulls and AWS API calls off NAT.
- CloudFront in front of S3 web/media to cut S3 egress.
- Watch cross-AZ traffic (Kafka, RDS) in Kubecost *Network* once network costs are enabled.

## Monthly checklist

- [ ] Cost Explorer by `Environment`: within budget? anomalies explained?
- [ ] Kubecost: idle cost < 25% in prod; efficiency > 60%
- [ ] Unattached EBS volumes / old snapshots (Velero TTL working?)
- [ ] Untagged resources report (AWS Resource Groups Tag Editor / Config rule `required-tags`) = 0
- [ ] Spot interruption rate and fallback to on-demand acceptable
- [ ] Right-sizing PRs opened for the top 3 over-provisioned services
