output "controller_role_arn" {
  value = module.karpenter.iam_role_arn
}

output "node_iam_role_name" {
  description = "Use as EC2NodeClass spec.role."
  value       = module.karpenter.node_iam_role_name
}

output "node_iam_role_arn" {
  value = module.karpenter.node_iam_role_arn
}

output "interruption_queue_name" {
  value = module.karpenter.queue_name
}

output "helm_values" {
  description = "Values for the karpenter Helm chart / GitOps platform app."
  value = {
    serviceAccount = {
      name = var.service_account
    }
    settings = {
      clusterName       = var.cluster_name
      clusterEndpoint   = var.cluster_endpoint
      interruptionQueue = module.karpenter.queue_name
    }
    nodeClass = {
      role                = module.karpenter.node_iam_role_name
      subnetSelectorTag   = "karpenter.sh/discovery=${var.cluster_name}"
      securityGroupSelTag = "karpenter.sh/discovery=${var.cluster_name}"
    }
    nodePool = {
      capacityTypes = var.capacity_types
    }
  }
}
