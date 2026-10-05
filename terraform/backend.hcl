# Shared partial S3 backend configuration for terraform/global and terraform/envs/*.
# Generated from `terraform -chdir=terraform/bootstrap output -raw backend_hcl`.
# 786896018375 is the contract placeholder account ID - replace it with the
# real value after running the bootstrap stack. Each stack's backend.tf sets
# only its own `key`.
#
#   terraform init -backend-config=../../backend.hcl   (from terraform/envs/<env>)
#   terraform init -backend-config=../backend.hcl      (from terraform/global)
bucket         = "shopverse-tfstate-786896018375"
region         = "ap-south-1"
dynamodb_table = "shopverse-terraform-locks"
encrypt        = true
kms_key_id     = "alias/shopverse-tfstate"
