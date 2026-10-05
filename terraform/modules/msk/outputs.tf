output "cluster_arn" {
  value = aws_msk_cluster.this.arn
}

output "cluster_name" {
  value = aws_msk_cluster.this.cluster_name
}

output "bootstrap_brokers_sasl_scram" {
  description = "Comma separated host:9096 list (KAFKA_BROKERS, KAFKA_SSL=true)."
  value       = aws_msk_cluster.this.bootstrap_brokers_sasl_scram
}

output "scram_secret_name" {
  value = aws_secretsmanager_secret.scram.name
}

output "scram_secret_arn" {
  value = aws_secretsmanager_secret.scram.arn
}

output "kms_key_arn" {
  value = aws_kms_key.msk.arn
}

output "security_group_id" {
  value = aws_security_group.msk.id
}

output "bootstrap_brokers_tls" {
  description = "TLS listener (9094); only populated when allow_unauthenticated_tls = true."
  value       = aws_msk_cluster.this.bootstrap_brokers_tls
}
