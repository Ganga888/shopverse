variable "region" {
  description = "AWS region for the CI host."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name / resource prefix."
  type        = string
  default     = "shopverse"
}

variable "root_domain" {
  description = "Route 53 hosted zone created by terraform/global."
  type        = string
  default     = "ganga888.in"
}

variable "jenkins_hostname" {
  description = "Public hostname of the Jenkins UI (under root_domain)."
  type        = string
  default     = "jenkins"
}

variable "sonarqube_hostname" {
  description = "Public hostname of the SonarQube UI (under root_domain)."
  type        = string
  default     = "sonarqube"
}

variable "vpc_cidr" {
  description = "CIDR of the dedicated CI VPC (kept apart from the EKS VPCs so the nightly dev destroy never touches Jenkins)."
  type        = string
  default     = "10.50.0.0/16"
}

variable "instance_type" {
  description = "Jenkins + SonarQube + parallel Docker builds of 15 services: 4 vCPU / 16 GiB is the comfortable minimum."
  type        = string
  default     = "t3.xlarge"
}

variable "root_volume_gb" {
  description = "Root volume size (OS only)."
  type        = number
  default     = 30
}

variable "data_volume_gb" {
  description = "Data volume mounted at /var/lib/docker: Jenkins home, SonarQube data, image build cache."
  type        = number
  default     = 150
}

variable "admin_cidrs" {
  description = "CIDRs allowed to open the Jenkins and SonarQube UIs (your office / home IP as x.x.x.x/32)."
  type        = list(string)

  validation {
    condition     = length(var.admin_cidrs) > 0 && length(var.admin_cidrs) <= 4 && !contains(var.admin_cidrs, "0.0.0.0/0")
    error_message = "Set 1-4 admin_cidrs (your own IP ranges); 0.0.0.0/0 is not allowed."
  }
}

variable "github_hook_cidrs" {
  description = "GitHub webhook source ranges (https://api.github.com/meta -> hooks). Only /github-webhook/ is reachable from them."
  type        = list(string)
  default     = ["192.30.252.0/22", "185.199.108.0/22", "140.82.112.0/20", "143.55.64.0/20"]
}

variable "snapshot_retention_days" {
  description = "Daily EBS snapshots of the data volume kept for this many days."
  type        = number
  default     = 14
}

variable "office_hours_schedule" {
  description = "Stop the instance at 21:00 IST and start it at 08:00 IST on weekdays to save cost."
  type        = bool
  default     = false
}
