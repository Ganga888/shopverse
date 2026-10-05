locals {
  id           = "${var.name_prefix}-redis"
  cluster_mode = var.num_shards > 1
  major        = split(".", var.engine_version)[0]
}

resource "aws_kms_key" "redis" {
  description             = "${local.id} at-rest encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_elasticache_subnet_group" "this" {
  name       = local.id
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = local.id
  description = "Redis access for ${var.name_prefix}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = local.id })
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  for_each = { for i, sg in var.allowed_security_group_ids : tostring(i) => sg }

  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis TLS from EKS"
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${local.id}-${local.major}${local.cluster_mode ? "-cluster" : ""}"
  family = "redis${local.major}"

  dynamic "parameter" {
    for_each = local.cluster_mode ? [1] : []
    content {
      name  = "cluster-enabled"
      value = "yes"
    }
  }

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }

  tags = var.tags
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "aws_cloudwatch_log_group" "slowlog" {
  name              = "/aws/elasticache/${local.id}/slow-log"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "enginelog" {
  name              = "/aws/elasticache/${local.id}/engine-log"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = local.id
  description          = "${var.name_prefix} Redis (sessions, cart, cache, pub/sub)"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.this.name

  num_node_groups         = var.num_shards
  replicas_per_node_group = var.replicas_per_shard

  automatic_failover_enabled = var.replicas_per_shard > 0
  multi_az_enabled           = var.multi_az && var.replicas_per_shard > 0

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = random_password.auth.result
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = "18:30-19:30"
  maintenance_window       = "sun:20:00-sun:21:00"

  auto_minor_version_upgrade = true
  apply_immediately          = false

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slowlog.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.enginelog.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = var.tags
}

locals {
  endpoint = local.cluster_mode ? aws_elasticache_replication_group.this.configuration_endpoint_address : aws_elasticache_replication_group.this.primary_endpoint_address

  # Deterministic member cluster ids (used for per-node alarms).
  member_cluster_ids = local.cluster_mode ? flatten([
    for s in range(1, var.num_shards + 1) : [
      for n in range(1, var.replicas_per_shard + 2) : format("%s-%04d-%03d", local.id, s, n)
    ]
    ]) : [
    for n in range(1, var.replicas_per_shard + 2) : format("%s-%03d", local.id, n)
  ]
}

# shopverse/<env>/redis { url }   (rediss:// = TLS)
resource "aws_secretsmanager_secret" "redis" {
  name                    = "shopverse/${var.environment}/redis"
  description             = "Redis connection URL (TLS + AUTH) for ${var.name_prefix}"
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    url          = "rediss://:${random_password.auth.result}@${local.endpoint}:6379"
    host         = local.endpoint
    port         = "6379"
    auth_token   = random_password.auth.result
    tls          = "true"
    cluster_mode = tostring(local.cluster_mode)
  })
}
