output "kms_key_arn" {
  description = "CMK for shopverse/<env>/* secrets."
  value       = aws_kms_key.secrets.arn
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt.arn
}

output "jwt_public_key_pem" {
  value = tls_private_key.jwt.public_key_pem
}

output "payment_gateway_secret_arn" {
  value = aws_secretsmanager_secret.payment_gateway.arn
}

output "alertmanager_secret_arn" {
  value = aws_secretsmanager_secret.alertmanager.arn
}
