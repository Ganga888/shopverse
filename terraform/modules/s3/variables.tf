variable "name_prefix" {
  description = "shopverse-<env>; buckets are <prefix>-{web,media,audit,velero,logs}."
  type        = string
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete non-empty buckets (dev only)."
  type        = bool
  default     = false
}

variable "enable_cloudfront_oac" {
  description = "Static switch: add CloudFront OAC read statements to the web and media bucket policies."
  type        = bool
  default     = true
}

variable "web_distribution_arn" {
  description = "CloudFront distribution serving the SPA (OAC principal)."
  type        = string
  default     = null
}

variable "media_distribution_arn" {
  description = "CloudFront distribution serving media (OAC principal)."
  type        = string
  default     = null
}

variable "media_cors_allowed_origins" {
  description = "Origins allowed to PUT to presigned media URLs."
  type        = list(string)
  default     = []
}

variable "audit_retention_days" {
  description = "Days audit archives are kept (transitioned to Glacier after 90)."
  type        = number
  default     = 2555 # 7 years
}

variable "audit_object_lock_days" {
  description = "Object Lock GOVERNANCE default retention in days for the audit bucket (0 = no object lock)."
  type        = number
  default     = 0
}

variable "logs_retention_days" {
  type    = number
  default = 90
}

variable "velero_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
