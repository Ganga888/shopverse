locals {
  default_tags = {
    Project     = "shopverse"
    Environment = "global"
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

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}
