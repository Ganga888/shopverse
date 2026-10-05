variable "cluster_name" {
  type = string
}

variable "cluster_endpoint" {
  type = string
}

variable "oidc_provider_arn" {
  description = "EKS OIDC provider ARN (IRSA trust for the controller role)."
  type        = string
}

variable "namespace" {
  description = "Namespace the Karpenter controller runs in."
  type        = string
  default     = "kube-system"
}

variable "service_account" {
  type    = string
  default = "karpenter"
}

variable "capacity_types" {
  description = "Capacity types the default NodePool may use (passed through to Helm/GitOps values)."
  type        = list(string)
  default     = ["spot"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
