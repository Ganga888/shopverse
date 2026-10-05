data "aws_caller_identity" "current" {}

resource "aws_kms_key" "sns" {
  description             = "${var.name_prefix} alerts SNS encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.sns_kms.json
  tags                    = var.tags
}

data "aws_iam_policy_document" "sns_kms" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid       = "CloudWatchAlarms"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "backup.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic" "alerts" {
  name              = "${var.name_prefix}-alerts"
  kms_master_key_id = aws_kms_key.sns.arn
  tags              = var.tags
}

data "aws_iam_policy_document" "alerts" {
  statement {
    sid       = "AccountOwner"
    actions   = ["SNS:Publish", "SNS:Subscribe", "SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:ListSubscriptionsByTopic"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid       = "AwsServicesPublish"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "backup.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_emails)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  actions = [aws_sns_topic.alerts.arn]

  rds_alarms = var.enable_rds_alarms ? {
    cpu = {
      metric = "CPUUtilization", stat = "Average", op = "GreaterThanThreshold", threshold = 80, periods = 3,
      desc   = "RDS CPU > 80% for 15 minutes"
    }
    free-storage = {
      metric = "FreeStorageSpace", stat = "Minimum", op = "LessThanThreshold", threshold = var.rds_free_storage_threshold_bytes, periods = 1,
      desc   = "RDS free storage below threshold"
    }
    connections = {
      metric = "DatabaseConnections", stat = "Maximum", op = "GreaterThanThreshold", threshold = var.rds_max_connections_threshold, periods = 2,
      desc   = "RDS connection count high (check connection pooling)"
    }
    freeable-memory = {
      metric = "FreeableMemory", stat = "Minimum", op = "LessThanThreshold", threshold = 268435456, periods = 3,
      desc   = "RDS freeable memory < 256 MiB"
    }
  } : {}

  redis_alarm_defs = {
    engine-cpu = { metric = "EngineCPUUtilization", stat = "Average", op = "GreaterThanThreshold", threshold = 75, periods = 3, desc = "Redis engine CPU > 75%" }
    memory     = { metric = "DatabaseMemoryUsagePercentage", stat = "Average", op = "GreaterThanThreshold", threshold = 80, periods = 3, desc = "Redis memory > 80%" }
    evictions  = { metric = "Evictions", stat = "Sum", op = "GreaterThanThreshold", threshold = 100, periods = 3, desc = "Redis evicting keys" }
  }

  redis_alarms = var.enable_elasticache_alarms ? merge([
    for node in var.elasticache_member_cluster_ids : {
      for k, d in local.redis_alarm_defs : "${node}|${k}" => merge(d, { node = node, name = k })
    }
  ]...) : {}

  msk_alarms = var.enable_msk_alarms ? {
    for b in range(1, var.msk_broker_count + 1) : tostring(b) => b
  } : {}
}

resource "aws_cloudwatch_metric_alarm" "rds" {
  for_each = local.rds_alarms

  alarm_name          = "${var.name_prefix}-rds-${each.key}"
  alarm_description   = each.value.desc
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  statistic           = each.value.stat
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  period              = 300
  evaluation_periods  = each.value.periods
  treat_missing_data  = "notBreaching"
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
  alarm_actions = local.actions
  ok_actions    = local.actions
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis" {
  for_each = local.redis_alarms

  alarm_name          = "${var.name_prefix}-redis-${each.value.node}-${each.value.name}"
  alarm_description   = each.value.desc
  namespace           = "AWS/ElastiCache"
  metric_name         = each.value.metric
  statistic           = each.value.stat
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  period              = 300
  evaluation_periods  = each.value.periods
  treat_missing_data  = "notBreaching"
  dimensions = {
    CacheClusterId = each.value.node
  }
  alarm_actions = local.actions
  ok_actions    = local.actions
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "msk_disk" {
  for_each = local.msk_alarms

  alarm_name          = "${var.name_prefix}-msk-broker-${each.key}-disk"
  alarm_description   = "MSK broker ${each.key} data log disk > 80%"
  namespace           = "AWS/Kafka"
  metric_name         = "KafkaDataLogsDiskUsed"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  dimensions = {
    "Cluster Name" = var.msk_cluster_name
    "Broker ID"    = each.key
  }
  alarm_actions = local.actions
  ok_actions    = local.actions
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "msk_offline_partitions" {
  count = var.enable_msk_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-msk-offline-partitions"
  alarm_description   = "MSK has offline partitions"
  namespace           = "AWS/Kafka"
  metric_name         = "OfflinePartitionsCount"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"
  dimensions = {
    "Cluster Name" = var.msk_cluster_name
  }
  alarm_actions = local.actions
  ok_actions    = local.actions
  tags          = var.tags
}
