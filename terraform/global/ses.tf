################################################################################
# Amazon SES domain identity for notification-service e-mail (from no-reply@ganga888.in).
# DKIM + custom MAIL FROM records are published in the Route 53 zone, so the identity
# verifies by itself once the registrar delegates ganga888.in.
# New accounts start in the SES sandbox: request production access once
# (SES console -> Account dashboard -> Request production access).
################################################################################

resource "aws_ses_domain_identity" "root" {
  domain = var.root_domain
}

resource "aws_route53_record" "ses_verification" {
  zone_id = aws_route53_zone.root.zone_id
  name    = "_amazonses.${var.root_domain}"
  type    = "TXT"
  ttl     = 1800
  records = [aws_ses_domain_identity.root.verification_token]
}

resource "aws_ses_domain_dkim" "root" {
  domain = aws_ses_domain_identity.root.domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = aws_route53_zone.root.zone_id
  name    = "${aws_ses_domain_dkim.root.dkim_tokens[count.index]}._domainkey.${var.root_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_ses_domain_dkim.root.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_ses_domain_mail_from" "root" {
  domain                 = aws_ses_domain_identity.root.domain
  mail_from_domain       = "mail.${var.root_domain}"
  behavior_on_mx_failure = "UseDefaultValue"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = aws_route53_zone.root.zone_id
  name    = "mail.${var.root_domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = aws_route53_zone.root.zone_id
  name    = "mail.${var.root_domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.root.zone_id
  name    = "_dmarc.${var.root_domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=DMARC1; p=quarantine; rua=mailto:dmarc@${var.root_domain}"]
}
