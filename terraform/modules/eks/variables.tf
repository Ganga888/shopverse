variable "cluster_name" {
  description = "EKS cluster name (shopverse-<env>)."
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version."
  type        = string
  default     = "1.31"
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets for nodes."
  type        = list(string)
}

variable "control_plane_subnet_ids" {
  description = "Subnets for the control plane ENIs (defaults to subnet_ids)."
  type        = list(string)
  default     = []
}

variable "endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the public API endpoint (office/VPN/CI egress). The private endpoint is always on."
  type        = list(string)
}

variable "system_node_instance_types" {
  description = "Instance types of the managed system node group."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "system_node_capacity_type" {
  description = "ON_DEMAND or SPOT for the system node group."
  type        = string
  default     = "ON_DEMAND"
}

variable "system_node_min_size" {
  type    = number
  default = 2
}

variable "system_node_max_size" {
  type    = number
  default = 3
}

variable "system_node_desired_size" {
  type    = number
  default = 2
}

variable "system_node_disk_size" {
  description = "Root volume size (GiB) for system nodes."
  type        = number
  default     = 50
}

variable "cluster_admin_role_arns" {
  description = "IAM role ARNs granted AmazonEKSClusterAdminPolicy (CI apply role, break-glass admin role)."
  type        = list(string)
  default     = []
}

variable "cluster_view_role_arns" {
  description = "IAM role ARNs granted read-only AmazonEKSViewPolicy."
  type        = list(string)
  default     = []
}

variable "access_entries" {
  description = "Additional raw access entries passed to terraform-aws-modules/eks."
  type        = any
  default     = {}
}

variable "ebs_csi_role_arn" {
  description = "IRSA role ARN for the aws-ebs-csi-driver add-on (from modules/irsa)."
  type        = string
}

variable "cluster_log_types" {
  description = "Control plane log types shipped to CloudWatch."
  type        = list(string)
  default     = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

variable "cluster_log_retention_days" {
  type    = number
  default = 30
}

variable "volume_tags" {
  description = "Tags the EBS CSI driver adds to every dynamically provisioned volume (cost allocation + nightly cleanup)."
  type        = map(string)
  default     = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
