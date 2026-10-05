data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  partition    = data.aws_partition.current.partition
  region       = data.aws_region.current.name
  state_bucket = coalesce(var.state_bucket_name, "${var.project}-tfstate-${local.account_id}")
}

################################################################################
# Route 53 public hosted zone
################################################################################

resource "aws_route53_zone" "root" {
  name    = var.root_domain
  comment = "${var.project} public zone - delegated from the registrar"
}

# CAA: only Amazon may issue certificates for the domain.
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.root.zone_id
  name    = var.root_domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issue \"amazonaws.com\"",
    "0 issuewild \"amazon.com\"",
  ]
}

################################################################################
# ACM certificate for CloudFront (must be us-east-1)
################################################################################

resource "aws_acm_certificate" "cloudfront" {
  provider = aws.us_east_1

  domain_name               = local.cloudfront_cert_domains[0]
  subject_alternative_names = slice(local.cloudfront_cert_domains, 1, length(local.cloudfront_cert_domains))
  validation_method         = "DNS"

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  cloudfront_cert_domains = [
    var.root_domain,
    "*.${var.root_domain}",
    "*.dev.${var.root_domain}",
    "*.staging.${var.root_domain}",
  ]
  cloudfront_dvo = { for d in aws_acm_certificate.cloudfront.domain_validation_options : d.domain_name => d }
}

# ganga888.in and *.ganga888.in share one validation record; allow_overwrite
# makes the duplicate idempotent. Keys are static so plan works on first run.
resource "aws_route53_record" "cloudfront_cert_validation" {
  for_each = toset(local.cloudfront_cert_domains)

  zone_id         = aws_route53_zone.root.zone_id
  name            = local.cloudfront_dvo[each.key].resource_record_name
  type            = local.cloudfront_dvo[each.key].resource_record_type
  ttl             = 300
  records         = [local.cloudfront_dvo[each.key].resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for r in aws_route53_record.cloudfront_cert_validation : r.fqdn]

  # Validation only completes once the registrar delegates to the NS records
  # in output.route53_name_servers.
  timeouts {
    create = "2h"
  }
}
