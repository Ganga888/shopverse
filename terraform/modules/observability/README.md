# `observability` module

CloudWatch alarms for the managed data tier, sent to the SNS topic `shopverse-<env>-alerts` (KMS encrypted).

- RDS: CPU > 80%, free storage, connections and freeable memory.
- ElastiCache, for each member node: EngineCPU, memory % and evictions.
- MSK: `KafkaDataLogsDiskUsed` > 80% per broker, and offline partitions.

Each family has a static enable flag, so plans work before the resources exist. In-cluster metrics (Prometheus/Alertmanager) are handled by GitOps.

## Usage

```hcl
module "observability" {
  source            = "../../modules/observability"
  name_prefix       = "shopverse-staging"
  alert_emails      = ["platform-team@ganga888.in"]
  enable_rds_alarms = true
  rds_instance_id   = module.rds[0].instance_id
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `alert_emails` | `list(string)` | no | Emails subscribed to the alerts topic (Alertmanager can also subscribe via HTTPS). |
| `enable_rds_alarms` | `bool` | no | Static switch (managed data enabled). |
| `rds_instance_id` | `string` | no |  |
| `rds_max_connections_threshold` | `number` | no |  |
| `rds_free_storage_threshold_bytes` | `number` | no |  |
| `enable_elasticache_alarms` | `bool` | no |  |
| `elasticache_member_cluster_ids` | `list(string)` | no |  |
| `enable_msk_alarms` | `bool` | no |  |
| `msk_cluster_name` | `string` | no |  |
| `msk_broker_count` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `alerts_topic_arn` |  |
