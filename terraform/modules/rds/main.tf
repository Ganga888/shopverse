locals {
  identifier = "${var.name_prefix}-postgres"
  major      = split(".", var.engine_version)[0]
}

################################################################################
# KMS, networking, parameters
################################################################################

resource "aws_kms_key" "rds" {
  description             = "${local.identifier} storage / PI / master secret encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.identifier}"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_security_group" "rds" {
  name        = local.identifier
  description = "PostgreSQL access for ${var.name_prefix}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = local.identifier })
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  for_each = { for i, sg in var.allowed_security_group_ids : tostring(i) => sg }

  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from EKS"
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${local.identifier}-pg${local.major}-"
  family      = "postgres${local.major}"
  description = "${local.identifier} parameters (TLS enforced)"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "ssl_min_protocol_version"
    value = "TLSv1.2"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

################################################################################
# Enhanced monitoring role
################################################################################

data "aws_iam_policy_document" "monitoring_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  name               = "${local.identifier}-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

################################################################################
# Instance
################################################################################

resource "aws_db_instance" "this" {
  identifier     = local.identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  db_name  = "postgres"
  username = var.master_username
  port     = 5432

  # Master password generated, stored and rotated by RDS in Secrets Manager.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.rds.arn

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = var.multi_az
  parameter_group_name   = aws_db_parameter_group.this.name
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period  = var.backup_retention_period
  backup_window            = "19:30-20:30" # 01:00-02:00 IST
  maintenance_window       = "sun:21:00-sun:22:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.identifier}-final"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = var.performance_insights_retention_period

  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null

  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  iam_database_authentication_enabled = true
  auto_minor_version_upgrade          = true
  allow_major_version_upgrade         = false
  apply_immediately                   = false

  tags = merge(var.tags, { Backup = "true" })

  depends_on = [aws_iam_role_policy_attachment.monitoring]
}

################################################################################
# Per-service credentials: shopverse/<env>/rds/<service>
# The roles/databases themselves are created inside Postgres by the GitOps
# db-init job, which reads the master secret and these secrets.
################################################################################

resource "random_password" "service" {
  for_each = var.service_databases

  length           = 32
  special          = true
  override_special = "-_.~"
}

resource "aws_secretsmanager_secret" "service" {
  for_each = var.service_databases

  name                    = "shopverse/${var.environment}/rds/${each.key}"
  description             = "Postgres credentials for ${each.key} (database ${each.value})"
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_in_days
  tags                    = merge(var.tags, { Service = each.key })
}

resource "aws_secretsmanager_secret_version" "service" {
  for_each = var.service_databases

  secret_id = aws_secretsmanager_secret.service[each.key].id
  secret_string = jsonencode({
    username = replace(each.value, "-", "_")
    password = random_password.service[each.key].result
    host     = aws_db_instance.this.address
    port     = tostring(aws_db_instance.this.port)
    dbname   = each.value
  })
}
