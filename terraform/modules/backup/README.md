# `backup` module

AWS Backup for RDS: a daily rule (`daily_retention_days`) and a monthly rule (cold storage after 30d), with an optional cross-region copy to a vault in `aws.dr`.

PITR stays with RDS automated backups (`backup_retention_period`). This module adds longer-lived snapshots and the DR copies.
Vault notifications (failed backup/copy jobs) go to the alerts topic. The module requires an `aws.dr` provider even when the copy is off.

## Usage

```hcl
module "backup" {
  source    = "../../modules/backup"
  providers = { aws = aws, aws.dr = aws.dr }

  name_prefix              = "shopverse-prod"
  resource_arns            = [module.rds[0].instance_arn]
  enable_cross_region_copy = true
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `resource_arns` | `list(string)` | yes | Resources to protect (RDS instance ARN). |
| `daily_retention_days` | `number` | no |  |
| `monthly_retention_days` | `number` | no |  |
| `enable_cross_region_copy` | `bool` | no | Copy recovery points to the DR region vault (prod). |
| `cross_region_retention_days` | `number` | no |  |
| `enable_notifications` | `bool` | no | Static switch for vault notifications. |
| `notification_topic_arn` | `string` | no | SNS topic for backup job failures (used when enable_notifications). |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `vault_arn` |  |
| `dr_vault_arn` |  |
| `plan_id` |  |
