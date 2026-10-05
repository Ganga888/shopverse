provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "shopverse"
      Environment = "ci"
      Owner       = "platform-team"
      CostCenter  = "shopverse"
      ManagedBy   = "terraform"
    }
  }
}
