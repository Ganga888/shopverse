variable "region" {
  description = "Region for the Terraform state bucket and lock table."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name used as resource prefix."
  type        = string
  default     = "shopverse"
}

variable "state_bucket_name" {
  description = "Override for the state bucket name. Defaults to shopverse-tfstate-<account-id> (bucket names are global)."
  type        = string
  default     = null
}

variable "lock_table_name" {
  description = "DynamoDB table used for Terraform state locking."
  type        = string
  default     = "shopverse-terraform-locks"
}

variable "noncurrent_version_retention_days" {
  description = "How long to keep previous versions of state files."
  type        = number
  default     = 90
}
