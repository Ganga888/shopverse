variable "name_prefix" {
  description = "Role name prefix, shopverse-<env>. Roles are named <prefix>-<key>."
  type        = string
}

variable "oidc_provider_arn" {
  description = "EKS IRSA OIDC provider ARN."
  type        = string
}

variable "oidc_provider" {
  description = "OIDC issuer without https:// (module.eks.oidc_provider)."
  type        = string
}

variable "environment" {
  description = "dev | staging | prod (used for the Secrets Manager path shopverse/<env>/*)."
  type        = string
}

variable "route53_zone_arns" {
  description = "Hosted zones ExternalDNS may change."
  type        = list(string)
}

variable "secrets_kms_key_arns" {
  description = "CMKs encrypting shopverse/<env>/* secrets (External Secrets needs kms:Decrypt)."
  type        = list(string)
  default     = []
}

variable "additional_secret_arns" {
  description = "Extra secrets External Secrets may read (e.g. the RDS-managed master secret for the db-init job)."
  type        = list(string)
  default     = []
}

variable "additional_kms_key_arns" {
  description = "Extra CMKs External Secrets may decrypt through Secrets Manager (e.g. the RDS key)."
  type        = list(string)
  default     = []
}

variable "velero_bucket_arn" {
  type = string
}

variable "velero_kms_key_arn" {
  type = string
}

variable "media_bucket_arn" {
  type = string
}

variable "audit_bucket_arn" {
  type = string
}

variable "audit_kms_key_arn" {
  type = string
}

variable "ses_identity_arns" {
  description = "SES identities notification-service may send from. Empty = all identities in the account/region."
  type        = list(string)
  default     = []
}

variable "ses_from_addresses" {
  description = "Allowed From addresses for notification-service (ses:FromAddress condition)."
  type        = list(string)
}

variable "extra_roles" {
  description = <<-EOT
    Generic IRSA roles: key => { namespace, service_account, policy_json (optional), managed_policy_arns (optional) }.
    The role is named <name_prefix>-<key>.
  EOT
  type = map(object({
    namespace           = string
    service_account     = string
    policy_json         = optional(string)
    managed_policy_arns = optional(list(string), [])
  }))
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
