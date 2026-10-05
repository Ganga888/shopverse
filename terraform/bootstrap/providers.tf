provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "shopverse"
      Environment = "global"
      Owner       = "platform-team"
      CostCenter  = "shopverse"
      ManagedBy   = "terraform"
    }
  }
}
