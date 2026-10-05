################################################################################
# HTTPS entry point: jenkins.ganga888.in and sonarqube.ganga888.in
################################################################################

resource "aws_acm_certificate" "ci" {
  domain_name               = local.jenkins_fqdn
  subject_alternative_names = [local.sonar_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  # Static keys: domain names are known at plan time even though the records are not.
  for_each = toset([local.jenkins_fqdn, local.sonar_fqdn])

  zone_id         = data.aws_route53_zone.root.zone_id
  name            = one([for o in aws_acm_certificate.ci.domain_validation_options : o.resource_record_name if o.domain_name == each.value])
  type            = one([for o in aws_acm_certificate.ci.domain_validation_options : o.resource_record_type if o.domain_name == each.value])
  records         = [one([for o in aws_acm_certificate.ci.domain_validation_options : o.resource_record_value if o.domain_name == each.value])]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "ci" {
  certificate_arn         = aws_acm_certificate.ci.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_lb" "ci" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  idle_timeout               = 120 # long-polling Jenkins UI / log streaming
  enable_deletion_protection = false
}

resource "aws_lb_target_group" "jenkins" {
  name     = "${local.name}-jenkins"
  port     = 8085
  protocol = "HTTP"
  vpc_id   = aws_vpc.this.id

  health_check {
    path    = "/login"
    matcher = "200,403"
  }
}

resource "aws_lb_target_group" "sonarqube" {
  name     = "${local.name}-sonarqube"
  port     = 9000
  protocol = "HTTP"
  vpc_id   = aws_vpc.this.id

  health_check {
    path    = "/api/system/status"
    matcher = "200"
  }
}

resource "aws_lb_target_group_attachment" "jenkins" {
  target_group_arn = aws_lb_target_group.jenkins.arn
  target_id        = aws_instance.jenkins.id
  port             = 8085
}

resource "aws_lb_target_group_attachment" "sonarqube" {
  target_group_arn = aws_lb_target_group.sonarqube.arn
  target_id        = aws_instance.jenkins.id
  port             = 9000
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.ci.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.ci.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.ci.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

# GitHub webhooks: only this path is reachable from GitHub's hook ranges.
resource "aws_lb_listener_rule" "github_webhook" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    host_header {
      values = [local.jenkins_fqdn]
    }
  }
  condition {
    path_pattern {
      values = ["/github-webhook/*", "/github-webhook"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.jenkins.arn
  }
}

# Everything else only from admin CIDRs (the security group also lets GitHub in, so check again here).
resource "aws_lb_listener_rule" "jenkins" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  condition {
    host_header {
      values = [local.jenkins_fqdn]
    }
  }
  condition {
    source_ip {
      values = var.admin_cidrs
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.jenkins.arn
  }
}

resource "aws_lb_listener_rule" "sonarqube" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30

  condition {
    host_header {
      values = [local.sonar_fqdn]
    }
  }
  condition {
    source_ip {
      values = var.admin_cidrs
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sonarqube.arn
  }
}

resource "aws_route53_record" "ci" {
  for_each = toset([local.jenkins_fqdn, local.sonar_fqdn])
  zone_id  = data.aws_route53_zone.root.zone_id
  name     = each.value
  type     = "A"

  alias {
    name                   = aws_lb.ci.dns_name
    zone_id                = aws_lb.ci.zone_id
    evaluate_target_health = false
  }
}
