# Nightly destroy and recreate (dev)

dev is disposable: it is destroyed every night and rebuilt every working morning. This keeps cost low
(contract: dev uses 1 NAT, spot only, in-cluster Postgres/Redis/Strimzi) and continuously proves that
the whole platform can be rebuilt from Git + Terraform (a free DR drill).

| When (IST) | What | How |
|---|---|---|
| 21:00 Mon-Fri | destroy | scheduled CI workflow `dev-nightly-destroy` (see `.github/` / `ci/`) |
| 08:00 Mon-Fri | recreate | scheduled CI workflow `dev-morning-create` |
| weekends | stays down | |

## What survives

| Kept | Destroyed |
|---|---|
| ECR repositories + images (shared), Route 53 zone, ACM certs, S3 `shopverse-dev-velero` - i.e. whatever lives in the shared/persistent Terraform stack. Secrets Manager `shopverse/dev/*` are re-created by Terraform on apply if they are in the destroyed stack (values are regenerated; ESO picks them up). | EKS cluster + nodes, NAT GW, ALB, in-cluster Postgres/Redis/Kafka data, Elasticsearch, Prometheus data |

Because dev data is recreated, services must tolerate empty databases (migrations run in the
`db-migrate` hook) and empty topics (Strimzi `KafkaTopic` CRs in `gitops/envs/dev/platform/kafka`).
Seed data, if needed, is loaded by each service's migration (dev-only seed files).

## Destroy sequence

The order matters: Kubernetes-created AWS resources (ALB, target groups, EBS volumes, Route 53
records, Karpenter EC2 instances) are not in Terraform state and would block VPC deletion.

```bash
# 1. stop GitOps from re-creating things
kubectl -n argocd patch application shopverse-dev-root --type merge -p '{"spec":{"syncPolicy":null}}'
# 2. delete workloads + the ALB Ingress (ALB controller removes the ALB/TGs; ExternalDNS removes records)
kubectl delete applicationset -n argocd shopverse-services --wait
kubectl -n ingress-nginx delete ingress shopverse-alb --wait
kubectl wait --for=delete ingress/shopverse-alb -n ingress-nginx --timeout=5m
# 3. release Karpenter capacity and PVs
kubectl delete nodepools --all --wait
kubectl delete pvc --all -A --wait=false
# 4. let controllers finish (ALB, EBS, Route 53) - poll until none tagged for the cluster remain
aws elbv2 describe-load-balancers --query "LoadBalancers[?contains(LoadBalancerName,'shopverse-dev')]"
# 5. terraform
terraform -chdir=terraform/envs/dev destroy -auto-approve
```

Safety rails in the workflow: refuses to run if the target account/cluster name is not `*-dev`, and
skips the destroy if an `keep-dev-up` label/issue is open (e.g. for a demo).

## Recreate sequence (~35-40 min)

```bash
terraform -chdir=terraform/envs/dev apply -auto-approve          # VPC, EKS, IRSA roles, ArgoCD helm_release
aws eks update-kubeconfig --name shopverse-dev --region ap-south-1
kubectl apply -n argocd -f gitops/bootstrap/dev-root.yaml        # app-of-apps
```

ArgoCD then walks the sync waves: base -> ArgoCD -> ALB controller/metrics-server -> ESO -> Karpenter
-> kube-prometheus-stack -> ingress/dns/keda/rollouts/eck/kyverno/velero/strimzi -> platform-config ->
postgres/redis -> logging/tracing -> services.

Check:

```bash
argocd app list                                        # all Synced/Healthy
kubectl -n shop get pods                               # 15 services x 2 replicas
kubectl -n kafka get kafkatopics                       # 18 topics (9 + 9 dlq)
curl -fsS https://api.dev.ganga888.in/api/v1/products  # through ALB + nginx
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `terraform destroy` stuck on subnet/SG `DependencyViolation` | leftover ENIs/ALB/EC2 from controllers: delete `elbv2` LBs + TGs tagged `elbv2.k8s.aws/cluster=shopverse-dev`, terminate instances tagged `karpenter.sh/discovery=shopverse-dev`, re-run |
| Route 53 records left behind | ExternalDNS uses TXT owner `shopverse-dev`; delete records with `extdns-*` TXT owner `shopverse-dev` only |
| Postgres init did not create service DBs | the initdb script runs only on an empty volume; delete the `data-postgresql-0` PVC and the pod |
| ESO errors right after create | IRSA trust takes ~1 min after the OIDC provider is created; ESO retries automatically |
| Kyverno blocks unsigned local test images | dev runs signature/registry policies in Audit; anything else is a real violation |
