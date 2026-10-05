terraform {
  backend "s3" {
    # bucket / region / dynamodb_table / encrypt / kms_key_id: terraform/backend.hcl
    #   terraform init -backend-config=../backend.hcl
    key = "ci/terraform.tfstate"
  }
}
