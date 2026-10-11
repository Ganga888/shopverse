output "state_bucket" {
  description = "Name of the Terraform state bucket."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "Name of the DynamoDB lock table."
  value       = aws_dynamodb_table.locks.name
}

output "kms_key_arn" {
  description = "KMS key used to encrypt state."
  value       = aws_kms_key.state.arn
}

output "backend_hcl" {
  description = "Paste into terraform/backend.hcl (shared partial backend config for global + envs)."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.id}"
    region         = "${var.region}"
    use_lockfile   = true
    encrypt        = true
    kms_key_id     = "${aws_kms_key.state.arn}"
  EOT
}
