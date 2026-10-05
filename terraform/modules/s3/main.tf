data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_elb_service_account" "this" {}

locals {
  buckets = {
    web    = "${var.name_prefix}-web"
    media  = "${var.name_prefix}-media"
    audit  = "${var.name_prefix}-audit"
    velero = "${var.name_prefix}-velero"
    logs   = "${var.name_prefix}-logs"
  }

  # web/media are read by CloudFront OAC with SSE-S3; audit/velero use a CMK;
  # logs must be SSE-S3 for ALB / CloudFront log delivery.
  kms_buckets = toset(["audit", "velero"])
}

resource "aws_kms_key" "data" {
  description             = "${var.name_prefix} S3 (audit, velero) encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name_prefix}-s3"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets

  bucket              = each.value
  force_destroy       = var.force_destroy
  object_lock_enabled = each.key == "audit" && var.audit_object_lock_days > 0

  tags = merge(var.tags, { Name = each.value, Purpose = each.key })
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  rule {
    # CloudFront standard logging still writes with ACLs.
    object_ownership = each.key == "logs" ? "BucketOwnerPreferred" : "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_acl" "logs" {
  bucket = aws_s3_bucket.this["logs"].id
  access_control_policy {
    owner {
      id = data.aws_canonical_user_id.current.id
    }
    grant {
      grantee {
        id   = data.aws_canonical_user_id.current.id
        type = "CanonicalUser"
      }
      permission = "FULL_CONTROL"
    }
    # awslogsdelivery account used by CloudFront standard logs
    grant {
      grantee {
        id   = "c4c1ede66af53448b93c283ce9448c4ba468c9432aa01d700d3878632f77d2d0"
        type = "CanonicalUser"
      }
      permission = "FULL_CONTROL"
    }
  }

  depends_on = [aws_s3_bucket_ownership_controls.this]
}

data "aws_canonical_user_id" "current" {}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = contains(local.kms_buckets, each.key) ? "aws:kms" : "AES256"
      kms_master_key_id = contains(local.kms_buckets, each.key) ? aws_kms_key.data.arn : null
    }
    bucket_key_enabled = contains(local.kms_buckets, each.key)
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  count = var.audit_object_lock_days > 0 ? 1 : 0

  bucket = aws_s3_bucket.this["audit"].id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.audit_object_lock_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_logging" "this" {
  for_each = { for k, v in aws_s3_bucket.this : k => v if k != "logs" }

  bucket        = each.value.id
  target_bucket = aws_s3_bucket.this["logs"].id
  target_prefix = "s3/${each.key}/"
}

################################################################################
# Lifecycle
################################################################################

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.this["web"].id
  rule {
    id     = "expire-old-builds"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.this["media"].id
  rule {
    id     = "tiering"
    status = "Enabled"
    filter {}
    transition {
      days          = 30
      storage_class = "INTELLIGENT_TIERING"
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.this["audit"].id
  rule {
    id     = "archive"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
    expiration {
      days = var.audit_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "velero" {
  bucket = aws_s3_bucket.this["velero"].id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = var.velero_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.this["logs"].id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    expiration {
      days = var.logs_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_cors_configuration" "media" {
  count = length(var.media_cors_allowed_origins) > 0 ? 1 : 0

  bucket = aws_s3_bucket.this["media"].id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.media_cors_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

################################################################################
# Bucket policies
################################################################################

data "aws_iam_policy_document" "bucket" {
  for_each = local.buckets

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # CloudFront Origin Access Control (web + media)
  dynamic "statement" {
    for_each = var.enable_cloudfront_oac && contains(["web", "media"], each.key) ? [1] : []
    content {
      sid       = "AllowCloudFrontOAC"
      actions   = ["s3:GetObject"]
      resources = ["${aws_s3_bucket.this[each.key].arn}/*"]
      principals {
        type        = "Service"
        identifiers = ["cloudfront.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [each.key == "web" ? var.web_distribution_arn : var.media_distribution_arn]
      }
    }
  }

  # ALB access logs + S3 server access logs land in the logs bucket.
  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "ALBAccessLogs"
      actions   = ["s3:PutObject"]
      resources = ["${aws_s3_bucket.this["logs"].arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
      principals {
        type        = "AWS"
        identifiers = [data.aws_elb_service_account.this.arn]
      }
    }
  }

  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "S3ServerAccessLogs"
      actions   = ["s3:PutObject"]
      resources = ["${aws_s3_bucket.this["logs"].arn}/s3/*"]
      principals {
        type        = "Service"
        identifiers = ["logging.s3.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "aws:SourceAccount"
        values   = [data.aws_caller_identity.current.account_id]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each = local.buckets

  bucket = aws_s3_bucket.this[each.key].id
  policy = data.aws_iam_policy_document.bucket[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.this]
}
