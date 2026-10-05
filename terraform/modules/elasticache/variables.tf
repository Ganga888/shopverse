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
  description = "Subnets for the cache subnet group (database subnets)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  type = list(string)
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "node_type" {
  type = string
}

variable "num_shards" {
  description = "Node groups (shards). >1 enables cluster mode."
  type        = number
  default     = 1
}

variable "replicas_per_shard" {
  type    = number
  default = 1
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "snapshot_retention_limit" {
  type    = number
  default = 3
}

variable "secrets_kms_key_arn" {
  type = string
}

variable "secret_recovery_window_in_days" {
  type    = number
  default = 7
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
