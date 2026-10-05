output "replication_group_id" {
  value = aws_elasticache_replication_group.this.id
}

output "endpoint" {
  description = "Primary (cluster mode disabled) or configuration (cluster mode enabled) endpoint."
  value       = local.endpoint
}

output "cluster_mode" {
  value = local.cluster_mode
}

output "member_cluster_ids" {
  value = local.member_cluster_ids
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

output "secret_arn" {
  value = aws_secretsmanager_secret.redis.arn
}
