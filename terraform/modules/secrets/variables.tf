variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "environment" {
  type = string
}

variable "recovery_window_in_days" {
  description = "Secrets Manager deletion recovery window (0 = force delete, handy for dev)."
  type        = number
  default     = 7
}

variable "jwt_rsa_bits" {
  description = "RSA key size for the RS256 JWT signing key."
  type        = number
  default     = 2048
}

variable "tags" {
  type    = map(string)
  default = {}
}
