locals {
  default_tags = {
    Project     = "shopverse"
    Environment = var.environment
    Owner       = "platform-team"
    CostCenter  = "shopverse"
    ManagedBy   = "terraform"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.default_tags
  }
}

# CloudFront WAF + certificate lookups.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}

# Disaster-recovery region for AWS Backup cross-region copies.
provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = local.default_tags
  }
}
