################################################################################
# Jenkins + SonarQube on EC2 (shared by dev, staging and prod).
#
#   Internet --443--> ALB (ACM cert, admin-IP allowlist, GitHub webhook path)
#                      |  jenkins.ganga888.in   -> :8085 Jenkins
#                      |  sonarqube.ganga888.in -> :9000 SonarQube
#                      v
#   EC2 (Ubuntu 24.04, no inbound SSH; admin + Ansible over SSM Session Manager)
#     /var/lib/docker on an encrypted EBS data volume with daily snapshots
#     instance role: ECR push + cosign KMS sign (no access keys anywhere)
#
# The host lives in its own small VPC so the nightly dev destroy (which removes
# the dev NAT gateways) never cuts Jenkins off. Public subnets only: the
# instance has a public IP for egress but its security group admits nothing
# except the ALB, so there is no NAT gateway to pay for.
################################################################################

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_route53_zone" "root" {
  name         = var.root_domain
  private_zone = false
}

data "aws_iam_policy" "jenkins_ci" {
  name = "${var.project}-jenkins-ci" # created by terraform/global
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

locals {
  name         = "${var.project}-ci"
  account_id   = data.aws_caller_identity.current.account_id
  partition    = data.aws_partition.current.partition
  azs          = slice(data.aws_availability_zones.available.names, 0, 2)
  jenkins_fqdn = "${var.jenkins_hostname}.${var.root_domain}"
  sonar_fqdn   = "${var.sonarqube_hostname}.${var.root_domain}"
}

################################################################################
# Network
################################################################################

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-public" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Free gateway endpoint: S3 traffic (ECR layers, backups, SSM transfers) stays on the AWS network.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "${local.name}-s3" }
}

resource "aws_flow_log" "this" {
  vpc_id               = aws_vpc.this.id
  traffic_type         = "REJECT"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow.arn
  iam_role_arn         = aws_iam_role.flow.arn
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/shopverse/ci/vpc-flow"
  retention_in_days = 30
}

resource "aws_iam_role" "flow" {
  name = "${local.name}-flow-logs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "flow" {
  name = "write-flow-logs"
  role = aws_iam_role.flow.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.flow.arn}:*"
    }]
  })
}

################################################################################
# Security groups
################################################################################

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Jenkins/SonarQube ALB: HTTPS from admin CIDRs and GitHub webhooks"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each          = toset(concat(var.admin_cidrs, var.github_hook_cidrs))
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each          = toset(var.admin_cidrs)
  security_group_id = aws_security_group.alb.id
  description       = "HTTP (redirected to HTTPS)"
  cidr_ipv4         = each.value
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_host" {
  for_each                     = toset(["8085", "9000"])
  security_group_id            = aws_security_group.alb.id
  description                  = "To Jenkins / SonarQube"
  referenced_security_group_id = aws_security_group.jenkins.id
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "jenkins" {
  name        = "${local.name}-host"
  description = "Jenkins host: only the ALB may connect; no SSH (use SSM)"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-host" }
}

resource "aws_vpc_security_group_ingress_rule" "host_from_alb" {
  for_each                     = toset(["8085", "9000"])
  security_group_id            = aws_security_group.jenkins.id
  description                  = "From ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "host_all" {
  security_group_id = aws_security_group.jenkins.id
  description       = "Builds pull packages/images and push to ECR, GitHub, SSM"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
