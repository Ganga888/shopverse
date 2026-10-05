# `rds` module

PostgreSQL 16 on RDS with per-service credentials.

- gp3 encrypted storage with a CMK and storage autoscaling. `multi_az` can be turned on or off. `backup_retention_period` sets the PITR window.
- Parameter group: `rds.force_ssl=1`, TLS >= 1.2, `pg_stat_statements`, slow-query and connection logging.
- `manage_master_user_password = true`: RDS generates the master password, stores it in Secrets Manager and rotates it.
- Performance Insights (KMS), enhanced monitoring (60s), CloudWatch log exports and IAM DB auth are all on.
- For every entry in `service_databases` the module writes a secret **`shopverse/<env>/rds/<service>`** with keys `username,password,host,port,dbname`.
  The module only creates these secrets. The GitOps db-init/migration job creates the Postgres roles and databases with those credentials, using the master secret (`master_user_secret_arn`).

## Usage

```hcl
module "rds" {
  source                     = "../../modules/rds"
  name_prefix                = "shopverse-prod"
  environment                = "prod"
  vpc_id                     = module.vpc.vpc_id
  db_subnet_group_name       = module.vpc.database_subnet_group_name
  allowed_security_group_ids = [module.eks.node_security_group_id]
  instance_class             = "db.r6g.large"
  multi_az                   = true
  backup_retention_period    = 14
  secrets_kms_key_arn        = module.secrets.kms_key_arn
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `environment` | `string` | yes |  |
| `vpc_id` | `string` | yes |  |
| `db_subnet_group_name` | `string` | yes |  |
| `allowed_security_group_ids` | `list(string)` | yes | Security groups allowed to connect on 5432 (EKS node SG, cluster primary SG). |
| `engine_version` | `string` | no | PostgreSQL major (or major.minor) version. |
| `instance_class` | `string` | yes |  |
| `allocated_storage` | `number` | no |  |
| `max_allocated_storage` | `number` | no | Storage autoscaling ceiling (GiB). |
| `multi_az` | `bool` | no |  |
| `backup_retention_period` | `number` | no | Days of automated backups / point-in-time recovery window. |
| `deletion_protection` | `bool` | no |  |
| `skip_final_snapshot` | `bool` | no |  |
| `performance_insights_retention_period` | `number` | no | 7 (free tier) or a multiple of 31 days. |
| `monitoring_interval` | `number` | no | Enhanced monitoring interval in seconds (0 disables). |
| `master_username` | `string` | no |  |
| `secrets_kms_key_arn` | `string` | yes | CMK for the per-service credential secrets. |
| `secret_recovery_window_in_days` | `number` | no |  |
| `service_databases` | `map(string)` | no | Postgres-using services => database name. A secret shopverse/<env>/rds/<service> is created for each. |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `endpoint` | host:port |
| `address` |  |
| `port` |  |
| `instance_id` |  |
| `instance_arn` |  |
| `security_group_id` |  |
| `kms_key_arn` |  |
| `master_user_secret_arn` | RDS-managed master credential secret (rotated by RDS). |
| `service_secret_names` |  |
| `service_secret_arns` |  |
