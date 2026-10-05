# `msk` module

Amazon MSK (Kafka 3.6.0) with SASL/SCRAM over TLS.

- Clients authenticate with SASL/SCRAM-SHA-512 on port **9096** (TLS). Brokers talk to each other over TLS. At-rest encryption uses a CMK.
- SCRAM credentials are stored in the secret **`AmazonMSK_shopverse_<env>_app`** (MSK requires the `AmazonMSK_` prefix and a CMK) with keys `username,password,brokers,mechanism,ssl`. External Secrets can read it.
- Broker config sets `auto.create.topics.enable=false`, `unclean.leader.election.enable=false`, and RF/min.insync/partitions from variables. Topics are created explicitly by GitOps/CI.
- Broker logs go to CloudWatch. Prometheus JMX and node exporters are on, and enhanced monitoring is `PER_TOPIC_PER_BROKER`.
- `allow_unauthenticated_tls = true` also opens the TLS-only listener 9094. It exists only as a migration aid.

## Usage

```hcl
module "msk" {
  source                     = "../../modules/msk"
  name_prefix                = "shopverse-prod"
  environment                = "prod"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.database_subnet_ids
  allowed_security_group_ids = [module.eks.node_security_group_id]
  broker_instance_type       = "kafka.m5.large"
  broker_count               = 3
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `environment` | `string` | yes |  |
| `vpc_id` | `string` | yes |  |
| `subnet_ids` | `list(string)` | yes | Client subnets, one per AZ. Broker count must be a multiple of len(subnet_ids). |
| `allowed_security_group_ids` | `list(string)` | yes |  |
| `allow_unauthenticated_tls` | `bool` | no | Also expose TLS-only unauthenticated listener 9094 (migration aid; keep false in steady state). |
| `kafka_version` | `string` | no |  |
| `broker_instance_type` | `string` | yes |  |
| `broker_count` | `number` | yes |  |
| `broker_volume_size` | `number` | no | EBS GiB per broker. |
| `default_replication_factor` | `number` | no |  |
| `min_insync_replicas` | `number` | no |  |
| `default_partitions` | `number` | no |  |
| `log_retention_hours` | `number` | no |  |
| `secret_recovery_window_in_days` | `number` | no |  |
| `cloudwatch_log_retention_days` | `number` | no |  |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `cluster_arn` |  |
| `cluster_name` |  |
| `bootstrap_brokers_sasl_scram` | Comma separated host:9096 list (KAFKA_BROKERS, KAFKA_SSL=true). |
| `scram_secret_name` |  |
| `scram_secret_arn` |  |
| `kms_key_arn` |  |
| `security_group_id` |  |
| `bootstrap_brokers_tls` | TLS listener (9094); only populated when allow_unauthenticated_tls = true. |
