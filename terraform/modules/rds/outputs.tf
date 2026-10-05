output "endpoint" {
  description = "host:port"
  value       = aws_db_instance.this.endpoint
}

output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "instance_id" {
  value = aws_db_instance.this.identifier
}

output "instance_arn" {
  value = aws_db_instance.this.arn
}

output "security_group_id" {
  value = aws_security_group.rds.id
}

output "kms_key_arn" {
  value = aws_kms_key.rds.arn
}

output "master_user_secret_arn" {
  description = "RDS-managed master credential secret (rotated by RDS)."
  value       = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
}

output "service_secret_names" {
  value = { for k, s in aws_secretsmanager_secret.service : k => s.name }
}

output "service_secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.service : k => s.arn }
}
