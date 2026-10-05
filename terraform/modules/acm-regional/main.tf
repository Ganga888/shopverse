# Certificate for the API ALB (api.<env domain>) and ops tools (*.<env domain>)
# in the cluster region. Referenced by alb.ingress.kubernetes.io/certificate-arn.
resource "aws_acm_certificate" "this" {
  domain_name               = "api.${var.env_domain}"
  subject_alternative_names = ["*.${var.env_domain}"]
  validation_method         = "DNS"

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  tags = merge(var.tags, { Name = "api.${var.env_domain}" })

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # Keys are static (known at plan); record values come from the certificate.
  dvo = { for d in aws_acm_certificate.this.domain_validation_options : d.domain_name => d }
}

resource "aws_route53_record" "validation" {
  for_each = toset(["api.${var.env_domain}", "*.${var.env_domain}"])

  zone_id         = var.zone_id
  name            = local.dvo[each.key].resource_record_name
  type            = local.dvo[each.key].resource_record_type
  ttl             = 300
  records         = [local.dvo[each.key].resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}
