data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

locals {
  web_origin_id   = "s3-web"
  api_origin_id   = "alb-api"
  media_origin_id = "s3-media"
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.name_prefix}-s3"
  description                       = "OAC for ${var.name_prefix} web + media buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA routing without distribution-wide custom error pages (those would also
# rewrite real 404s coming from /api/*): extension-less paths -> /index.html.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name_prefix}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite client-side routes to /index.html"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.endsWith('/') || uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOT
}

################################################################################
# Web distribution: S3 SPA + /api/* -> ALB
################################################################################

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "${var.name_prefix} web SPA + API"
  aliases             = var.web_aliases
  default_root_object = "index.html"
  price_class         = var.price_class
  web_acl_id          = aws_wafv2_web_acl.cloudfront.arn

  origin {
    origin_id                = local.web_origin_id
    domain_name              = var.web_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = var.api_origin_domain

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id           = local.web_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  dynamic "logging_config" {
    for_each = var.logs_bucket_domain_name != "" ? [1] : []
    content {
      bucket          = var.logs_bucket_domain_name
      prefix          = "cloudfront/web/"
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-web" })
}

################################################################################
# Media CDN: cdn.<env domain> -> S3 media bucket
################################################################################

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "${var.name_prefix} media CDN"
  aliases         = [var.media_alias]
  price_class     = var.price_class
  web_acl_id      = aws_wafv2_web_acl.cloudfront.arn

  origin {
    origin_id                = local.media_origin_id
    domain_name              = var.media_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  default_cache_behavior {
    target_origin_id           = local.media_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  dynamic "logging_config" {
    for_each = var.logs_bucket_domain_name != "" ? [1] : []
    content {
      bucket          = var.logs_bucket_domain_name
      prefix          = "cloudfront/media/"
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-media" })
}

################################################################################
# DNS
################################################################################

locals {
  alias_records = merge(
    { for a in var.web_aliases : "web|${a}" => { name = a, dist = "web" } },
    { "media|${var.media_alias}" = { name = var.media_alias, dist = "media" } },
  )
  alias_record_types = { for pair in setproduct(keys(local.alias_records), ["A", "AAAA"]) : "${pair[0]}|${pair[1]}" => {
    name = local.alias_records[pair[0]].name
    dist = local.alias_records[pair[0]].dist
    type = pair[1]
  } }
}

resource "aws_route53_record" "alias" {
  for_each = local.alias_record_types

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = each.value.dist == "web" ? aws_cloudfront_distribution.web.domain_name : aws_cloudfront_distribution.media.domain_name
    zone_id                = each.value.dist == "web" ? aws_cloudfront_distribution.web.hosted_zone_id : aws_cloudfront_distribution.media.hosted_zone_id
    evaluate_target_health = false
  }
}
