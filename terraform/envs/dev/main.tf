data "aws_caller_identity" "current" {}

data "aws_route53_zone" "root" {
  name         = var.root_domain
  private_zone = false
}

# Issued by terraform/global (ganga888.in, *.ganga888.in, *.dev/*.staging).
data "aws_acm_certificate" "cloudfront" {
  provider    = aws.us_east_1
  domain      = var.root_domain
  statuses    = ["ISSUED"]
  most_recent = true
}

locals {
  name         = "shopverse-${var.environment}"
  cluster_name = local.name
  account_id   = data.aws_caller_identity.current.account_id

  # prod lives at the apex; other envs at <env>.ganga888.in
  env_domain  = var.environment == "prod" ? var.root_domain : "${var.environment}.${var.root_domain}"
  web_aliases = var.environment == "prod" ? [var.root_domain, "www.${var.root_domain}"] : [local.env_domain]
  media_alias = "cdn.${local.env_domain}"
  api_domain  = "api.${local.env_domain}"

  gha_apply_role_arn = "arn:aws:iam::${local.account_id}:role/shopverse-gha-apply"

  # Postgres-using services (docs/CONTRACT.md) => database name
  service_databases = {
    "auth-service"      = "auth"
    "user-service"      = "users"
    "catalog-service"   = "catalog"
    "search-service"    = "search"
    "inventory-service" = "inventory"
    "order-service"     = "orders"
    "payment-service"   = "payments"
    "shipping-service"  = "shipping"
    "review-service"    = "reviews"
    "promotion-service" = "promotions"
    "audit-service"     = "audit"
  }

  data_client_security_groups = [module.eks.node_security_group_id, module.eks.cluster_primary_security_group_id]
}

################################################################################
# Network
################################################################################

module "vpc" {
  source = "../../modules/vpc"

  name                   = local.name
  cidr                   = var.vpc_cidr
  az_count               = var.az_count
  one_nat_gateway_per_az = var.one_nat_gateway_per_az
  cluster_name           = local.cluster_name
}

################################################################################
# EKS + Karpenter + IRSA
################################################################################

module "eks" {
  source = "../../modules/eks"

  cluster_name                 = local.cluster_name
  cluster_version              = var.cluster_version
  vpc_id                       = module.vpc.vpc_id
  subnet_ids                   = module.vpc.private_subnet_ids
  endpoint_public_access_cidrs = var.endpoint_public_access_cidrs

  system_node_instance_types = var.system_node_instance_types
  system_node_capacity_type  = var.system_node_capacity_type
  system_node_min_size       = var.system_node_min_size
  system_node_max_size       = var.system_node_max_size
  system_node_desired_size   = var.system_node_desired_size

  cluster_admin_role_arns    = distinct(concat([local.gha_apply_role_arn], var.cluster_admin_role_arns))
  cluster_view_role_arns     = var.cluster_view_role_arns
  cluster_log_retention_days = var.cluster_log_retention_days

  ebs_csi_role_arn = module.irsa.ebs_csi_role_arn
  volume_tags      = local.default_tags
}

module "karpenter" {
  source = "../../modules/karpenter"

  cluster_name      = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  oidc_provider_arn = module.eks.oidc_provider_arn
  capacity_types    = var.karpenter_capacity_types
}

module "irsa" {
  source = "../../modules/irsa"

  name_prefix       = local.name
  environment       = var.environment
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider     = module.eks.oidc_provider

  route53_zone_arns    = [data.aws_route53_zone.root.arn]
  secrets_kms_key_arns = [module.secrets.kms_key_arn]

  # db-init job reads the RDS-managed master secret; Kafka creds live under AmazonMSK_*
  additional_secret_arns  = var.use_managed_data ? [module.rds[0].master_user_secret_arn] : []
  additional_kms_key_arns = var.use_managed_data ? [module.rds[0].kms_key_arn, module.msk[0].kms_key_arn] : []

  velero_bucket_arn  = module.s3.bucket_arns["velero"]
  velero_kms_key_arn = module.s3.kms_key_arn
  media_bucket_arn   = module.s3.bucket_arns["media"]
  audit_bucket_arn   = module.s3.bucket_arns["audit"]
  audit_kms_key_arn  = module.s3.kms_key_arn

  ses_from_addresses = ["*@${local.env_domain}", "*@${var.root_domain}"]
}

################################################################################
# Edge: certificates, WAF, S3, CloudFront
################################################################################

module "acm" {
  source = "../../modules/acm-regional"

  env_domain = local.env_domain
  zone_id    = data.aws_route53_zone.root.zone_id
}

module "waf_regional" {
  source = "../../modules/waf-regional"

  name_prefix         = local.name
  rate_limit_per_5min = var.waf_rate_limit_per_5min
}

module "s3" {
  source = "../../modules/s3"

  name_prefix            = local.name
  force_destroy          = var.s3_force_destroy
  audit_object_lock_days = var.audit_object_lock_days

  enable_cloudfront_oac      = true
  web_distribution_arn       = module.cloudfront.web_distribution_arn
  media_distribution_arn     = module.cloudfront.media_distribution_arn
  media_cors_allowed_origins = [for a in local.web_aliases : "https://${a}"]
}

module "cloudfront" {
  source = "../../modules/cloudfront"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix         = local.name
  zone_id             = data.aws_route53_zone.root.zone_id
  acm_certificate_arn = data.aws_acm_certificate.cloudfront.arn
  web_aliases         = local.web_aliases
  media_alias         = local.media_alias

  web_bucket_regional_domain_name   = module.s3.bucket_regional_domain_names["web"]
  media_bucket_regional_domain_name = module.s3.bucket_regional_domain_names["media"]
  logs_bucket_domain_name           = module.s3.logs_bucket_domain_name
  api_origin_domain                 = local.api_domain
  rate_limit_per_5min               = var.waf_rate_limit_per_5min
}

################################################################################
# Application secrets
################################################################################

module "secrets" {
  source = "../../modules/secrets"

  name_prefix             = local.name
  environment             = var.environment
  recovery_window_in_days = var.secret_recovery_window_in_days
}

################################################################################
# Managed data tier (staging / prod)
################################################################################

module "rds" {
  source = "../../modules/rds"
  count  = var.use_managed_data ? 1 : 0

  name_prefix                = local.name
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  db_subnet_group_name       = module.vpc.database_subnet_group_name
  allowed_security_group_ids = local.data_client_security_groups

  instance_class                        = var.rds_instance_class
  multi_az                              = var.rds_multi_az
  allocated_storage                     = var.rds_allocated_storage
  max_allocated_storage                 = var.rds_max_allocated_storage
  backup_retention_period               = var.rds_backup_retention_days
  deletion_protection                   = var.rds_deletion_protection
  skip_final_snapshot                   = !var.rds_deletion_protection
  performance_insights_retention_period = var.rds_performance_insights_retention

  service_databases              = local.service_databases
  secrets_kms_key_arn            = module.secrets.kms_key_arn
  secret_recovery_window_in_days = var.secret_recovery_window_in_days
}

module "elasticache" {
  source = "../../modules/elasticache"
  count  = var.use_managed_data ? 1 : 0

  name_prefix                = local.name
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.database_subnet_ids
  allowed_security_group_ids = local.data_client_security_groups

  node_type          = var.redis_node_type
  num_shards         = var.redis_num_shards
  replicas_per_shard = var.redis_replicas_per_shard
  multi_az           = var.redis_replicas_per_shard > 0

  secrets_kms_key_arn            = module.secrets.kms_key_arn
  secret_recovery_window_in_days = var.secret_recovery_window_in_days
}

module "msk" {
  source = "../../modules/msk"
  count  = var.use_managed_data ? 1 : 0

  name_prefix                = local.name
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = slice(module.vpc.database_subnet_ids, 0, min(var.msk_broker_count, length(module.vpc.database_subnet_ids)))
  allowed_security_group_ids = local.data_client_security_groups

  broker_instance_type       = var.msk_instance_type
  broker_count               = var.msk_broker_count
  broker_volume_size         = var.msk_volume_size
  default_replication_factor = var.msk_replication_factor
  min_insync_replicas        = var.msk_min_insync_replicas
  default_partitions         = var.msk_default_partitions
  allow_unauthenticated_tls  = var.msk_allow_unauthenticated_tls

  secret_recovery_window_in_days = var.secret_recovery_window_in_days
}

################################################################################
# In-cluster data tier (dev): same secret paths, pointing at the `data` namespace
# so ExternalSecrets / Helm values are identical across environments.
################################################################################

resource "random_password" "in_cluster_db" {
  for_each = var.use_managed_data ? {} : local.service_databases

  length           = 32
  special          = true
  override_special = "-_.~"
}

resource "aws_secretsmanager_secret" "in_cluster_db" {
  for_each = var.use_managed_data ? {} : local.service_databases

  name                    = "shopverse/${var.environment}/rds/${each.key}"
  description             = "In-cluster Postgres credentials for ${each.key} (database ${each.value})"
  kms_key_id              = module.secrets.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "in_cluster_db" {
  for_each = var.use_managed_data ? {} : local.service_databases

  secret_id = aws_secretsmanager_secret.in_cluster_db[each.key].id
  secret_string = jsonencode({
    username = replace(each.value, "-", "_")
    password = random_password.in_cluster_db[each.key].result
    host     = var.in_cluster_postgres_host
    port     = "5432"
    dbname   = each.value
  })
}

resource "aws_secretsmanager_secret" "in_cluster_redis" {
  count = var.use_managed_data ? 0 : 1

  name                    = "shopverse/${var.environment}/redis"
  description             = "In-cluster Redis URL"
  kms_key_id              = module.secrets.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "in_cluster_redis" {
  count = var.use_managed_data ? 0 : 1

  secret_id     = aws_secretsmanager_secret.in_cluster_redis[0].id
  secret_string = jsonencode({ url = var.in_cluster_redis_url, cluster_mode = "false", tls = "false" })
}

################################################################################
# Observability + backup
################################################################################

module "observability" {
  source = "../../modules/observability"

  name_prefix  = local.name
  alert_emails = var.alert_emails

  enable_rds_alarms = var.use_managed_data
  rds_instance_id   = var.use_managed_data ? module.rds[0].instance_id : ""

  enable_elasticache_alarms      = var.use_managed_data
  elasticache_member_cluster_ids = var.use_managed_data ? module.elasticache[0].member_cluster_ids : []

  enable_msk_alarms = var.use_managed_data
  msk_cluster_name  = var.use_managed_data ? module.msk[0].cluster_name : ""
  msk_broker_count  = var.use_managed_data ? var.msk_broker_count : 0
}

module "backup" {
  source = "../../modules/backup"
  count  = var.use_managed_data ? 1 : 0
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }

  name_prefix              = local.name
  resource_arns            = [module.rds[0].instance_arn]
  enable_cross_region_copy = var.enable_backup_cross_region_copy
  enable_notifications     = true
  notification_topic_arn   = module.observability.alerts_topic_arn
}
