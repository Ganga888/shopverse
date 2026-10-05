output "bucket_names" {
  value = { for k, b in aws_s3_bucket.this : k => b.id }
}

output "bucket_arns" {
  value = { for k, b in aws_s3_bucket.this : k => b.arn }
}

output "bucket_regional_domain_names" {
  value = { for k, b in aws_s3_bucket.this : k => b.bucket_regional_domain_name }
}

output "logs_bucket_domain_name" {
  description = "For CloudFront logging_config."
  value       = aws_s3_bucket.this["logs"].bucket_domain_name
}

output "kms_key_arn" {
  description = "CMK encrypting audit + velero buckets."
  value       = aws_kms_key.data.arn
}
