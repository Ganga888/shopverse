terraform {
  backend "s3" {
    # bucket / region / dynamodb_table / encrypt / kms_key_id come from
    # terraform/backend.hcl:  terraform init -backend-config=../backend.hcl
    key = "global/terraform.tfstate"
  }
}
