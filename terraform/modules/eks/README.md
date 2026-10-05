# `eks` module

EKS 1.31 cluster built on `terraform-aws-modules/eks/aws` v20.37.2.

- Private and public endpoints. The public endpoint only accepts `endpoint_public_access_cidrs`.
- Kubernetes Secrets use envelope encryption with a module-managed KMS key. All 5 control-plane log types go to CloudWatch.
- `authentication_mode = API` (access entries only). Admin and view roles are listed explicitly, and the CI apply role `shopverse-gha-apply` is always added by the env stack.
- Managed node group `system` runs AL2023 with IMDSv2 only, gp3 encrypted root disks, and the taint `CriticalAddonsOnly=true:NoSchedule`. Application pods run on Karpenter nodes.
- Add-ons: vpc-cni (prefix delegation + network policy), coredns, kube-proxy, eks-pod-identity-agent, aws-ebs-csi-driver (IRSA role from `modules/irsa`).
- The node security group is tagged `karpenter.sh/discovery`.

## Usage

```hcl
module "eks" {
  source                       = "../../modules/eks"
  cluster_name                 = "shopverse-dev"
  vpc_id                       = module.vpc.vpc_id
  subnet_ids                   = module.vpc.private_subnet_ids
  endpoint_public_access_cidrs = ["203.0.113.0/24"]
  cluster_admin_role_arns      = ["arn:aws:iam::786896018375:role/shopverse-gha-apply"]
  ebs_csi_role_arn             = module.irsa.ebs_csi_role_arn
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `cluster_name` | `string` | yes | EKS cluster name (shopverse-<env>). |
| `cluster_version` | `string` | no | Kubernetes version. |
| `vpc_id` | `string` | yes |  |
| `subnet_ids` | `list(string)` | yes | Private subnets for nodes. |
| `control_plane_subnet_ids` | `list(string)` | no | Subnets for the control plane ENIs (defaults to subnet_ids). |
| `endpoint_public_access_cidrs` | `list(string)` | yes | CIDRs allowed to reach the public API endpoint (office/VPN/CI egress). The private endpoint is always on. |
| `system_node_instance_types` | `list(string)` | no | Instance types of the managed system node group. |
| `system_node_capacity_type` | `string` | no | ON_DEMAND or SPOT for the system node group. |
| `system_node_min_size` | `number` | no |  |
| `system_node_max_size` | `number` | no |  |
| `system_node_desired_size` | `number` | no |  |
| `system_node_disk_size` | `number` | no | Root volume size (GiB) for system nodes. |
| `cluster_admin_role_arns` | `list(string)` | no | IAM role ARNs granted AmazonEKSClusterAdminPolicy (CI apply role, break-glass admin role). |
| `cluster_view_role_arns` | `list(string)` | no | IAM role ARNs granted read-only AmazonEKSViewPolicy. |
| `access_entries` | `any` | no | Additional raw access entries passed to terraform-aws-modules/eks. |
| `ebs_csi_role_arn` | `string` | yes | IRSA role ARN for the aws-ebs-csi-driver add-on (from modules/irsa). |
| `cluster_log_types` | `list(string)` | no | Control plane log types shipped to CloudWatch. |
| `cluster_log_retention_days` | `number` | no |  |
| `volume_tags` | `map(string)` | no | Tags the EBS CSI driver adds to every dynamically provisioned volume (cost allocation + nightly cleanup). |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `cluster_name` |  |
| `cluster_arn` |  |
| `cluster_endpoint` |  |
| `cluster_version` |  |
| `cluster_certificate_authority_data` |  |
| `oidc_provider_arn` |  |
| `oidc_provider` | OIDC issuer host/path without https:// (used in IRSA trust conditions). |
| `node_security_group_id` |  |
| `cluster_security_group_id` |  |
| `cluster_primary_security_group_id` |  |
| `kms_key_arn` |  |
