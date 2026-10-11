# ShopVerse Terraform

This directory holds all AWS infrastructure for ShopVerse. It is region `ap-south-1`; the CloudFront certificate and WAF live in `us-east-1`. Every name comes from [`docs/CONTRACT.md`](../docs/CONTRACT.md).

```
terraform/
├── backend.hcl        shared partial S3 backend config (bucket, S3 lock file, KMS)
├── bootstrap/         S3 state bucket + DynamoDB lock table (local state, run once)
├── global/            account-wide: Route 53 zone, ECR x15, GitHub OIDC + CI roles,
│                      cosign KMS key + jenkins-ci policy, CloudTrail, GuardDuty,
│                      Security Hub, Budgets + Cost Anomaly, CloudFront ACM cert
├── ci/                Jenkins + SonarQube EC2 host: CI VPC, ALB + ACM (jenkins./sonarqube.ganga888.in),
│                      instance role (ECR push + cosign), EBS data volume + daily snapshots
├── modules/           vpc eks karpenter irsa rds elasticache msk s3 cloudfront
│                      waf-regional acm-regional secrets observability backup
└── envs/{dev,staging,prod}/   identical main.tf; only terraform.tfvars + backend key differ
```

## Apply order

| # | Stack | State | What it does |
|---|---|---|---|
| 1 | `bootstrap/` | local | Creates the state bucket `shopverse-tfstate-<account>` (versioned, SSE-KMS, public access blocked, TLS-only) and a legacy lock table `shopverse-terraform-locks` (locking itself uses S3 lock files, `use_lockfile = true`). |
| 2 | `global/` | `global/terraform.tfstate` | Creates the shared account resources. **After the first apply, copy `route53_name_servers` to the registrar of ganga888.in.** The CloudFront certificate only validates once DNS is delegated. |
| 3 | `ci/` | `ci/terraform.tfstate` | Jenkins + SonarQube on EC2 (needs `admin_cidrs`; see `ci/jenkins/README.md`). |
| 3 | `envs/dev/` | `envs/dev/terraform.tfstate` | Dev environment (in-cluster data stores). |
| 4 | `envs/staging/` | `envs/staging/terraform.tfstate` | Staging (RDS, ElastiCache, MSK). |
| 5 | `envs/prod/` | `envs/prod/terraform.tfstate` | Prod (Multi-AZ, 3 NAT, cross-region backups). |

```bash
# 1. bootstrap (once per account, with an admin principal)
cd terraform/bootstrap
terraform init && terraform apply
terraform output -raw backend_hcl > ../backend.hcl      # replaces the placeholder account id

# 2. global
cd ../global
terraform init -backend-config=../backend.hcl
terraform apply -var 'github_repo=<owner>/shopverse' -var 'budget_alert_emails=["you@example.com"]'
terraform output route53_name_servers                    # -> registrar

# 3-5. environments
cd ../envs/dev
terraform init -backend-config=../../backend.hcl
terraform apply
```

After the first manual run, CI owns every apply (`.github/workflows/terraform.yml`):

- On a PR: `fmt`, `tflint`, `tfsec` and `checkov` run, `plan` runs per stack with the read-only role `shopverse-gha-plan`, and the plan is posted as a PR comment.
- On a merge to `main`: global, then ci and dev, then staging apply automatically with `shopverse-gha-apply`. Prod waits for the required reviewers on the GitHub `prod` environment.

Make the first `global` apply as a human admin. It creates the OIDC roles that CI uses afterwards. Then set the repository variable `AWS_ACCOUNT_ID` in GitHub.

## Wiring notes

- **EKS access**: `authentication_mode = API`. `shopverse-gha-apply` is always a cluster admin. Add humans through `cluster_admin_role_arns` (for example an SSO admin role).
- **Platform add-ons** (aws-load-balancer-controller, external-dns, external-secrets, karpenter, velero, ...) are installed by ArgoCD from `gitops/`. Terraform only creates their IAM. Read the values with `terraform output irsa_role_arns`, `karpenter`, `waf_regional_acl_arn` and `alb_certificate_arn`.
- **Secrets** (all encrypted with the environment CMK `alias/shopverse-<env>-secrets`):
  - `shopverse/<env>/rds/<service>`: `username,password,host,port,dbname`. In dev these point at the in-cluster Postgres (`postgresql.data.svc.cluster.local`).
  - `shopverse/<env>/redis`: `url` (plus host/port/auth_token/tls/cluster_mode).
  - `shopverse/<env>/auth/jwt`: `private_key,public_key`.
  - `shopverse/<env>/payment/gateway`: `api_key`. Terraform writes a placeholder; set the real value out of band.
  - `AmazonMSK_shopverse_<env>_app`: Kafka SASL/SCRAM `username,password,brokers` (staging/prod). MSK requires the `AmazonMSK_` prefix.
- **Databases/roles inside Postgres** are created by the GitOps db-init/migration job from the secrets above. Terraform cannot reach the private RDS endpoint from CI.
- **CI guard-rails**: `shopverse-gha-apply` has AdministratorAccess with explicit denies. It cannot stop or delete CloudTrail, delete the state backend, create IAM access keys or login profiles, touch Organizations, or change its own trust policy. Changes to the CI roles' trust (for example new GitHub environments) need a human admin apply of `global/`.
- **Image signing**: Jenkins signs with `cosign sign --key awskms:///alias/shopverse-cosign` using its EC2 instance role (`shopverse-ci-jenkins`, policy `shopverse-jenkins-ci`). No access key exists. The optional `jenkins-ci` IAM user (`create_jenkins_ci_user = true`) is only for a Jenkins outside AWS.

## Cost notes

Rough on-demand prices in ap-south-1, per month:

| Item | dev | staging | prod |
|---|---|---|---|
| EKS control plane | ~$73 (≈$37 with nightly destroy) | $73 | $73 |
| NAT gateways | 1 (≈$17 with nightly destroy) | 1 (~$35 + data) | 3 (~$105 + data) |
| System nodes | 2× t3.medium (only while up) | 2× t3.medium | 3× m6i.large |
| RDS | – (in-cluster) | db.t4g.medium single-AZ | db.r6g.large Multi-AZ |
| ElastiCache | – | 2× cache.t4g.small | 4× cache.r7g.large |
| MSK | – (Strimzi) | 2× kafka.t3.small | 3× kafka.m5.large |

- Dev runs `use_managed_data = false`, which removes about $300+/month of managed data services.
- The nightly destroy (below) cuts dev compute by about 50%. On weekends the morning recreate is skipped.
- Budgets (`global/budgets.tf`) alert at 50/80/100% actual and 100% forecast. Per-env budgets filter on the `Environment` cost allocation tag, which you must activate once in Billing → Cost allocation tags. Cost Anomaly Detection emails on anomalies of $25 or more. GuardDuty, Security Hub and the anomaly monitor are behind `enable_guardduty`, `enable_securityhub` and `create_cost_anomaly_monitor` / `cost_anomaly_monitor_arn`, because new or free-plan accounts reject the first two and AWS allows only one SERVICE anomaly monitor per account.
- An S3 gateway endpoint keeps ECR/S3 traffic off the NAT gateways.

## Nightly dev destroy (`.github/workflows/nightly-dev.yml`)

- **20:00 IST daily**: the workflow scales ArgoCD down, deletes the ALB ingresses and Karpenter NodePools (so the controllers remove the ALB and EC2 they created outside Terraform), then runs:

  ```bash
  terraform destroy -auto-approve \
    -target=module.eks -target=module.karpenter -target=module.irsa \
    -target=module.vpc.module.vpc.aws_nat_gateway.this -target=module.vpc.module.vpc.aws_eip.nat
  ```

  A final sweep terminates any EC2 instance still tagged `karpenter.sh/discovery=shopverse-dev`.
  The VPC, S3 buckets, secrets, CloudFront, WAF and ACM resources remain. They cost almost nothing and keep DNS and secrets stable.
- **08:00 IST Mon-Fri**: `terraform apply` recreates the cluster, installs ArgoCD and applies `gitops/bootstrap/dev-root.yaml`. ArgoCD then restores every workload. Dev data in the in-cluster Postgres is disposable seed data.
- You can also run either job manually (`workflow_dispatch`, action `destroy` | `create`).

## `terraform destroy` is the cost safety valve

When spend runs away, or an environment is no longer needed, destroy it:

```bash
cd terraform/envs/<env>
terraform destroy           # removes everything in that environment
```

- Staging and prod RDS have `deletion_protection = true`. Set `rds_deletion_protection = false` and apply first; a final snapshot is taken automatically.
- In prod, the audit bucket uses Object Lock (GOVERNANCE). Objects under retention need `s3:BypassGovernanceRetention` to delete.
- Delete Kubernetes-created AWS resources (ALB from Ingress, Karpenter EC2, EBS volumes from PVCs) first. Remove the Ingresses/NodePools/PVCs, or follow the same pre-destroy steps as the nightly workflow. Otherwise the VPC cannot be deleted.
- `global/` and `bootstrap/` are never destroyed casually. The state bucket and lock table have `prevent_destroy`.

## Local validation

```bash
terraform fmt -recursive -check
for d in bootstrap global ci envs/*; do (cd $d && terraform init -backend=false && terraform validate && terraform test); done
```

`terraform test` runs `tests/plan.tftest.hcl` in each stack: a full plan against **mocked** providers, so it needs no AWS credentials. It catches dependency cycles, unknown `for_each` keys and provider-side argument validation. CI runs it on every PR.

`modules/cloudfront` and `modules/backup` declare provider `configuration_aliases`. They are validated through the env stacks, not on their own.
