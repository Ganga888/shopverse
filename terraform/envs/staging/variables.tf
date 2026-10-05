################################################################################
# General
################################################################################

variable "environment" {
  description = "dev | staging | prod"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "dr_region" {
  description = "Region receiving AWS Backup copies (prod)."
  type        = string
  default     = "ap-south-2"
}

variable "root_domain" {
  type    = string
  default = "ganga888.in"
}

variable "alert_emails" {
  description = "Subscribers of the shopverse-<env>-alerts SNS topic."
  type        = list(string)
  default     = []
}

################################################################################
# Network
################################################################################

variable "vpc_cidr" {
  type = string
}

variable "az_count" {
  type    = number
  default = 3
}

variable "one_nat_gateway_per_az" {
  type    = bool
  default = false
}

################################################################################
# EKS
################################################################################

variable "cluster_version" {
  type    = string
  default = "1.31"
}

variable "endpoint_public_access_cidrs" {
  description = "Allow-list for the public EKS API endpoint (office/VPN egress, GitHub-hosted runners need 0.0.0.0/0 or self-hosted runners)."
  type        = list(string)
}

variable "system_node_instance_types" {
  type = list(string)
}

variable "system_node_capacity_type" {
  type    = string
  default = "ON_DEMAND"
}

variable "system_node_min_size" {
  type = number
}

variable "system_node_max_size" {
  type = number
}

variable "system_node_desired_size" {
  type = number
}

variable "karpenter_capacity_types" {
  description = "Capacity types for the default Karpenter NodePool (GitOps reads the output)."
  type        = list(string)
}

variable "cluster_admin_role_arns" {
  description = "Additional IAM roles with cluster-admin (break-glass / SSO admin role). The CI apply role is always added."
  type        = list(string)
  default     = []
}

variable "cluster_view_role_arns" {
  description = "IAM roles with read-only cluster access (e.g. SSO developer role)."
  type        = list(string)
  default     = []
}

variable "cluster_log_retention_days" {
  type    = number
  default = 30
}

################################################################################
# Data tier
################################################################################

variable "use_managed_data" {
  description = "true = RDS/ElastiCache/MSK. false (dev) = in-cluster Postgres/Redis/Strimzi deployed by GitOps; Terraform only writes the Secrets Manager entries pointing at them."
  type        = bool
}

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "rds_multi_az" {
  type    = bool
  default = false
}

variable "rds_allocated_storage" {
  type    = number
  default = 50
}

variable "rds_max_allocated_storage" {
  type    = number
  default = 200
}

variable "rds_backup_retention_days" {
  description = "Automated backup / PITR window."
  type        = number
  default     = 7
}

variable "rds_deletion_protection" {
  type    = bool
  default = true
}

variable "rds_performance_insights_retention" {
  type    = number
  default = 7
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_num_shards" {
  type    = number
  default = 1
}

variable "redis_replicas_per_shard" {
  type    = number
  default = 1
}

variable "msk_instance_type" {
  type    = string
  default = "kafka.t3.small"
}

variable "msk_broker_count" {
  type    = number
  default = 2
}

variable "msk_volume_size" {
  type    = number
  default = 100
}

variable "msk_replication_factor" {
  type    = number
  default = 2
}

variable "msk_min_insync_replicas" {
  type    = number
  default = 1
}

variable "msk_default_partitions" {
  type    = number
  default = 3
}

variable "msk_allow_unauthenticated_tls" {
  description = "Expose the TLS-only (9094) listener in addition to SASL/SCRAM (9096)."
  type        = bool
  default     = false
}

variable "in_cluster_postgres_host" {
  description = "Postgres host used in dev secrets when use_managed_data = false."
  type        = string
  default     = "postgresql.data.svc.cluster.local"
}

variable "in_cluster_redis_url" {
  description = "Redis URL used in dev secrets when use_managed_data = false."
  type        = string
  default     = "redis://redis-master.data.svc.cluster.local:6379/0"
}

################################################################################
# Storage / backup / misc
################################################################################

variable "s3_force_destroy" {
  type    = bool
  default = false
}

variable "audit_object_lock_days" {
  type    = number
  default = 0
}

variable "secret_recovery_window_in_days" {
  type    = number
  default = 7
}

variable "enable_backup_cross_region_copy" {
  type    = bool
  default = false
}

variable "waf_rate_limit_per_5min" {
  type    = number
  default = 2000
}
