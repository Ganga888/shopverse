variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "resource_arns" {
  description = "Resources to protect (RDS instance ARN)."
  type        = list(string)
}

variable "daily_retention_days" {
  type    = number
  default = 35
}

variable "monthly_retention_days" {
  type    = number
  default = 365
}

variable "enable_cross_region_copy" {
  description = "Copy recovery points to the DR region vault (prod)."
  type        = bool
  default     = false
}

variable "cross_region_retention_days" {
  type    = number
  default = 35
}

variable "enable_notifications" {
  description = "Static switch for vault notifications."
  type        = bool
  default     = false
}

variable "notification_topic_arn" {
  description = "SNS topic for backup job failures (used when enable_notifications)."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
