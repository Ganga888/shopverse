# Offline plan with mocked providers (no AWS credentials).
#   terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333", arn = "arn:aws:iam::111122223333:role/x" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z0000000000000000000", name = "ganga888.in" }
  }
  mock_data "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/shopverse-jenkins-ci" }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/x" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-south-1:111122223333:log-group:x" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::shopverse-ci-ssm-111122223333" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:ap-south-1:111122223333:secret:shopverse/ci/jenkins-abc" }
  }
  mock_resource "aws_instance" {
    defaults = { arn = "arn:aws:ec2:ap-south-1:111122223333:instance/i-0123456789abcdef0", id = "i-0123456789abcdef0" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:ap-south-1:111122223333:certificate/abc"
      domain_validation_options = [
        { domain_name = "jenkins.ganga888.in", resource_record_name = "_a.jenkins.ganga888.in.", resource_record_type = "CNAME", resource_record_value = "_x.acm-validations.aws." },
        { domain_name = "sonarqube.ganga888.in", resource_record_name = "_b.sonarqube.ganga888.in.", resource_record_type = "CNAME", resource_record_value = "_y.acm-validations.aws." },
      ]
    }
  }
}

run "plan" {
  command = plan

  variables {
    admin_cidrs           = ["203.0.113.25/32"]
    office_hours_schedule = true
  }
}
