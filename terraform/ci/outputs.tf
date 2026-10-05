output "jenkins_url" {
  value = "https://${local.jenkins_fqdn}/"
}

output "sonarqube_url" {
  value = "https://${local.sonar_fqdn}/"
}

output "instance_id" {
  description = "Use as ansible_host in ansible/inventories/ci/hosts.yml and for `aws ssm start-session --target`."
  value       = aws_instance.jenkins.id
}

output "instance_role_arn" {
  value = aws_iam_role.jenkins.arn
}

output "ssm_bucket" {
  description = "ansible_aws_ssm_bucket_name for the Ansible SSM connection."
  value       = aws_s3_bucket.ssm.bucket
}

output "secret_name" {
  description = "Jenkins/SonarQube credentials; set GITHUB_TOKEN and SONAR_TOKEN here."
  value       = aws_secretsmanager_secret.jenkins.name
}

output "jenkins_admin_password_command" {
  value = "aws secretsmanager get-secret-value --secret-id ${aws_secretsmanager_secret.jenkins.name} --query SecretString --output text | jq -r .JENKINS_ADMIN_PASSWORD"
}
