output "environment" {
  value = var.environment
}

output "env_domain" {
  value = local.env_domain
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "nat_public_ips" {
  value = module.vpc.nat_public_ips
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "kubeconfig_command" {
  value = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}"
}

output "irsa_role_arns" {
  description = "IRSA roles: aws-load-balancer-controller, external-dns, external-secrets, velero, ebs-csi, media-service, audit-service, notification-service."
  value       = module.irsa.role_arns
}

output "karpenter" {
  description = "Values for the Karpenter Helm release / EC2NodeClass."
  value       = module.karpenter.helm_values
}

output "waf_regional_acl_arn" {
  description = "alb.ingress.kubernetes.io/wafv2-acl-arn"
  value       = module.waf_regional.web_acl_arn
}

output "waf_cloudfront_acl_arn" {
  value = module.cloudfront.waf_web_acl_arn
}

output "alb_certificate_arn" {
  description = "alb.ingress.kubernetes.io/certificate-arn (api.<env domain>, *.<env domain>)"
  value       = module.acm.certificate_arn
}

output "cloudfront_certificate_arn" {
  value = data.aws_acm_certificate.cloudfront.arn
}

output "cloudfront_web_distribution_id" {
  value = module.cloudfront.web_distribution_id
}

output "cloudfront_media_distribution_id" {
  value = module.cloudfront.media_distribution_id
}

output "bucket_names" {
  value = module.s3.bucket_names
}

output "rds_endpoint" {
  value = var.use_managed_data ? module.rds[0].endpoint : "${var.in_cluster_postgres_host}:5432"
}

output "rds_master_secret_arn" {
  value = var.use_managed_data ? module.rds[0].master_user_secret_arn : null
}

output "redis_endpoint" {
  value = var.use_managed_data ? module.elasticache[0].endpoint : var.in_cluster_redis_url
}

output "msk_bootstrap_brokers" {
  description = "SASL/SCRAM (9096) brokers; credentials in the AmazonMSK_shopverse_<env>_app secret."
  value       = var.use_managed_data ? module.msk[0].bootstrap_brokers_sasl_scram : "shopverse-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092"
}

output "msk_scram_secret_name" {
  value = var.use_managed_data ? module.msk[0].scram_secret_name : null
}

output "alerts_topic_arn" {
  value = module.observability.alerts_topic_arn
}

# Aliases referenced by gitops/ "tf-output:" comments.
output "acm_certificate_arn" {
  description = "Same as alb_certificate_arn."
  value       = module.acm.certificate_arn
}

output "karpenter_node_role_name" {
  value = module.karpenter.node_iam_role_name
}

output "external_secrets_role_arn" {
  value = module.irsa.external_secrets_role_arn
}

output "aws_load_balancer_controller_role_arn" {
  value = module.irsa.aws_load_balancer_controller_role_arn
}

output "external_dns_role_arn" {
  value = module.irsa.external_dns_role_arn
}

output "velero_role_arn" {
  value = module.irsa.velero_role_arn
}

output "karpenter_interruption_queue" {
  value = module.karpenter.interruption_queue_name
}

output "vpc_cidr" {
  value = module.vpc.vpc_cidr_block
}

output "msk_bootstrap_brokers_tls" {
  description = "TLS-only listener (9094); empty unless msk_allow_unauthenticated_tls = true."
  value       = var.use_managed_data ? module.msk[0].bootstrap_brokers_tls : "shopverse-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092"
}
