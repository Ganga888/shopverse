module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "20.37.2"

  cluster_name = var.cluster_name

  enable_v1_permissions = true

  # Controller credentials: EKS Pod Identity association AND an IRSA trust,
  # so the chart works whether or not the ServiceAccount carries the
  # eks.amazonaws.com/role-arn annotation (gitops sets it).
  enable_pod_identity             = true
  create_pod_identity_association = true
  namespace                       = var.namespace
  service_account                 = var.service_account

  enable_irsa                     = true
  irsa_oidc_provider_arn          = var.oidc_provider_arn
  irsa_namespace_service_accounts = ["${var.namespace}:${var.service_account}"]

  iam_role_name            = "${var.cluster_name}-karpenter"
  iam_role_use_name_prefix = false

  node_iam_role_name            = "${var.cluster_name}-karpenter-node"
  node_iam_role_use_name_prefix = false
  node_iam_role_additional_policies = {
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  }

  # SQS queue + EventBridge rules for spot interruption / rebalance / health events.
  enable_spot_termination = true
  queue_name              = "${var.cluster_name}-karpenter"

  tags = var.tags
}
