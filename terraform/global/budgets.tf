################################################################################
# Cost controls: AWS Budgets (50/80/100%) + Cost Anomaly Detection -> SNS email
################################################################################

resource "aws_sns_topic" "billing_alerts" {
  name = "${var.project}-billing-alerts"
  # Budgets / Cost Anomaly Detection cannot publish to topics encrypted with
  # the AWS-managed aws/sns key; a CMK with a service grant is used instead.
  kms_master_key_id = aws_kms_key.billing_sns.arn
}

data "aws_iam_policy_document" "billing_sns_kms" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid       = "BillingServicesPublish"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com", "costalerts.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "billing_sns" {
  description             = "${var.project} billing alert SNS encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.billing_sns_kms.json
}

data "aws_iam_policy_document" "billing_alerts" {
  statement {
    sid       = "AllowBudgets"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.billing_alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "AllowCostAnomaly"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.billing_alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["costalerts.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "billing_alerts" {
  arn    = aws_sns_topic.billing_alerts.arn
  policy = data.aws_iam_policy_document.billing_alerts.json
}

resource "aws_sns_topic_subscription" "billing_email" {
  for_each = toset(var.budget_alert_emails)

  topic_arn = aws_sns_topic.billing_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly-total"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_monthly_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
    }
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
  }

  depends_on = [aws_sns_topic_policy.billing_alerts]
}

# Per-environment budgets using the mandatory Environment cost-allocation tag
# (activate "Environment" as a cost allocation tag in Billing once).
resource "aws_budgets_budget" "env" {
  for_each = {
    dev     = 0.15
    staging = 0.25
    prod    = 0.60
  }

  name         = "${var.project}-${each.key}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(ceil(var.budget_monthly_limit_usd * each.value))
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Environment$%s", each.key)]
  }

  dynamic "notification" {
    for_each = [80, 100]
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
    }
  }

  depends_on = [aws_sns_topic_policy.billing_alerts]
}

resource "aws_ce_anomaly_monitor" "services" {
  count = var.create_cost_anomaly_monitor ? 1 : 0

  name              = "${var.project}-service-monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "services" {
  count = var.create_cost_anomaly_monitor || var.cost_anomaly_monitor_arn != "" ? 1 : 0

  name             = "${var.project}-anomaly-alerts"
  frequency        = "IMMEDIATE"
  monitor_arn_list = [var.create_cost_anomaly_monitor ? aws_ce_anomaly_monitor.services[0].arn : var.cost_anomaly_monitor_arn]

  subscriber {
    type    = "SNS"
    address = aws_sns_topic.billing_alerts.arn
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.cost_anomaly_threshold_usd)]
    }
  }

  depends_on = [aws_sns_topic_policy.billing_alerts]
}

moved {
  from = aws_ce_anomaly_monitor.services
  to   = aws_ce_anomaly_monitor.services[0]
}

moved {
  from = aws_ce_anomaly_subscription.services
  to   = aws_ce_anomaly_subscription.services[0]
}
