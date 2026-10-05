data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_region" "current" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # /16 layout:
  #   private  /19 x3  10.x.0.0  - 10.x.95.255   (EKS nodes + pods, prefix delegation)
  #   public   /24 x3  10.x.96.0 - 10.x.98.255   (ALB, NAT)
  #   database /24 x3  10.x.104.0- 10.x.106.255  (RDS, ElastiCache, MSK)
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.cidr, 3, i)]
  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, 96 + i)]
  database_subnets = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, 104 + i)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = var.name
  cidr = var.cidr
  azs  = local.azs

  private_subnets  = local.private_subnets
  public_subnets   = local.public_subnets
  database_subnets = local.database_subnets

  create_database_subnet_group       = true
  create_database_subnet_route_table = true
  database_subnet_group_name         = "${var.name}-db"

  enable_nat_gateway     = true
  single_nat_gateway     = !var.one_nat_gateway_per_az
  one_nat_gateway_per_az = var.one_nat_gateway_per_az

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Lock down the default SG / NACL created with every VPC.
  manage_default_security_group  = true
  default_security_group_ingress = []
  default_security_group_egress  = []

  enable_flow_log                                 = var.enable_flow_logs
  create_flow_log_cloudwatch_log_group            = var.enable_flow_logs
  create_flow_log_cloudwatch_iam_role             = var.enable_flow_logs
  flow_log_max_aggregation_interval               = 60
  flow_log_cloudwatch_log_group_retention_in_days = var.flow_log_retention_days
  flow_log_traffic_type                           = "ALL"

  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "karpenter.sh/discovery"                    = var.cluster_name
  }

  database_subnet_tags = {
    Tier = "database"
  }

  tags = var.tags
}

# Gateway endpoint keeps S3 traffic (ECR layers, Velero, media) off the NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(module.vpc.private_route_table_ids, module.vpc.database_route_table_ids)

  tags = merge(var.tags, { Name = "${var.name}-s3" })
}
