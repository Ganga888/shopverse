################################################################################
# Instance role: SSM (admin shell + Ansible), CloudWatch agent, ECR push + cosign
# signing (shared shopverse-jenkins-ci policy), its own secret and SSM bucket.
################################################################################

resource "aws_iam_role" "jenkins" {
  name = "${local.name}-jenkins"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "jenkins" {
  for_each = {
    ssm        = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
    cloudwatch = "arn:${local.partition}:iam::aws:policy/CloudWatchAgentServerPolicy"
    ci         = data.aws_iam_policy.jenkins_ci.arn
  }
  role       = aws_iam_role.jenkins.name
  policy_arn = each.value
}

resource "aws_iam_role_policy" "jenkins" {
  name = "ci-secret-and-ssm-bucket"
  role = aws_iam_role.jenkins.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadCiSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = aws_secretsmanager_secret.jenkins.arn
      },
      {
        Sid      = "AnsibleSsmTransfers"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.ssm.arn, "${aws_s3_bucket.ssm.arn}/*"]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "jenkins" {
  name = "${local.name}-jenkins"
  role = aws_iam_role.jenkins.name
}

################################################################################
# Secrets (values never in Git or tfstate for the tokens you add later)
################################################################################

resource "random_password" "admin" {
  length  = 24
  special = false
}

resource "random_password" "sonar_db" {
  length  = 24
  special = false
}

# shopverse/ci/jenkins { JENKINS_ADMIN_PASSWORD, SONAR_DB_PASSWORD, GITHUB_USER, GITHUB_TOKEN, SONAR_TOKEN }
# The host reads it with its instance role at start-up (/usr/local/sbin/jenkins-secrets-env).
# Set GITHUB_TOKEN and SONAR_TOKEN after the first boot:
#   aws secretsmanager put-secret-value --secret-id shopverse/ci/jenkins --secret-string file://jenkins-secret.json
resource "aws_secretsmanager_secret" "jenkins" {
  name                    = "${var.project}/ci/jenkins"
  description             = "Jenkins/SonarQube credentials read by the CI host"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jenkins" {
  secret_id = aws_secretsmanager_secret.jenkins.id
  secret_string = jsonencode({
    JENKINS_ADMIN_PASSWORD = random_password.admin.result
    SONAR_DB_PASSWORD      = random_password.sonar_db.result
    GITHUB_USER            = "shopverse-ci"
    GITHUB_TOKEN           = "REPLACE_ME"
    SONAR_TOKEN            = "REPLACE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}

################################################################################
# Bucket Ansible's SSM connection plugin uses for file transfers
################################################################################

resource "aws_s3_bucket" "ssm" {
  bucket        = "${local.name}-ssm-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "ssm" {
  bucket                  = aws_s3_bucket.ssm.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ssm" {
  bucket = aws_s3_bucket.ssm.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "ssm" {
  bucket = aws_s3_bucket.ssm.id
  rule {
    id     = "expire-transfers"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

################################################################################
# Instance + data volume
################################################################################

resource "aws_ebs_volume" "data" {
  availability_zone = local.azs[0]
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags = {
    Name     = "${local.name}-jenkins-data"
    Snapshot = "${local.name}-jenkins-data"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "jenkins" {
  ami                    = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.jenkins.id]
  iam_instance_profile   = aws_iam_instance_profile.jenkins.name
  monitoring             = true
  ebs_optimized          = true

  # Containers (Jenkins runs aws/cosign inside Docker) need hop limit 2 to reach IMDSv2.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    data_volume_id = aws_ebs_volume.data.id
  })
  user_data_replace_on_change = false

  tags = { Name = "${local.name}-jenkins", Role = "jenkins" }

  lifecycle {
    ignore_changes = [ami] # new AMIs are rolled deliberately (taint/replace), not on every plan
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.jenkins.id
}

################################################################################
# Daily snapshots of the data volume (Jenkins home + SonarQube)
################################################################################

resource "aws_iam_role" "dlm" {
  name = "${local.name}-dlm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "data" {
  description        = "Daily snapshots of the Jenkins data volume"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = "${local.name}-jenkins-data" }

    schedule {
      name      = "daily"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["20:30"] # UTC = 02:00 IST
      }

      retain_rule {
        count = var.snapshot_retention_days
      }
    }
  }
}

################################################################################
# Optional office-hours schedule (EventBridge Scheduler)
################################################################################

resource "aws_iam_role" "scheduler" {
  count = var.office_hours_schedule ? 1 : 0
  name  = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  count = var.office_hours_schedule ? 1 : 0
  name  = "start-stop-jenkins"
  role  = aws_iam_role.scheduler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:StartInstances", "ec2:StopInstances"]
      Resource = aws_instance.jenkins.arn
    }]
  })
}

resource "aws_scheduler_schedule" "jenkins" {
  for_each = var.office_hours_schedule ? {
    start = { cron = "cron(0 8 ? * MON-FRI *)", action = "startInstances" }
    stop  = { cron = "cron(0 21 * * ? *)", action = "stopInstances" }
  } : {}

  name                         = "${local.name}-jenkins-${each.key}"
  schedule_expression          = each.value.cron
  schedule_expression_timezone = "Asia/Kolkata"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${local.partition}:scheduler:::aws-sdk:ec2:${each.value.action}"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.jenkins.id] })
  }
}
