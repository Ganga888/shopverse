output "route53_zone_id" {
  description = "Hosted zone ID of ganga888.in."
  value       = aws_route53_zone.root.zone_id
}

output "route53_name_servers" {
  description = "Set these four NS records at the domain registrar to delegate ganga888.in to Route 53."
  value       = aws_route53_zone.root.name_servers
}

output "cloudfront_certificate_arn" {
  description = "us-east-1 ACM certificate (ganga888.in, *.ganga888.in, *.dev/*.staging) for CloudFront."
  value       = aws_acm_certificate_validation.cloudfront.certificate_arn
}

output "ecr_repository_urls" {
  description = "ECR repository URL per service."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "ecr_registry" {
  description = "ECR registry host."
  value       = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com"
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "gha_plan_role_arn" {
  value = aws_iam_role.gha_plan.arn
}

output "gha_apply_role_arn" {
  value = aws_iam_role.gha_apply.arn
}

output "gha_web_deploy_role_arn" {
  value = aws_iam_role.gha_web_deploy.arn
}

output "cosign_kms_key_uri" {
  description = "Key reference for cosign sign/verify."
  value       = "awskms:///${aws_kms_alias.cosign.arn}"
}

output "cosign_public_key_pem" {
  description = "Public key for Kyverno verifyImages / cosign verify --key."
  value       = data.aws_kms_public_key.cosign.public_key_pem
}

output "jenkins_ci_user_arn" {
  description = "IAM user for Jenkins. Access keys live only in Jenkins credentials (see ansible rotate-jenkins-keys runbook)."
  value       = try(aws_iam_user.jenkins_ci[0].arn, null)
}

output "cloudtrail_bucket" {
  value = aws_s3_bucket.cloudtrail.id
}

output "billing_alerts_topic_arn" {
  value = aws_sns_topic.billing_alerts.arn
}

output "ses_identity" {
  description = "SES domain identity used by notification-service (verify status in the SES console)."
  value       = aws_ses_domain_identity.root.domain
}

output "jenkins_ci_policy_arn" {
  description = "ECR push + cosign signing policy; attached to the Jenkins EC2 role in terraform/ci."
  value       = aws_iam_policy.jenkins_ci.arn
}
