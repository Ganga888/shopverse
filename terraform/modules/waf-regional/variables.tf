variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "rate_limit_per_5min" {
  type    = number
  default = 2000
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
