################################################################################
# Environment secrets CMK - shared by every shopverse/<env>/* secret
################################################################################

resource "aws_kms_key" "secrets" {
  description             = "${var.name_prefix} Secrets Manager encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

################################################################################
# shopverse/<env>/auth/jwt  { private_key, public_key }
################################################################################

resource "tls_private_key" "jwt" {
  algorithm = "RSA"
  rsa_bits  = var.jwt_rsa_bits
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "shopverse/${var.environment}/auth/jwt"
  description             = "RS256 signing keypair for auth-service (JWKS served from the public key)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    private_key = tls_private_key.jwt.private_key_pem_pkcs8
    public_key  = tls_private_key.jwt.public_key_pem
  })
}

################################################################################
# shopverse/<env>/payment/gateway  { api_key }
# Terraform only creates the placeholder; the real key is set out-of-band:
#   aws secretsmanager put-secret-value --secret-id shopverse/<env>/payment/gateway \
#     --secret-string '{"api_key":"<real key>"}'
################################################################################

resource "aws_secretsmanager_secret" "payment_gateway" {
  name                    = "shopverse/${var.environment}/payment/gateway"
  description             = "Payment gateway API credentials (value managed outside Terraform)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "payment_gateway" {
  secret_id     = aws_secretsmanager_secret.payment_gateway.id
  secret_string = jsonencode({ api_key = "REPLACE_ME_OUT_OF_BAND" })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}

################################################################################
# shopverse/<env>/monitoring/alertmanager  { slack_webhook_url, smtp_username, smtp_password, email_to }
# Read by the Alertmanager ExternalSecret (gitops). Placeholder only; set real values out-of-band:
#   aws secretsmanager put-secret-value --secret-id shopverse/<env>/monitoring/alertmanager \
#     --secret-string '{"slack_webhook_url":"https://hooks.slack.com/...","smtp_username":"...","smtp_password":"...","email_to":"oncall@ganga888.in"}'
################################################################################

resource "aws_secretsmanager_secret" "alertmanager" {
  name                    = "shopverse/${var.environment}/monitoring/alertmanager"
  description             = "Alertmanager receivers (value managed outside Terraform)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "alertmanager" {
  secret_id = aws_secretsmanager_secret.alertmanager.id
  secret_string = jsonencode({
    slack_webhook_url = "https://hooks.slack.com/services/REPLACE/ME/OUT_OF_BAND"
    smtp_username     = "REPLACE_ME"
    smtp_password     = "REPLACE_ME"
    email_to          = "oncall@ganga888.in"
  })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}
