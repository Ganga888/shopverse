# `s3` module

Buckets `shopverse-<env>-{web,media,audit,velero,logs}`.

| bucket | encryption | notes |
|---|---|---|
| web | SSE-S3 | SPA build, read only by CloudFront OAC |
| media | SSE-S3 | presigned uploads (CORS), served by CloudFront OAC, Intelligent-Tiering after 30d |
| audit | SSE-KMS | Glacier at 90d, Deep Archive at 365d, optional Object Lock (GOVERNANCE) |
| velero | SSE-KMS | Velero backups, expire after `velero_retention_days` |
| logs | SSE-S3 | ALB access logs (`alb/` prefix), CloudFront logs, S3 server access logs |

Every bucket has versioning, Block Public Access and a deny-non-TLS policy. All buckets except `logs` send server access logs to `logs`.
Set `enable_cloudfront_oac` statically. The distribution ARNs come from `modules/cloudfront`; Terraform orders the resources without a cycle.

## Usage

```hcl
module "s3" {
  source                 = "../../modules/s3"
  name_prefix            = "shopverse-dev"
  force_destroy          = true
  web_distribution_arn   = module.cloudfront.web_distribution_arn
  media_distribution_arn = module.cloudfront.media_distribution_arn
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env>; buckets are <prefix>-{web,media,audit,velero,logs}. |
| `force_destroy` | `bool` | no | Allow terraform destroy to delete non-empty buckets (dev only). |
| `enable_cloudfront_oac` | `bool` | no | Static switch: add CloudFront OAC read statements to the web and media bucket policies. |
| `web_distribution_arn` | `string` | no | CloudFront distribution serving the SPA (OAC principal). |
| `media_distribution_arn` | `string` | no | CloudFront distribution serving media (OAC principal). |
| `media_cors_allowed_origins` | `list(string)` | no | Origins allowed to PUT to presigned media URLs. |
| `audit_retention_days` | `number` | no | Days audit archives are kept (transitioned to Glacier after 90). |
| `audit_object_lock_days` | `number` | no | Object Lock GOVERNANCE default retention in days for the audit bucket (0 = no object lock). |
| `logs_retention_days` | `number` | no |  |
| `velero_retention_days` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `bucket_names` |  |
| `bucket_arns` |  |
| `bucket_regional_domain_names` |  |
| `logs_bucket_domain_name` | For CloudFront logging_config. |
| `kms_key_arn` | CMK encrypting audit + velero buckets. |
