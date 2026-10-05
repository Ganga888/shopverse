terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.95, < 6.0.0"
    }
  }

  # Intentionally LOCAL state: this stack creates the remote state backend
  # itself. Run it once per AWS account, then commit nothing from
  # terraform.tfstate (it is git-ignored). Keep a copy of the local state in a
  # safe place (e.g. a password manager attachment) - it is tiny and only
  # needed if the bootstrap resources must ever change.
}
