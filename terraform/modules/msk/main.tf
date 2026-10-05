locals {
  name         = "${var.name_prefix}-kafka"
  scram_secret = "AmazonMSK_shopverse_${var.environment}_app" # MSK requires the AmazonMSK_ prefix
  scram_user   = "shopverse-app"
}

################################################################################
# Encryption keys
################################################################################

resource "aws_kms_key" "msk" {
  description             = "${local.name} at-rest + SCRAM secret encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "msk" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.msk.key_id
}

################################################################################
# Networking
################################################################################

resource "aws_security_group" "msk" {
  name        = local.name
  description = "MSK client access for ${var.name_prefix}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = local.name })
}

resource "aws_vpc_security_group_ingress_rule" "sasl_scram" {
  for_each = { for i, sg in var.allowed_security_group_ids : tostring(i) => sg }

  security_group_id            = aws_security_group.msk.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 9096
  to_port                      = 9096
  description                  = "Kafka SASL_SSL (SCRAM) from EKS"
}

resource "aws_vpc_security_group_ingress_rule" "tls" {
  for_each = var.allow_unauthenticated_tls ? { for i, sg in var.allowed_security_group_ids : tostring(i) => sg } : {}

  security_group_id            = aws_security_group.msk.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 9094
  to_port                      = 9094
  description                  = "Kafka TLS (unauthenticated) from EKS"
}

resource "aws_vpc_security_group_ingress_rule" "self" {
  security_group_id            = aws_security_group.msk.id
  referenced_security_group_id = aws_security_group.msk.id
  ip_protocol                  = "-1"
  description                  = "Broker to broker"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.msk.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Broker egress"
}

################################################################################
# Configuration
################################################################################

resource "aws_msk_configuration" "this" {
  name           = "${local.name}-${replace(var.kafka_version, ".", "-")}"
  kafka_versions = [var.kafka_version]
  description    = "shopverse broker configuration (topics are created explicitly, never auto)"

  server_properties = <<-EOT
    auto.create.topics.enable=false
    delete.topic.enable=true
    default.replication.factor=${var.default_replication_factor}
    min.insync.replicas=${var.min_insync_replicas}
    num.partitions=${var.default_partitions}
    num.io.threads=8
    num.network.threads=5
    num.replica.fetchers=2
    replica.lag.time.max.ms=30000
    socket.request.max.bytes=104857600
    unclean.leader.election.enable=false
    log.retention.hours=${var.log_retention_hours}
    allow.everyone.if.no.acl.found=true
  EOT

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "broker" {
  name              = "/aws/msk/${local.name}"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = var.tags
}

################################################################################
# Cluster
################################################################################

resource "aws_msk_cluster" "this" {
  cluster_name           = local.name
  kafka_version          = var.kafka_version
  number_of_broker_nodes = var.broker_count
  enhanced_monitoring    = "PER_TOPIC_PER_BROKER"

  broker_node_group_info {
    instance_type   = var.broker_instance_type
    client_subnets  = var.subnet_ids
    security_groups = [aws_security_group.msk.id]

    storage_info {
      ebs_storage_info {
        volume_size = var.broker_volume_size
      }
    }
  }

  configuration_info {
    arn      = aws_msk_configuration.this.arn
    revision = aws_msk_configuration.this.latest_revision
  }

  client_authentication {
    unauthenticated = var.allow_unauthenticated_tls
    sasl {
      scram = true
      iam   = false
    }
  }

  encryption_info {
    encryption_at_rest_kms_key_arn = aws_kms_key.msk.arn
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  open_monitoring {
    prometheus {
      jmx_exporter {
        enabled_in_broker = true
      }
      node_exporter {
        enabled_in_broker = true
      }
    }
  }

  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = true
        log_group = aws_cloudwatch_log_group.broker.name
      }
    }
  }

  tags = var.tags

  lifecycle {
    precondition {
      condition     = var.broker_count % length(var.subnet_ids) == 0
      error_message = "broker_count must be a multiple of the number of client subnets."
    }
  }
}

################################################################################
# SASL/SCRAM credentials
################################################################################

resource "random_password" "scram" {
  length           = 40
  special          = true
  override_special = "-_"
}

resource "aws_secretsmanager_secret" "scram" {
  name                    = local.scram_secret
  description             = "MSK SASL/SCRAM credentials for shopverse services (${var.environment})"
  kms_key_id              = aws_kms_key.msk.arn # MSK SCRAM secrets cannot use the default key
  recovery_window_in_days = var.secret_recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "scram" {
  secret_id = aws_secretsmanager_secret.scram.id
  # MSK only reads username/password; extra keys are for External Secrets.
  secret_string = jsonencode({
    username  = local.scram_user
    password  = random_password.scram.result
    brokers   = aws_msk_cluster.this.bootstrap_brokers_sasl_scram
    mechanism = "scram-sha-512"
    ssl       = "true"
  })
}

data "aws_iam_policy_document" "scram_secret" {
  statement {
    sid       = "AWSKafkaResourcePolicy"
    actions   = ["secretsmanager:getSecretValue"]
    resources = [aws_secretsmanager_secret.scram.arn]
    principals {
      type        = "Service"
      identifiers = ["kafka.amazonaws.com"]
    }
  }
}

resource "aws_secretsmanager_secret_policy" "scram" {
  secret_arn = aws_secretsmanager_secret.scram.arn
  policy     = data.aws_iam_policy_document.scram_secret.json
}

resource "aws_msk_scram_secret_association" "this" {
  cluster_arn     = aws_msk_cluster.this.arn
  secret_arn_list = [aws_secretsmanager_secret.scram.arn]

  depends_on = [aws_secretsmanager_secret_version.scram, aws_secretsmanager_secret_policy.scram]
}
