################################################################################
# Image signing (cosign with AWS KMS) + Jenkins CI IAM user
#
# The cosign private key never leaves KMS: Jenkins signs with
#   cosign sign --key awskms:///alias/shopverse-cosign <image>@<digest>
# and anybody (Kyverno verifyImages, CI) verifies with the public key
# (output.cosign_public_key_pem or `cosign public-key --key awskms:///...`).
#
# Jenkins runs on EC2 (terraform/ci) and gets these permissions through its
# instance role, which attaches the `shopverse-jenkins-ci` policy below. No
# access key exists. Set create_jenkins_ci_user = true only if you run Jenkins
# outside AWS (laptop): the `jenkins-ci` user then gets the same policy, and its
# key is created out of band (ansible/playbooks/runbooks/rotate-jenkins-keys.yml)
# and stored ONLY in the Jenkins credentials store.
################################################################################

resource "aws_kms_key" "cosign" {
  description              = "${var.project} cosign container image signing key"
  customer_master_key_spec = "ECC_NIST_P256"
  key_usage                = "SIGN_VERIFY"
  deletion_window_in_days  = 30
  policy                   = data.aws_iam_policy_document.cosign_key.json
}

resource "aws_kms_alias" "cosign" {
  name          = "alias/${var.project}-cosign"
  target_key_id = aws_kms_key.cosign.key_id
}

data "aws_iam_policy_document" "cosign_key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  # The Jenkins EC2 role (terraform/ci) and the optional jenkins-ci user are
  # granted kms:Sign through the shopverse-jenkins-ci IAM policy, which the
  # account-root statement above delegates to IAM.

  statement {
    sid       = "Verify"
    actions   = ["kms:Verify", "kms:GetPublicKey", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.gha_plan.arn, aws_iam_role.gha_apply.arn]
    }
  }
}

data "aws_kms_public_key" "cosign" {
  key_id = aws_kms_key.cosign.arn
}

resource "aws_iam_user" "jenkins_ci" {
  count = var.create_jenkins_ci_user ? 1 : 0
  name  = "jenkins-ci"
  path = "/ci/"
  tags = {
    Purpose        = "Jenkins image build/push/sign"
    CredentialHome = "jenkins-credentials-store-only"
  }
}

data "aws_iam_policy_document" "jenkins_ci" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings",
      "ecr:ListImages",
    ]
    resources = [for r in aws_ecr_repository.service : r.arn]
  }

  statement {
    sid       = "CosignSign"
    actions   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
    resources = [aws_kms_key.cosign.arn]
  }

  # ECR repositories are KMS (aws/ecr) encrypted.
  statement {
    sid       = "EcrKms"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ecr.${local.region}.amazonaws.com"]
    }
  }

  # Laptop mode only: keys are rotated by the runbook while authenticated as the user itself.
  dynamic "statement" {
    for_each = var.create_jenkins_ci_user ? [1] : []
    content {
      sid       = "SelfRotateKeys"
      actions   = ["iam:CreateAccessKey", "iam:DeleteAccessKey", "iam:ListAccessKeys", "iam:UpdateAccessKey", "iam:GetAccessKeyLastUsed"]
      resources = ["arn:${local.partition}:iam::${local.account_id}:user/ci/jenkins-ci"]
    }
  }
}

resource "aws_iam_policy" "jenkins_ci" {
  name        = "${var.project}-jenkins-ci"
  description = "ECR push for shopverse/* and cosign KMS signing only"
  policy      = data.aws_iam_policy_document.jenkins_ci.json
}

resource "aws_iam_user_policy_attachment" "jenkins_ci" {
  count      = var.create_jenkins_ci_user ? 1 : 0
  user       = aws_iam_user.jenkins_ci[0].name
  policy_arn = aws_iam_policy.jenkins_ci.arn
}
