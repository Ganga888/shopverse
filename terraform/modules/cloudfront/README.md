# `cloudfront` module

CloudFront distributions and the CLOUDFRONT-scope WAF.

- **web**: S3 SPA origin through OAC. A CloudFront Function rewrites extension-less paths to `/index.html`, so API 404s are never rewritten. The `/api/*` behavior goes to the ALB origin `api.<env domain>` (https-only) with caching disabled and all viewer headers forwarded except Host.
- **media**: `cdn.<env domain>` -> media bucket via OAC.
- WAF (in us-east-1, so pass the `aws.us_east_1` provider): per-IP rate limit plus AWS managed IP reputation, Common (body-size rule set to count), KnownBadInputs and SQLi rule groups. Logs go to `aws-waf-logs-*` with Authorization/Cookie redacted.
- Route 53 A/AAAA alias records for every alias. TLS 1.2_2021, HTTP/2+3, PriceClass_200 (includes India).

## Usage

```hcl
module "cloudfront" {
  source    = "../../modules/cloudfront"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name_prefix                       = "shopverse-prod"
  zone_id                           = data.aws_route53_zone.root.zone_id
  acm_certificate_arn               = data.aws_acm_certificate.cloudfront.arn
  web_aliases                       = ["ganga888.in", "www.ganga888.in"]
  media_alias                       = "cdn.ganga888.in"
  web_bucket_regional_domain_name   = module.s3.bucket_regional_domain_names["web"]
  media_bucket_regional_domain_name = module.s3.bucket_regional_domain_names["media"]
  api_origin_domain                 = "api.ganga888.in"
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `zone_id` | `string` | yes | Route 53 hosted zone ID of ganga888.in. |
| `acm_certificate_arn` | `string` | yes | us-east-1 ACM certificate covering web_aliases and media_alias. |
| `web_aliases` | `list(string)` | yes | Hostnames of the SPA, e.g. ["ganga888.in", "www.ganga888.in"] or ["dev.ganga888.in"]. |
| `media_alias` | `string` | yes | Hostname for media, e.g. cdn.ganga888.in / cdn.dev.ganga888.in. |
| `web_bucket_regional_domain_name` | `string` | yes |  |
| `media_bucket_regional_domain_name` | `string` | yes |  |
| `api_origin_domain` | `string` | yes | DNS name of the API origin (the ALB, reached through api.<env domain> so its ACM cert matches). |
| `logs_bucket_domain_name` | `string` | no | Bucket for CloudFront standard logs (empty disables logging). |
| `price_class` | `string` | no | PriceClass_200 includes India edge locations. |
| `rate_limit_per_5min` | `number` | no | Requests per 5 minutes per IP before the WAF blocks. |
| `waf_log_retention_days` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `web_distribution_id` |  |
| `web_distribution_arn` |  |
| `web_distribution_domain_name` |  |
| `media_distribution_id` |  |
| `media_distribution_arn` |  |
| `waf_web_acl_arn` | CLOUDFRONT-scope web ACL (us-east-1). |
