locals {
  admin_entries = {
    for i, arn in var.cluster_admin_role_arns : "admin-${i}" => {
      principal_arn = arn
      policy_associations = {
        admin = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }

  view_entries = {
    for i, arn in var.cluster_view_role_arns : "view-${i}" => {
      principal_arn = arn
      policy_associations = {
        view = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.37.2"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  vpc_id                   = var.vpc_id
  subnet_ids               = var.subnet_ids
  control_plane_subnet_ids = length(var.control_plane_subnet_ids) > 0 ? var.control_plane_subnet_ids : var.subnet_ids

  cluster_endpoint_private_access      = true
  cluster_endpoint_public_access       = true
  cluster_endpoint_public_access_cidrs = var.endpoint_public_access_cidrs

  # Envelope encryption of Kubernetes Secrets with a module-managed CMK.
  create_kms_key                  = true
  kms_key_description             = "${var.cluster_name} EKS secrets encryption"
  kms_key_deletion_window_in_days = 7
  enable_kms_key_rotation         = true
  cluster_encryption_config = {
    resources = ["secrets"]
  }

  cluster_enabled_log_types              = var.cluster_log_types
  cloudwatch_log_group_retention_in_days = var.cluster_log_retention_days

  enable_irsa = true

  # Access entries only (no aws-auth ConfigMap). Admins are explicit so the
  # cluster stays manageable no matter who/what ran the first apply.
  authentication_mode                      = "API"
  enable_cluster_creator_admin_permissions = false
  access_entries                           = merge(local.admin_entries, local.view_entries, var.access_entries)

  cluster_addons = {
    vpc-cni = {
      most_recent    = true
      before_compute = true
      configuration_values = jsonencode({
        env = {
          ENABLE_PREFIX_DELEGATION = "true"
          WARM_PREFIX_TARGET       = "1"
        }
        enableNetworkPolicy = "true"
      })
    }
    coredns = {
      most_recent = true
      configuration_values = jsonencode({
        tolerations = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
      })
    }
    kube-proxy = {
      most_recent = true
    }
    eks-pod-identity-agent = {
      most_recent    = true
      before_compute = true
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = var.ebs_csi_role_arn
      configuration_values = jsonencode({
        controller = {
          tolerations     = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
          extraVolumeTags = merge(var.volume_tags, { "shopverse.io/cluster" = var.cluster_name })
        }
      })
    }
  }

  eks_managed_node_groups = {
    system = {
      name            = "${var.cluster_name}-system"
      use_name_prefix = true

      # Explicit short role name (the module's default name_prefix exceeds IAM's 38 chars)
      iam_role_name            = "${var.cluster_name}-system-node"
      iam_role_use_name_prefix = false
      ami_type                 = "AL2023_x86_64_STANDARD"
      instance_types           = var.system_node_instance_types
      capacity_type            = var.system_node_capacity_type

      min_size     = var.system_node_min_size
      max_size     = var.system_node_max_size
      desired_size = var.system_node_desired_size

      labels = {
        "shopverse.io/node-role" = "system"
      }

      # Only critical add-ons (CoreDNS, Karpenter, LBC, EBS CSI, ...) that
      # tolerate this taint run here; workloads go to Karpenter nodes.
      taints = {
        critical = {
          key    = "CriticalAddonsOnly"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      }

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = var.system_node_disk_size
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }

      metadata_options = {
        http_endpoint               = "enabled"
        http_tokens                 = "required"
        http_put_response_hop_limit = 1
      }

      iam_role_additional_policies = {
        ssm = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
      }
    }
  }

  # Karpenter discovers the node security group by this tag.
  node_security_group_tags = {
    "karpenter.sh/discovery" = var.cluster_name
  }

  tags = var.tags
}
