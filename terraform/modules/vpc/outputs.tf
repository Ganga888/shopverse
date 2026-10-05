output "vpc_id" {
  value = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  value = module.vpc.vpc_cidr_block
}

output "azs" {
  value = local.azs
}

output "private_subnet_ids" {
  value = module.vpc.private_subnets
}

output "public_subnet_ids" {
  value = module.vpc.public_subnets
}

output "database_subnet_ids" {
  value = module.vpc.database_subnets
}

output "database_subnet_group_name" {
  value = module.vpc.database_subnet_group_name
}

output "nat_public_ips" {
  description = "Egress IPs (allow-list these at third parties such as the payment gateway)."
  value       = module.vpc.nat_public_ips
}

output "private_route_table_ids" {
  value = module.vpc.private_route_table_ids
}
