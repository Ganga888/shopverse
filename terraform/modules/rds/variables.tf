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

variable "db_subnet_group_name" {
  type = string
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to connect on 5432 (EKS node SG, cluster primary SG)."
  type        = list(string)
}

variable "engine_version" {
  description = "PostgreSQL major (or major.minor) version."
  type        = string
  default     = "16"
}

variable "instance_class" {
  type = string
}

variable "allocated_storage" {
  type    = number
  default = 50
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 200
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_period" {
  description = "Days of automated backups / point-in-time recovery window."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "skip_final_snapshot" {
  type    = bool
  default = false
}

variable "performance_insights_retention_period" {
  description = "7 (free tier) or a multiple of 31 days."
  type        = number
  default     = 7
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval in seconds (0 disables)."
  type        = number
  default     = 60
}

variable "master_username" {
  type    = string
  default = "shopverse_admin"
}

variable "secrets_kms_key_arn" {
  description = "CMK for the per-service credential secrets."
  type        = string
}

variable "secret_recovery_window_in_days" {
  type    = number
  default = 7
}

variable "service_databases" {
  description = "Postgres-using services => database name. A secret shopverse/<env>/rds/<service> is created for each."
  type        = map(string)
  default = {
    "auth-service"      = "auth"
    "user-service"      = "users"
    "catalog-service"   = "catalog"
    "search-service"    = "search"
    "inventory-service" = "inventory"
    "order-service"     = "orders"
    "payment-service"   = "payments"
    "shipping-service"  = "shipping"
    "review-service"    = "reviews"
    "promotion-service" = "promotions"
    "audit-service"     = "audit"
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
