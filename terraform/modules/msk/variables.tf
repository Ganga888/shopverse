variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Client subnets, one per AZ. Broker count must be a multiple of len(subnet_ids)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  type = list(string)
}

variable "allow_unauthenticated_tls" {
  description = "Also expose TLS-only unauthenticated listener 9094 (migration aid; keep false in steady state)."
  type        = bool
  default     = false
}

variable "kafka_version" {
  type    = string
  default = "3.6.0"
}

variable "broker_instance_type" {
  type = string
}

variable "broker_count" {
  type = number
}

variable "broker_volume_size" {
  description = "EBS GiB per broker."
  type        = number
  default     = 100
}

variable "default_replication_factor" {
  type    = number
  default = 3
}

variable "min_insync_replicas" {
  type    = number
  default = 2
}

variable "default_partitions" {
  type    = number
  default = 6
}

variable "log_retention_hours" {
  type    = number
  default = 168
}

variable "secret_recovery_window_in_days" {
  type    = number
  default = 7
}

variable "cloudwatch_log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
