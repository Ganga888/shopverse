# dev - cheapest footprint, destroyed nightly (.github/workflows/nightly-dev.yml)
environment = "dev"
region      = "ap-south-1"
root_domain = "ganga888.in"

vpc_cidr               = "10.10.0.0/16"
az_count               = 3
one_nat_gateway_per_az = false # 1 NAT GW

cluster_version = "1.31"
# GitHub-hosted runners have no fixed egress; tighten to office/VPN CIDRs
# when using self-hosted runners.
endpoint_public_access_cidrs = ["0.0.0.0/0"]

system_node_instance_types = ["t3.medium"]
system_node_capacity_type  = "ON_DEMAND"
system_node_min_size       = 2
system_node_max_size       = 3
system_node_desired_size   = 2
karpenter_capacity_types   = ["spot"]

# In-cluster Postgres / Redis / Strimzi (gitops `data` + `kafka` namespaces).
use_managed_data = false

s3_force_destroy               = true
secret_recovery_window_in_days = 0
cluster_log_retention_days     = 7
waf_rate_limit_per_5min        = 2000

alert_emails = ["platform-team@ganga888.in"]
