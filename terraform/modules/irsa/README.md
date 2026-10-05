# `irsa` module

IAM Roles for Service Accounts: one generic role implementation plus the platform/app roles.

Each role is named `<name_prefix>-<key>` and trusts exactly `system:serviceaccount:<namespace>:<sa>`.

| key | namespace/serviceaccount | permissions |
|---|---|---|
| aws-load-balancer-controller | kube-system/aws-load-balancer-controller | upstream LBC policy (`policies/aws-load-balancer-controller.json`) |
| external-dns | kube-system/external-dns | Route 53 changes on the ganga888.in zone |
| external-secrets | external-secrets/external-secrets | read `shopverse/<env>/*` + `AmazonMSK_shopverse_<env>_*`, decrypt via Secrets Manager |
| velero | velero/velero | EBS snapshots + velero bucket |
| ebs-csi | kube-system/ebs-csi-controller-sa | AmazonEBSCSIDriverPolicy + KMS grants |
| grafana | monitoring/kube-prometheus-stack-grafana | CloudWatch metrics/logs read (data source) |
| kyverno | kyverno/kyverno-admission-controller | ECR read on shopverse/* + `kms:GetPublicKey/Verify` on alias/shopverse-cosign |
| media-service | shop/media-service | RW on `shopverse-<env>-media` (presigned URLs) |
| audit-service | shop/audit-service | Put/Get (no delete) on `shopverse-<env>-audit` |
| notification-service | shop/notification-service | `ses:SendEmail` restricted by `ses:FromAddress` |

You can add more roles through `extra_roles = { key = { namespace, service_account, policy_json, managed_policy_arns } }`.
Pod annotation: `eks.amazonaws.com/role-arn: <role arn>`.

## Usage

```hcl
module "irsa" {
  source             = "../../modules/irsa"
  name_prefix        = "shopverse-dev"
  environment        = "dev"
  oidc_provider_arn  = module.eks.oidc_provider_arn
  oidc_provider      = module.eks.oidc_provider
  route53_zone_arns  = [data.aws_route53_zone.root.arn]
  velero_bucket_arn  = module.s3.bucket_arns["velero"]
  velero_kms_key_arn = module.s3.kms_key_arn
  media_bucket_arn   = module.s3.bucket_arns["media"]
  audit_bucket_arn   = module.s3.bucket_arns["audit"]
  audit_kms_key_arn  = module.s3.kms_key_arn
  ses_from_addresses = ["*@dev.ganga888.in"]
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | Role name prefix, shopverse-<env>. Roles are named <prefix>-<key>. |
| `oidc_provider_arn` | `string` | yes | EKS IRSA OIDC provider ARN. |
| `oidc_provider` | `string` | yes | OIDC issuer without https:// (module.eks.oidc_provider). |
| `environment` | `string` | yes | dev / staging / prod (used for the Secrets Manager path shopverse/<env>/*). |
| `route53_zone_arns` | `list(string)` | yes | Hosted zones ExternalDNS may change. |
| `secrets_kms_key_arns` | `list(string)` | no | CMKs encrypting shopverse/<env>/* secrets (External Secrets needs kms:Decrypt). |
| `additional_secret_arns` | `list(string)` | no | Extra secrets External Secrets may read (e.g. the RDS-managed master secret for the db-init job). |
| `additional_kms_key_arns` | `list(string)` | no | Extra CMKs External Secrets may decrypt through Secrets Manager (e.g. the RDS key). |
| `velero_bucket_arn` | `string` | yes |  |
| `velero_kms_key_arn` | `string` | yes |  |
| `media_bucket_arn` | `string` | yes |  |
| `audit_bucket_arn` | `string` | yes |  |
| `audit_kms_key_arn` | `string` | yes |  |
| `ses_identity_arns` | `list(string)` | no | SES identities notification-service may send from. Empty = all identities in the account/region. |
| `ses_from_addresses` | `list(string)` | yes | Allowed From addresses for notification-service (ses:FromAddress condition). |
| `extra_roles` | `map(object({` | no | Generic IRSA roles: key => { namespace, service_account, policy_json (optional), managed_policy_arns (optional) }. The role is named <name_prefix>-<key>. |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `role_arns` | All IRSA role ARNs keyed by role key. |
| `aws_load_balancer_controller_role_arn` |  |
| `external_dns_role_arn` |  |
| `external_secrets_role_arn` |  |
| `velero_role_arn` |  |
| `ebs_csi_role_arn` |  |
| `media_service_role_arn` |  |
| `audit_service_role_arn` |  |
| `notification_service_role_arn` |  |
