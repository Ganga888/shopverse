output "certificate_arn" {
  description = "Validated certificate ARN (alb.ingress.kubernetes.io/certificate-arn)."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "domains" {
  value = concat([aws_acm_certificate.this.domain_name], tolist(aws_acm_certificate.this.subject_alternative_names))
}
