environment = "prod"
region      = "ap-south-1"
dr_region   = "ap-south-2"
root_domain = "ganga888.in"

vpc_cidr               = "10.30.0.0/16"
az_count               = 3
one_nat_gateway_per_az = true # 3 NAT GWs, one per AZ

cluster_version = "1.31"
# Replace with office/VPN + CI runner egress CIDRs before go-live.
endpoint_public_access_cidrs = ["0.0.0.0/0"]

system_node_instance_types = ["m6i.large"]
system_node_capacity_type  = "ON_DEMAND"
system_node_min_size       = 3
system_node_max_size       = 4
system_node_desired_size   = 3
karpenter_capacity_types   = ["on-demand", "spot"]

use_managed_data = true

rds_instance_class                 = "db.r6g.large"
rds_multi_az                       = true
rds_allocated_storage              = 100
rds_max_allocated_storage          = 1000
rds_backup_retention_days          = 14 # PITR window
rds_deletion_protection            = true
rds_performance_insights_retention = 31

redis_node_type = "cache.r7g.large"
# Non-cluster mode (1 shard, primary + 2 replicas over 3 AZs): pub/sub and multi-key cart ops
# work with a plain Redis client. Scale up the node type before moving to cluster mode.
redis_num_shards         = 1
redis_replicas_per_shard = 2

msk_instance_type       = "kafka.m5.large"
msk_broker_count        = 3
msk_volume_size         = 500
msk_replication_factor  = 3
msk_min_insync_replicas = 2
msk_default_partitions  = 6
# Clients authenticate with SASL/SCRAM on 9096 (secret AmazonMSK_shopverse_<env>_app).
# Services, KEDA and kafka-exporter all use SCRAM, so the unauthenticated TLS listener stays closed.
msk_allow_unauthenticated_tls = false

s3_force_destroy                = false
audit_object_lock_days          = 365
secret_recovery_window_in_days  = 30
enable_backup_cross_region_copy = true
cluster_log_retention_days      = 90
waf_rate_limit_per_5min         = 2000

alert_emails = ["platform-team@ganga888.in"]
