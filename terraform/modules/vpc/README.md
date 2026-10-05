# `vpc` module

3-AZ VPC built on `terraform-aws-modules/vpc/aws` 5.21.0.

- Public `/24`, private `/19` (room for VPC-CNI prefix delegation) and database `/24` subnets per AZ, carved from one `/16`.
- `one_nat_gateway_per_az = false` gives one shared NAT gateway (dev/staging). `true` gives one per AZ (prod).
- Subnet tags: `kubernetes.io/role/elb` (public), `kubernetes.io/role/internal-elb` and `karpenter.sh/discovery=<cluster>` (private).
- VPC flow logs go to CloudWatch with 60s aggregation. The default SG has no rules. An S3 gateway endpoint keeps ECR and S3 traffic off the NAT.

## Usage

```hcl
module "vpc" {
  source                 = "../../modules/vpc"
  name                   = "shopverse-prod"
  cidr                   = "10.30.0.0/16"
  one_nat_gateway_per_az = true
  cluster_name           = "shopverse-prod"
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | yes | Name prefix, e.g. shopverse-dev. |
| `cidr` | `string` | yes | VPC CIDR (a /16 is expected; subnets are carved with cidrsubnet). |
| `az_count` | `number` | no | Number of availability zones to span. |
| `one_nat_gateway_per_az` | `bool` | no | true = one NAT gateway per AZ (HA, prod). false = a single shared NAT gateway (dev/staging). |
| `cluster_name` | `string` | yes | EKS cluster name used for kubernetes.io/cluster and karpenter.sh/discovery subnet tags. |
| `enable_flow_logs` | `bool` | no | Send VPC flow logs to CloudWatch Logs. |
| `flow_log_retention_days` | `number` | no | CloudWatch retention for VPC flow logs. |
| `tags` | `map(string)` | no | Extra tags. |

## Outputs

| Name | Description |
|---|---|
| `vpc_id` |  |
| `vpc_cidr_block` |  |
| `azs` |  |
| `private_subnet_ids` |  |
| `public_subnet_ids` |  |
| `database_subnet_ids` |  |
| `database_subnet_group_name` |  |
| `nat_public_ips` | Egress IPs (allow-list these at third parties such as the payment gateway). |
| `private_route_table_ids` |  |
