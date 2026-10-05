environment = "staging"
region      = "ap-south-1"
root_domain = "ganga888.in"

vpc_cidr               = "10.20.0.0/16"
az_count               = 3
one_nat_gateway_per_az = false # 1 NAT GW

cluster_version              = "1.31"
endpoint_public_access_cidrs = ["0.0.0.0/0"]

system_node_instance_types = ["t3.medium"]
system_node_capacity_type  = "ON_DEMAND"
system_node_min_size       = 2
system_node_max_size       = 3
system_node_desired_size   = 2
karpenter_capacity_types   = ["spot", "on-demand"]

use_managed_data = true

rds_instance_class                 = "db.t4g.medium"
rds_multi_az                       = false
rds_allocated_storage              = 50
rds_max_allocated_storage          = 200
rds_backup_retention_days          = 7
rds_deletion_protection            = true
rds_performance_insights_retention = 7

redis_node_type          = "cache.t4g.small"
redis_num_shards         = 1
redis_replicas_per_shard = 1

msk_instance_type       = "kafka.t3.small"
msk_broker_count        = 2
msk_volume_size         = 50
msk_replication_factor  = 2
msk_min_insync_replicas = 1
msk_default_partitions  = 3
# Clients authenticate with SASL/SCRAM on 9096 (secret AmazonMSK_shopverse_<env>_app).
# Services, KEDA and kafka-exporter all use SCRAM, so the unauthenticated TLS listener stays closed.
msk_allow_unauthenticated_tls = false

s3_force_destroy                = false
secret_recovery_window_in_days  = 7
enable_backup_cross_region_copy = false
cluster_log_retention_days      = 14

alert_emails = ["platform-team@ganga888.in"]
