variable "name_prefix" {
  description = "shopverse-<env>"
  type        = string
}

variable "zone_id" {
  description = "Route 53 hosted zone ID of ganga888.in."
  type        = string
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM certificate covering web_aliases and media_alias."
  type        = string
}

variable "web_aliases" {
  description = "Hostnames of the SPA, e.g. [\"ganga888.in\", \"www.ganga888.in\"] or [\"dev.ganga888.in\"]."
  type        = list(string)
}

variable "media_alias" {
  description = "Hostname for media, e.g. cdn.ganga888.in / cdn.dev.ganga888.in."
  type        = string
}

variable "web_bucket_regional_domain_name" {
  type = string
}

variable "media_bucket_regional_domain_name" {
  type = string
}

variable "api_origin_domain" {
  description = "DNS name of the API origin (the ALB, reached through api.<env domain> so its ACM cert matches)."
  type        = string
}

variable "logs_bucket_domain_name" {
  description = "Bucket for CloudFront standard logs (empty disables logging)."
  type        = string
  default     = ""
}

variable "price_class" {
  description = "PriceClass_200 includes India edge locations."
  type        = string
  default     = "PriceClass_200"
}

variable "rate_limit_per_5min" {
  description = "Requests per 5 minutes per IP before the WAF blocks."
  type        = number
  default     = 2000
}

variable "waf_log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
