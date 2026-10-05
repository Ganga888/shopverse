variable "name" {
  description = "Name prefix, e.g. shopverse-dev."
  type        = string
}

variable "cidr" {
  description = "VPC CIDR (a /16 is expected; subnets are carved with cidrsubnet)."
  type        = string
}

variable "az_count" {
  description = "Number of availability zones to span."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "one_nat_gateway_per_az" {
  description = "true = one NAT gateway per AZ (HA, prod). false = a single shared NAT gateway (dev/staging)."
  type        = bool
  default     = false
}

variable "cluster_name" {
  description = "EKS cluster name used for kubernetes.io/cluster and karpenter.sh/discovery subnet tags."
  type        = string
}

variable "enable_flow_logs" {
  description = "Send VPC flow logs to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "flow_log_retention_days" {
  description = "CloudWatch retention for VPC flow logs."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
