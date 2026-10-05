# Offline plan with mocked providers (no AWS credentials): catches dependency
# cycles, unknown for_each keys and provider-side validation errors.
#   terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
      id    = "ap-south-1"
    }
  }
  mock_data "aws_region" {
    defaults = { name = "ap-south-1", id = "ap-south-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "786896018375", arn = "arn:aws:iam::786896018375:role/x" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_iam_session_context" {
    defaults = { issuer_arn = "arn:aws:iam::786896018375:role/x" }
  }
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z123", arn = "arn:aws:route53:::hostedzone/Z123", name = "ganga888.in" }
  }
  mock_data "aws_elb_service_account" {
    defaults = { arn = "arn:aws:iam::718504428378:root" }
  }
}
mock_provider "aws" {
  alias = "us_east_1"
  mock_data "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:786896018375:certificate/abc" }
  }
}
mock_provider "aws" {
  alias = "dr"
}
mock_provider "random" {}
mock_provider "tls" {}
mock_provider "time" {}
mock_provider "cloudinit" {}
mock_provider "null" {}

run "plan" {
  command = plan
}
