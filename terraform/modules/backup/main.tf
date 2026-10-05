################################################################################
# Vaults (primary region + optional DR region)
################################################################################

resource "aws_kms_key" "vault" {
  description             = "${var.name_prefix} AWS Backup vault"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_backup_vault" "this" {
  name        = "${var.name_prefix}-vault"
  kms_key_arn = aws_kms_key.vault.arn
  tags        = var.tags
}

resource "aws_kms_key" "dr" {
  count    = var.enable_cross_region_copy ? 1 : 0
  provider = aws.dr

  description             = "${var.name_prefix} AWS Backup DR vault"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_backup_vault" "dr" {
  count    = var.enable_cross_region_copy ? 1 : 0
  provider = aws.dr

  name        = "${var.name_prefix}-vault-dr"
  kms_key_arn = aws_kms_key.dr[0].arn
  tags        = var.tags
}

################################################################################
# Plan
################################################################################

resource "aws_backup_plan" "this" {
  name = "${var.name_prefix}-plan"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(30 20 * * ? *)" # 02:00 IST
    start_window      = 60
    completion_window = 360
    # PITR stays with the RDS-native automated backups (backup_retention_period);
    # AWS Backup adds daily/monthly snapshots and the cross-region copies.

    lifecycle {
      delete_after = var.daily_retention_days
    }

    dynamic "copy_action" {
      for_each = var.enable_cross_region_copy ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.dr[0].arn
        lifecycle {
          delete_after = var.cross_region_retention_days
        }
      }
    }

    recovery_point_tags = var.tags
  }

  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(0 21 1 * ? *)"
    start_window      = 60
    completion_window = 720

    lifecycle {
      cold_storage_after = 30
      delete_after       = max(var.monthly_retention_days, 120)
    }

    dynamic "copy_action" {
      for_each = var.enable_cross_region_copy ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.dr[0].arn
        lifecycle {
          cold_storage_after = 30
          delete_after       = max(var.monthly_retention_days, 120)
        }
      }
    }

    recovery_point_tags = var.tags
  }

  tags = var.tags
}

data "aws_iam_policy_document" "backup_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name_prefix}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "this" {
  name         = "${var.name_prefix}-selection"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resource_arns
}

resource "aws_backup_vault_notifications" "this" {
  count = var.enable_notifications ? 1 : 0

  backup_vault_name   = aws_backup_vault.this.name
  sns_topic_arn       = var.notification_topic_arn
  backup_vault_events = ["BACKUP_JOB_FAILED", "COPY_JOB_FAILED", "RESTORE_JOB_COMPLETED"]
}
