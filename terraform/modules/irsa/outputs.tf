output "role_arns" {
  description = "All IRSA role ARNs keyed by role key."
  value       = { for k, r in aws_iam_role.this : k => r.arn }
}

output "aws_load_balancer_controller_role_arn" {
  value = aws_iam_role.this["aws-load-balancer-controller"].arn
}

output "external_dns_role_arn" {
  value = aws_iam_role.this["external-dns"].arn
}

output "external_secrets_role_arn" {
  value = aws_iam_role.this["external-secrets"].arn
}

output "velero_role_arn" {
  value = aws_iam_role.this["velero"].arn
}

output "ebs_csi_role_arn" {
  value = aws_iam_role.this["ebs-csi"].arn
}

output "media_service_role_arn" {
  value = aws_iam_role.this["media-service"].arn
}

output "audit_service_role_arn" {
  value = aws_iam_role.this["audit-service"].arn
}

output "notification_service_role_arn" {
  value = aws_iam_role.this["notification-service"].arn
}
