variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "alert_emails" {
  description = "Emails subscribed to the alerts topic (Alertmanager can also subscribe via HTTPS)."
  type        = list(string)
  default     = []
}

variable "enable_rds_alarms" {
  description = "Static switch (managed data enabled)."
  type        = bool
  default     = false
}

variable "rds_instance_id" {
  type    = string
  default = ""
}

variable "rds_max_connections_threshold" {
  type    = number
  default = 400
}

variable "rds_free_storage_threshold_bytes" {
  type    = number
  default = 10737418240 # 10 GiB
}

variable "enable_elasticache_alarms" {
  type    = bool
  default = false
}

variable "elasticache_member_cluster_ids" {
  type    = list(string)
  default = []
}

variable "enable_msk_alarms" {
  type    = bool
  default = false
}

variable "msk_cluster_name" {
  type    = string
  default = ""
}

variable "msk_broker_count" {
  type    = number
  default = 0
}

variable "tags" {
  type    = map(string)
  default = {}
}
