data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.name

  # key => role definition. has_policy is static so for_each keys are known at plan.
  builtin_roles = {
    "aws-load-balancer-controller" = {
      namespace           = "kube-system"
      service_account     = "aws-load-balancer-controller"
      has_policy          = true
      policy_json         = file("${path.module}/policies/aws-load-balancer-controller.json")
      managed_policy_arns = []
    }
    "external-dns" = {
      namespace           = "kube-system"
      service_account     = "external-dns"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.external_dns.json
      managed_policy_arns = []
    }
    "external-secrets" = {
      namespace           = "external-secrets"
      service_account     = "external-secrets"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.external_secrets.json
      managed_policy_arns = []
    }
    "velero" = {
      namespace           = "velero"
      service_account     = "velero"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.velero.json
      managed_policy_arns = []
    }
    "ebs-csi" = {
      namespace           = "kube-system"
      service_account     = "ebs-csi-controller-sa"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.ebs_csi_kms.json
      managed_policy_arns = ["arn:${local.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"]
    }
    "grafana" = {
      namespace           = "monitoring"
      service_account     = "kube-prometheus-stack-grafana"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.grafana.json
      managed_policy_arns = []
    }
    "kyverno" = {
      namespace           = "kyverno"
      service_account     = "kyverno-admission-controller"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.kyverno.json
      managed_policy_arns = []
    }
    "media-service" = {
      namespace           = "shop"
      service_account     = "media-service"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.media.json
      managed_policy_arns = []
    }
    "audit-service" = {
      namespace           = "shop"
      service_account     = "audit-service"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.audit.json
      managed_policy_arns = []
    }
    "notification-service" = {
      namespace           = "shop"
      service_account     = "notification-service"
      has_policy          = true
      policy_json         = data.aws_iam_policy_document.notification.json
      managed_policy_arns = []
    }
  }

  extra_roles = {
    for k, v in var.extra_roles : k => {
      namespace           = v.namespace
      service_account     = v.service_account
      has_policy          = v.policy_json != null
      policy_json         = v.policy_json
      managed_policy_arns = v.managed_policy_arns
    }
  }

  roles = merge(local.builtin_roles, local.extra_roles)

  managed_attachments = merge([
    for k, v in local.roles : { for arn in v.managed_policy_arns : "${k}|${arn}" => { role = k, arn = arn } }
  ]...)
}

################################################################################
# Generic IRSA role
################################################################################

data "aws_iam_policy_document" "trust" {
  for_each = local.roles

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider}:sub"
      values   = ["system:serviceaccount:${each.value.namespace}:${each.value.service_account}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  for_each = local.roles

  name                 = "${var.name_prefix}-${each.key}"
  description          = "IRSA for ${each.value.namespace}/${each.value.service_account}"
  assume_role_policy   = data.aws_iam_policy_document.trust[each.key].json
  max_session_duration = 3600

  tags = merge(var.tags, {
    "shopverse.io/namespace"       = each.value.namespace
    "shopverse.io/service-account" = each.value.service_account
  })
}

resource "aws_iam_role_policy" "this" {
  for_each = { for k, v in local.roles : k => v if v.has_policy }

  name   = each.key
  role   = aws_iam_role.this[each.key].id
  policy = each.value.policy_json
}

resource "aws_iam_role_policy_attachment" "managed" {
  for_each = local.managed_attachments

  role       = aws_iam_role.this[each.value.role].name
  policy_arn = each.value.arn
}

################################################################################
# Policies
################################################################################

data "aws_iam_policy_document" "external_dns" {
  statement {
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = var.route53_zone_arns
  }
  statement {
    actions   = ["route53:ListHostedZones", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
    resources = ["*"]
  }
}

data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid = "ReadEnvSecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = [
      "arn:${local.partition}:secretsmanager:${local.region}:${local.account_id}:secret:shopverse/${var.environment}/*",
      # MSK SCRAM secrets must be prefixed AmazonMSK_
      "arn:${local.partition}:secretsmanager:${local.region}:${local.account_id}:secret:AmazonMSK_shopverse_${var.environment}_*",
    ]
  }

  dynamic "statement" {
    for_each = length(var.additional_secret_arns) > 0 ? [1] : []
    content {
      sid       = "ReadAdditionalSecrets"
      actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      resources = var.additional_secret_arns
    }
  }

  statement {
    sid       = "ListSecrets"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(concat(var.secrets_kms_key_arns, var.additional_kms_key_arns)) > 0 ? [1] : []
    content {
      sid       = "DecryptSecrets"
      actions   = ["kms:Decrypt", "kms:DescribeKey"]
      resources = concat(var.secrets_kms_key_arns, var.additional_kms_key_arns)
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${local.region}.amazonaws.com"]
      }
    }
  }
}

data "aws_iam_policy_document" "velero" {
  statement {
    sid = "EBSSnapshots"
    actions = [
      "ec2:DescribeVolumes",
      "ec2:DescribeSnapshots",
      "ec2:CreateTags",
      "ec2:CreateVolume",
      "ec2:CreateSnapshot",
      "ec2:DeleteSnapshot",
    ]
    resources = ["*"]
  }

  statement {
    sid = "BackupObjects"
    actions = [
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${var.velero_bucket_arn}/*"]
  }

  statement {
    sid       = "BackupBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.velero_bucket_arn]
  }

  statement {
    sid       = "BucketKms"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.velero_kms_key_arn]
  }
}

# Lets the EBS CSI driver use customer-managed keys for encrypted volumes.
data "aws_iam_policy_document" "ebs_csi_kms" {
  statement {
    sid       = "KmsGrantsForEbs"
    actions   = ["kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant"]
    resources = ["*"]
    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }

  statement {
    sid       = "KmsUseForEbs"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ec2.${local.region}.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "media" {
  statement {
    sid       = "MediaObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectAttributes"]
    resources = ["${var.media_bucket_arn}/*"]
  }

  statement {
    sid       = "MediaBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [var.media_bucket_arn]
  }
}

data "aws_iam_policy_document" "audit" {
  # Write-once archive: no DeleteObject.
  statement {
    sid       = "AuditObjects"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.audit_bucket_arn}/*"]
  }

  statement {
    sid       = "AuditBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [var.audit_bucket_arn]
  }

  statement {
    sid       = "AuditKms"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = [var.audit_kms_key_arn]
  }
}

data "aws_iam_policy_document" "notification" {
  statement {
    sid     = "SendEmail"
    actions = ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"]
    resources = length(var.ses_identity_arns) > 0 ? concat(var.ses_identity_arns, [
      "arn:${local.partition}:ses:${local.region}:${local.account_id}:configuration-set/*",
    ]) : ["arn:${local.partition}:ses:${local.region}:${local.account_id}:*"]
    condition {
      test     = "StringLike"
      variable = "ses:FromAddress"
      values   = var.ses_from_addresses
    }
  }

  statement {
    sid       = "Quota"
    actions   = ["ses:GetSendQuota", "ses:GetAccount"]
    resources = ["*"]
  }
}

# Grafana CloudWatch data source (RDS / ElastiCache / MSK dashboards).
data "aws_iam_policy_document" "grafana" {
  statement {
    sid = "CloudWatchRead"
    actions = [
      "cloudwatch:DescribeAlarmsForMetric",
      "cloudwatch:DescribeAlarmHistory",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListMetrics",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetInsightRuleReport",
      "logs:DescribeLogGroups",
      "logs:GetLogGroupFields",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:GetQueryResults",
      "logs:GetLogEvents",
      "ec2:DescribeTags",
      "ec2:DescribeInstances",
      "ec2:DescribeRegions",
      "tag:GetResources",
    ]
    resources = ["*"]
  }
}

# Kyverno verifyImages: pull manifests/signatures from ECR, verify with the cosign KMS key.
data "aws_iam_policy_document" "kyverno" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrRead"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages", "ecr:BatchCheckLayerAvailability"]
    resources = ["arn:${local.partition}:ecr:${local.region}:${local.account_id}:repository/shopverse/*"]
  }

  statement {
    sid       = "CosignVerify"
    actions   = ["kms:GetPublicKey", "kms:Verify", "kms:DescribeKey"]
    resources = ["arn:${local.partition}:kms:${local.region}:${local.account_id}:key/*"]
    condition {
      test     = "ForAnyValue:StringEquals"
      variable = "kms:ResourceAliases"
      values   = ["alias/shopverse-cosign"]
    }
  }
}
