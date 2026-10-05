# Jenkins + SonarQube (self-hosted CI)

Jenkins runs on an EC2 instance that `terraform/ci` creates, and Ansible configures it over SSM:

```
GitHub ──webhook──► ALB (https://jenkins.ganga888.in, https://sonarqube.ganga888.in)
                     │  ACM certificate · admin-IP allowlist · only /github-webhook/ open to GitHub
                     ▼
         EC2 t3.xlarge, Ubuntu 24.04, CI VPC 10.50.0.0/16, no SSH (SSM Session Manager)
           docker compose: jenkins (:8085) · sonarqube (:9000) · sonar-db
           /var/lib/docker on an encrypted EBS data volume, snapshotted daily (DLM, 14 days)
           instance role: ECR push on shopverse/* + kms:Sign on alias/shopverse-cosign
```

No AWS access keys exist. The pipeline's `aws`, `docker login` and `cosign` calls use the instance role. `AWS_AUTH_MODE=instance-profile` sets this.

## Set up on EC2

1. **Create the host.** Set `admin_cidrs` in `terraform/ci/terraform.tfvars` to your IP, for example `["203.0.113.25/32"]`, then apply:
   ```bash
   cd terraform/ci && terraform init -backend-config=../backend.hcl && terraform apply
   ```
   You can also merge a PR; the `apply-ci` job runs right after `global`.
2. **Store the tokens** in Secrets Manager. The admin and Sonar DB passwords are already generated.
   ```bash
   aws secretsmanager get-secret-value --secret-id shopverse/ci/jenkins --query SecretString --output text > /tmp/j.json
   # edit /tmp/j.json: set GITHUB_TOKEN (fine-grained, Contents read/write on the repo); leave SONAR_TOKEN for step 5
   aws secretsmanager put-secret-value --secret-id shopverse/ci/jenkins --secret-string file:///tmp/j.json && rm /tmp/j.json
   ```
3. **Configure the host** with Ansible. Fill `ansible/inventories/ci/hosts.yml` from `terraform output` (`instance_id`, `ssm_bucket`) and `group_vars/all.yml` (account ID, GitHub owner and repo). Then run:
   ```bash
   cd ansible
   ansible-galaxy collection install -r requirements.yml
   ansible-playbook -i inventories/ci/hosts.yml playbooks/jenkins.yml
   ```
   This needs the AWS `session-manager-plugin` and `boto3` on your machine. The playbook hardens the OS and installs Docker, node_exporter and the CloudWatch agent. It copies this folder to `/opt/jenkins`, writes `.env` (non-secret), and has the host write `.env.secrets` from Secrets Manager. Finally it starts the stack.
4. **Log in to Jenkins** at `https://jenkins.ganga888.in` as `admin`. Get the password with `terraform -chdir=terraform/ci output -raw jenkins_admin_password_command | bash`.
5. **Set up SonarQube** at `https://sonarqube.ganga888.in`.
   1. Log in as `admin/admin` and change the password.
   2. Create an analysis token and put it in the secret as `SONAR_TOKEN`.
   3. Add the webhook `http://jenkins:8080/sonarqube-webhook/` and the quality gate from `ci/sonar/`.
   4. Re-run step 3 with `--tags jenkins` so Jenkins loads the token.
6. **Add the GitHub webhook.** In repo settings, add a webhook with payload URL `https://jenkins.ganga888.in/github-webhook/`, content type `application/json`, for push and pull request events. Jenkins also scans every 5 minutes as a fallback.

JCasC creates:
- the credentials `aws-account-id`, `sonarqube-token` and `github-token`, plus an empty `aws-jenkins-ci`
- the `sonarqube` server entry
- the `shopverse` multibranch job that runs `ci/Jenkinsfile`

## Operating it

- **Shell access:** `aws ssm start-session --target <instance_id>`. There is no SSH port.
- **Rotate a token:** update the secret, then run `sudo /usr/local/sbin/jenkins-secrets-env && cd /opt/jenkins && sudo docker compose --env-file .env --env-file .env.secrets up -d`, or re-run the playbook.
- **Backups:** daily EBS snapshots of the data volume. To restore, create a volume from a snapshot, swap it in for the data volume, and reboot.
- **Cost:** about $150/month in ap-south-1 for t3.xlarge, 150 GB gp3 and the ALB. Set `office_hours_schedule = true` to stop the host from 21:00 to 08:00 IST and over weekends.
- **Logs:** container logs go to CloudWatch through the agent. Host metrics come from node_exporter on :9100.

## Running on a laptop instead (optional)

```bash
cp .env.example .env     # set AWS_AUTH_MODE=static-keys and fill AWS_CI_ACCESS_KEY_ID / AWS_CI_SECRET_ACCESS_KEY
sudo sysctl -w vm.max_map_count=524288
docker compose up -d --build     # Jenkins http://localhost:8085, SonarQube http://localhost:9000
```

Static keys need the `jenkins-ci` IAM user: set `create_jenkins_ci_user = true` in `terraform/global` and rotate its key with `ansible/playbooks/runbooks/rotate-jenkins-keys.yml`.

The Jenkins image (`Dockerfile`) bundles the docker CLI and buildx, AWS CLI v2, Trivy, cosign, Syft, yq, Node 22 and sonar-scanner. Builds run on the host Docker daemon through the mounted socket.
