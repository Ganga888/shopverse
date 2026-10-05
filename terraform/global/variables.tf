variable "region" {
  description = "Primary AWS region."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name / resource prefix."
  type        = string
  default     = "shopverse"
}

variable "root_domain" {
  description = "Public hosted zone managed by Route 53."
  type        = string
  default     = "ganga888.in"
}

variable "services" {
  description = "Microservices that get an ECR repository shopverse/<service>."
  type        = list(string)
  default = [
    "auth-service",
    "user-service",
    "catalog-service",
    "search-service",
    "inventory-service",
    "cart-service",
    "order-service",
    "payment-service",
    "shipping-service",
    "notification-service",
    "review-service",
    "promotion-service",
    "recommendation-service",
    "media-service",
    "audit-service",
  ]
}

variable "ecr_keep_last_images" {
  description = "Number of images kept per ECR repository."
  type        = number
  default     = 30
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to assume the CI roles via OIDC."
  type        = string
  default     = "OWNER/shopverse"
}

variable "github_environments" {
  description = "GitHub deployment environments whose jobs may assume the apply/deploy roles."
  type        = list(string)
  default     = ["global", "dev", "staging", "prod"]
}

variable "state_bucket_name" {
  description = "Terraform state bucket created by terraform/bootstrap. Defaults to shopverse-tfstate-<account-id>."
  type        = string
  default     = null
}

variable "lock_table_name" {
  description = "Terraform lock table created by terraform/bootstrap."
  type        = string
  default     = "shopverse-terraform-locks"
}

variable "budget_monthly_limit_usd" {
  description = "Monthly cost budget for the whole account in USD."
  type        = number
  default     = 500
}

variable "budget_alert_emails" {
  description = "Email addresses subscribed to budget and cost-anomaly alerts (each must confirm the SNS subscription)."
  type        = list(string)
  default     = []
}

variable "cost_anomaly_threshold_usd" {
  description = "Absolute impact (USD) above which a cost anomaly triggers an alert."
  type        = number
  default     = 25
}

variable "cloudtrail_retention_days" {
  description = "Days CloudTrail logs are retained in S3."
  type        = number
  default     = 365
}

variable "enable_guardduty_runtime_monitoring" {
  description = "Enable GuardDuty EKS runtime monitoring (agent managed as an EKS add-on by GuardDuty)."
  type        = bool
  default     = true
}

variable "create_jenkins_ci_user" {
  description = "Create the jenkins-ci IAM user (only for Jenkins running outside AWS). Jenkins on EC2 (terraform/ci) uses its instance role instead."
  type        = bool
  default     = false
}
