# `elasticache` module

Redis 7 replication group with TLS and an AUTH token.

- With `num_shards > 1`, cluster mode is enabled (prod: 2 shards x 1 replica, Multi-AZ). With 1 shard it runs as primary + replicas (staging).
- In-transit encryption is set to `required`, at-rest uses a CMK, slow/engine logs go to CloudWatch, and snapshots are retained.
- Writes **`shopverse/<env>/redis`** with key `url` (`rediss://:<token>@<endpoint>:6379`) plus `host`, `port`, `auth_token`, `tls`, `cluster_mode`. When `cluster_mode=true`, clients must use a cluster-aware client such as ioredis `Cluster`.

## Usage

```hcl
module "elasticache" {
  source                     = "../../modules/elasticache"
  name_prefix                = "shopverse-staging"
  environment                = "staging"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.database_subnet_ids
  allowed_security_group_ids = [module.eks.node_security_group_id]
  node_type                  = "cache.t4g.small"
  num_shards                 = 1
  replicas_per_shard         = 1
  secrets_kms_key_arn        = module.secrets.kms_key_arn
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `environment` | `string` | yes |  |
| `vpc_id` | `string` | yes |  |
| `subnet_ids` | `list(string)` | yes | Subnets for the cache subnet group (database subnets). |
| `allowed_security_group_ids` | `list(string)` | yes |  |
| `engine_version` | `string` | no |  |
| `node_type` | `string` | yes |  |
| `num_shards` | `number` | no | Node groups (shards). >1 enables cluster mode. |
| `replicas_per_shard` | `number` | no |  |
| `multi_az` | `bool` | no |  |
| `snapshot_retention_limit` | `number` | no |  |
| `secrets_kms_key_arn` | `string` | yes |  |
| `secret_recovery_window_in_days` | `number` | no |  |
| `log_retention_days` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `replication_group_id` |  |
| `endpoint` | Primary (cluster mode disabled) or configuration (cluster mode enabled) endpoint. |
| `cluster_mode` |  |
| `member_cluster_ids` |  |
| `security_group_id` |  |
| `secret_arn` |  |
