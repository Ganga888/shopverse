output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_distribution_arn" {
  value = aws_cloudfront_distribution.web.arn
}

output "web_distribution_domain_name" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "media_distribution_id" {
  value = aws_cloudfront_distribution.media.id
}

output "media_distribution_arn" {
  value = aws_cloudfront_distribution.media.arn
}

output "waf_web_acl_arn" {
  description = "CLOUDFRONT-scope web ACL (us-east-1)."
  value       = aws_wafv2_web_acl.cloudfront.arn
}
