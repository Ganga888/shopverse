# `waf-regional` module

REGIONAL WAFv2 web ACL for the API ALB.

It uses the same managed rule groups as the CloudFront ACL. The rate limit keys on `X-Forwarded-For` because traffic arrives through CloudFront. Logs go to CloudWatch.
Attach it from the ALB Ingress:

```yaml
alb.ingress.kubernetes.io/wafv2-acl-arn: <web_acl_arn output>
```

## Usage

```hcl
module "waf_regional" {
  source      = "../../modules/waf-regional"
  name_prefix = "shopverse-dev"
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `rate_limit_per_5min` | `number` | no |  |
| `log_retention_days` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `web_acl_arn` | Use in alb.ingress.kubernetes.io/wafv2-acl-arn. |
| `web_acl_name` |  |
