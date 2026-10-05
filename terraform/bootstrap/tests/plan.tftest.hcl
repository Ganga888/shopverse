# Offline plan with mocked providers (no AWS credentials): catches dependency
# cycles, unknown for_each keys and provider-side validation errors.
#   terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { name = "ap-south-1", id = "ap-south-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "786896018375", arn = "arn:aws:iam::786896018375:role/x" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::786896018375:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_iam_user" {
    defaults = { arn = "arn:aws:iam::786896018375:user/ci/jenkins-ci" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::786896018375:role/x" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:786896018375:key/abc" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-south-1:786896018375:t" }
  }
}
mock_provider "aws" {
  alias = "us_east_1"
}
run "plan" {
  command = plan
}
