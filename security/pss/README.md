# Pod Security Standards

Enforced with the built-in Pod Security Admission via namespace labels
(`gitops/envs/<env>/platform/base/namespaces.yaml`). Every namespace also has
`audit=restricted` and `warn=restricted`, so anything short of restricted is visible in the API
server audit log and as `kubectl` warnings even where it is allowed.

| Namespace | enforce | Why not stricter |
|---|---|---|
| `shop` | **restricted** | - (contract) |
| `argocd`, `ingress-nginx`, `external-secrets`, `tracing`, `keda`, `velero`, `kubecost`, `argo-rollouts`, `kyverno`, `kafka` (dev), `data` (dev) | baseline | upstream charts do not set every restricted field (seccompProfile, drop ALL); ingress-nginx adds `NET_BIND_SERVICE` |
| `monitoring` | privileged | node-exporter uses hostNetwork, hostPID and hostPath |
| `logging` | privileged | fluent-bit DaemonSet reads `/var/log/containers` via hostPath |
| `kube-system` | (unlabelled, EKS default) | aws-node, kube-proxy, EBS CSI node plugin need privileged |

## How ShopVerse pods satisfy `restricted`

`charts/microservice` sets, and `values.schema.json` refuses to relax:

```yaml
securityContext:            # pod
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  seccompProfile: { type: RuntimeDefault }
securityContext:            # container
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true      # /tmp is an emptyDir
  runAsNonRoot: true
  capabilities: { drop: [ALL] }
```

No hostPath/hostNetwork/hostPort, no privileged, service account token not mounted
(`automountServiceAccountToken: false`; IRSA uses its own projected token).

Kyverno adds defence in depth for `shop` (`security/kyverno/require-non-root.yaml`) and the
supply-chain rules (signatures, registries, no `:latest`) cluster-wide.

## Exceptions process

1. Prefer fixing the workload (set the missing securityContext fields via chart values).
2. If impossible, open a PR that lowers the namespace label **for that namespace only**, with the
   reason added to the table above, or add a Kyverno `PolicyException` in namespace `kyverno`
   scoped to the specific workload. Never relabel `shop`.
3. Check impact before tightening a namespace:
   `kubectl label --dry-run=server --overwrite ns <ns> pod-security.kubernetes.io/enforce=restricted`
