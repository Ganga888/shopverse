output "web_acl_arn" {
  description = "Use in alb.ingress.kubernetes.io/wafv2-acl-arn."
  value       = aws_wafv2_web_acl.this.arn
}

output "web_acl_name" {
  value = aws_wafv2_web_acl.this.name
}
