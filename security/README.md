# ShopVerse security

## Supply chain: from commit to admission

```
 PR / push to main
   |
   | 1. SonarQube (SAST, code smells, coverage gate)          quality gate must pass
   | 2. Dependency scan (npm audit --omit=dev + trivy fs)     HIGH/CRITICAL with a fix -> fail
   | 3. docker build (multi-stage, distroless/node:22, uid 10001)
   | 4. Trivy image scan (security/trivy/trivy.yaml)          HIGH/CRITICAL with a fix -> fail
   | 5. SBOM: syft/trivy -> CycloneDX JSON (build artifact)
   | 6. Push to ECR 111122223333.dkr.ecr.ap-south-1.amazonaws.com/shopverse/<svc>:<git-sha>
   |    (tag immutability on, scan-on-push on)
   | 7. cosign sign --key awskms:///alias/shopverse-cosign <image>@<digest>
   |    cosign attest --type cyclonedx --predicate sbom.json --key awskms:///alias/shopverse-cosign <image>@<digest>
   |    (GitHub OIDC -> IAM role with kms:Sign only; private key never leaves KMS)
   v
 promote workflow PR: bumps image.tag in gitops/envs/<env>/services/<svc>/values.yaml
   |
   v
 ArgoCD sync -> API server admission
   |  Kyverno verify-shopverse-image-signatures   cosign signature by the KMS key, digest pinned (Enforce)
   |  Kyverno verify-shopverse-sbom-attestation   CycloneDX attestation present (Audit -> Enforce later)
   |  Kyverno restrict-image-registries           shop: ECR shopverse/* only; others: allow-list
   |  Kyverno disallow-latest-tag                 explicit, immutable tags
   |  Kyverno require-requests-limits / require-run-as-non-root / require-probes   (shop)
   |  Pod Security Admission                      shop = restricted
   v
 Pod runs: non-root uid 10001, read-only root fs, no capabilities, IRSA least privilege,
 secrets only from AWS Secrets Manager via External Secrets, default-deny NetworkPolicies.
```

Scanning of infrastructure code runs in the same pipelines: `checkov` (`checkov/.checkov.yaml`),
`trivy config` / `tfsec` (`tfsec/`, including custom checks for mandatory tags and naming).

## Layout

| Path | Purpose |
|---|---|
| `kyverno/` | ClusterPolicies (deployed to every env through `gitops/envs/<env>/platform/kustomization.yaml`; dev runs signature + registry rules in Audit) |
| `network-policies/` | Reference NetworkPolicy model for `shop` (applied via platform-base + the chart) |
| `pss/` | Pod Security Standards levels per namespace and the exceptions process |
| `checkov/.checkov.yaml` | Checkov config with justified skips |
| `tfsec/` | tfsec config + custom checks (`CUS001` default_tags, `CUS002` naming) |
| `trivy/` | `trivy.yaml` (shared CI config) and `.trivyignore` (every entry has an expiry) |

## Key facts

- Signing key: AWS KMS asymmetric key `alias/shopverse-cosign` (ECC_NIST_P256) in ap-south-1. CI role:
  `kms:Sign`, `kms:GetPublicKey`. Kyverno role `shopverse-<env>-kyverno`: `kms:GetPublicKey`,
  `kms:Verify` + ECR read. One key signs all images, so a digest verified in dev is the same
  artifact promoted to staging and prod.
- Images are referenced by git SHA tag in git and pinned to the verified digest by Kyverno at admission.
- Secrets: never in git. AWS Secrets Manager -> External Secrets (`ClusterSecretStore aws-secrets-manager`,
  IRSA `shopverse-<env>-external-secrets` scoped to `secret:shopverse/<env>/*`). Platform-internal
  passwords (Grafana admin, Elasticsearch users, Jaeger basic auth, dev Postgres superuser) are random,
  generated in-cluster by the ESO Password generator.
- Edge: CloudFront + WAF (web), ALB + regional WAF (api/tools), TLS 1.2+/1.3 policy, HTTP -> HTTPS redirect.

## Verify an image manually

```bash
IMG=111122223333.dkr.ecr.ap-south-1.amazonaws.com/shopverse/order-service:<sha>
cosign verify --key awskms:///arn:aws:kms:ap-south-1:111122223333:alias/shopverse-cosign --insecure-ignore-tlog "$IMG"
cosign verify-attestation --type cyclonedx --key awskms:///arn:aws:kms:ap-south-1:111122223333:alias/shopverse-cosign --insecure-ignore-tlog "$IMG" | jq -r .payload | base64 -d | jq '.predicate.components | length'
```

## Policy reports

```bash
kubectl get policyreports -A                         # background scan results
kubectl get clusterpolicyreport                      # cluster-scoped
kubectl -n shop describe policyreport | grep -B2 fail
```
