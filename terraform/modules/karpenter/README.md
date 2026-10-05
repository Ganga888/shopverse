# `karpenter` module

AWS-side resources for Karpenter v1, from the `karpenter` submodule of `terraform-aws-modules/eks/aws`.

- The controller IAM role `shopverse-<env>-karpenter` trusts both EKS Pod Identity (association `kube-system/karpenter`) and IRSA, so the ServiceAccount annotation in GitOps works either way.
- The node IAM role `shopverse-<env>-karpenter-node` gets an EKS access entry and SSM access.
- An SQS interruption queue receives EventBridge rules for spot interruption, rebalance, state-change and health events.
- The `helm_values` output feeds the Karpenter Helm release and the `EC2NodeClass`/`NodePool` in GitOps. Helm itself is installed by ArgoCD, not Terraform.

## Usage

```hcl
module "karpenter" {
  source           = "../../modules/karpenter"
  cluster_name     = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  oidc_provider_arn = module.eks.oidc_provider_arn
  capacity_types    = ["spot"]
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `cluster_name` | `string` | yes |  |
| `cluster_endpoint` | `string` | yes |  |
| `oidc_provider_arn` | `string` | yes | EKS OIDC provider ARN (IRSA trust for the controller role). |
| `namespace` | `string` | no | Namespace the Karpenter controller runs in. |
| `service_account` | `string` | no |  |
| `capacity_types` | `list(string)` | no | Capacity types the default NodePool may use (passed through to Helm/GitOps values). |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `controller_role_arn` |  |
| `node_iam_role_name` | Use as EC2NodeClass spec.role. |
| `node_iam_role_arn` |  |
| `interruption_queue_name` |  |
| `helm_values` | Values for the karpenter Helm chart / GitOps platform app. |
