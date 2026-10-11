################################################################################
# GitHub Actions OIDC federation
#
#   shopverse-gha-plan        read-only; PRs + main      (terraform plan)
#   shopverse-gha-apply       admin minus guard-rails; main + environments
#   shopverse-gha-web-deploy  S3 sync + CloudFront invalidation for the SPA
#
# No static AWS keys are stored in GitHub.
################################################################################

locals {
  github_oidc_host = "token.actions.githubusercontent.com"

  gha_plan_subjects = [
    "repo:${var.github_repo}:pull_request",
    "repo:${var.github_repo}:ref:refs/heads/main",
  ]

  # Jobs that declare `environment:` get sub=repo:<repo>:environment:<name>.
  gha_apply_subjects = concat(
    ["repo:${var.github_repo}:ref:refs/heads/main"],
    [for e in var.github_environments : "repo:${var.github_repo}:environment:${e}"],
  )
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  # AWS no longer uses the thumbprint for this provider (it trusts the IdP's
  # CA chain), but the API still requires a value.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "gha_plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "${local.github_oidc_host}:sub"
      values   = local.gha_plan_subjects
    }
  }
}

data "aws_iam_policy_document" "gha_apply_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = local.gha_apply_subjects
    }
  }
}

########################################
# Plan role (read-only)
########################################

resource "aws_iam_role" "gha_plan" {
  name                 = "${var.project}-gha-plan"
  description          = "GitHub Actions terraform plan (read-only) for ${var.github_repo}"
  assume_role_policy   = data.aws_iam_policy_document.gha_plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "gha_plan_readonly" {
  role       = aws_iam_role.gha_plan.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "gha_plan_extra" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketVersioning"]
    resources = ["arn:${local.partition}:s3:::${local.state_bucket}", "arn:${local.partition}:s3:::${local.state_bucket}/*"]
  }

  # plan acquires (and releases) the state lock: an S3 <key>.tflock object (use_lockfile)
  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:${local.partition}:s3:::${local.state_bucket}/*.tflock"]
  }

  statement {
    sid       = "DecryptStateAndSecrets"
    actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [local.account_id]
    }
  }

  # Refreshing aws_secretsmanager_secret_version requires reading the value.
  statement {
    sid     = "RefreshManagedSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:${local.partition}:secretsmanager:${local.region}:${local.account_id}:secret:${var.project}/*",
      "arn:${local.partition}:secretsmanager:${local.region}:${local.account_id}:secret:AmazonMSK_${var.project}_*",
    ]
  }
}

resource "aws_iam_role_policy" "gha_plan_extra" {
  name   = "terraform-plan-extras"
  role   = aws_iam_role.gha_plan.id
  policy = data.aws_iam_policy_document.gha_plan_extra.json
}

########################################
# Apply role
########################################

resource "aws_iam_role" "gha_apply" {
  name                 = "${var.project}-gha-apply"
  description          = "GitHub Actions terraform apply for ${var.github_repo} (main branch / deployment environments)"
  assume_role_policy   = data.aws_iam_policy_document.gha_apply_trust.json
  max_session_duration = 7200 # EKS + MSK creation can take > 1h
}

resource "aws_iam_role_policy_attachment" "gha_apply_admin" {
  role       = aws_iam_role.gha_apply.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AdministratorAccess"
}

# Guard-rails that hold even with AdministratorAccess (explicit deny wins).
data "aws_iam_policy_document" "gha_apply_guardrails" {
  statement {
    sid    = "ProtectAuditTrail"
    effect = "Deny"
    actions = [
      "cloudtrail:DeleteTrail",
      "cloudtrail:StopLogging",
      "cloudtrail:UpdateTrail",
      "cloudtrail:PutEventSelectors",
    ]
    resources = [aws_cloudtrail.main.arn]
  }

  statement {
    sid       = "ProtectStateBackend"
    effect    = "Deny"
    actions   = ["s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning", "dynamodb:DeleteTable"]
    resources = ["arn:${local.partition}:s3:::${local.state_bucket}", "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${var.lock_table_name}"]
  }

  statement {
    sid    = "NoLongLivedCredentials"
    effect = "Deny"
    actions = [
      "iam:CreateAccessKey",
      "iam:CreateLoginProfile",
      "iam:UpdateLoginProfile",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "NoSelfEscalation"
    effect    = "Deny"
    actions   = ["iam:UpdateAssumeRolePolicy", "iam:DeleteRole", "iam:PutRolePermissionsBoundary", "iam:DeleteRolePolicy"]
    resources = [aws_iam_role.gha_apply.arn]
  }

  statement {
    sid       = "NoOrgOrAccountChanges"
    effect    = "Deny"
    actions   = ["organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_apply_guardrails" {
  name   = "guardrails"
  role   = aws_iam_role.gha_apply.id
  policy = data.aws_iam_policy_document.gha_apply_guardrails.json
}

########################################
# Web deploy role (SPA -> S3 + CloudFront invalidation)
########################################

resource "aws_iam_role" "gha_web_deploy" {
  name               = "${var.project}-gha-web-deploy"
  description        = "GitHub Actions SPA deploy (S3 sync + CloudFront invalidation)"
  assume_role_policy = data.aws_iam_policy_document.gha_apply_trust.json
}

data "aws_iam_policy_document" "gha_web_deploy" {
  statement {
    sid       = "SyncWebBuckets"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:${local.partition}:s3:::${var.project}-*-web", "arn:${local.partition}:s3:::${var.project}-*-web/*"]
  }

  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:ListDistributions", "cloudfront:GetDistribution"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_web_deploy" {
  name   = "web-deploy"
  role   = aws_iam_role.gha_web_deploy.id
  policy = data.aws_iam_policy_document.gha_web_deploy.json
}
