terraform {
  backend "s3" {
    # bucket / region / use_lockfile / encrypt / kms_key_id: terraform/backend.hcl
    #   terraform init -backend-config=../../backend.hcl
    key = "envs/staging/terraform.tfstate"
  }
}
