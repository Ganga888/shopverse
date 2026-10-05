variable "env_domain" {
  description = "Environment domain: ganga888.in (prod), staging.ganga888.in, dev.ganga888.in."
  type        = string
}

variable "zone_id" {
  description = "Route 53 zone used for DNS validation."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
