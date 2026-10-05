# `acm-regional` module

DNS-validated ACM certificate in ap-south-1 for `api.<env domain>` + `*.<env domain>`.

It is used by the ALB (`alb.ingress.kubernetes.io/certificate-arn`) for the API and the ops tools (argocd, grafana, kibana, jaeger).
`env_domain` is `ganga888.in` for prod, `staging.ganga888.in` or `dev.ganga888.in` otherwise.

## Usage

```hcl
module "acm" {
  source     = "../../modules/acm-regional"
  env_domain = "staging.ganga888.in"
  zone_id    = data.aws_route53_zone.root.zone_id
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `env_domain` | `string` | yes | Environment domain: ganga888.in (prod), staging.ganga888.in, dev.ganga888.in. |
| `zone_id` | `string` | yes | Route 53 zone used for DNS validation. |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `certificate_arn` | Validated certificate ARN (alb.ingress.kubernetes.io/certificate-arn). |
| `domains` |  |
