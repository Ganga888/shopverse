# SonarQube quality gate: `shopverse-gate`

Each service is its own Sonar project (`shopverse-<service>`, see `services/<service>/sonar-project.properties`)
and the shared library is `shopverse-libs-common`. All of them use the gate below, applied to **new code**
(new-code period: "previous version", that is, since the last `sonar.projectVersion`, which CI sets to the git SHA).

| Metric (new code) | Operator | Threshold | Why |
|---|---|---|---|
| Coverage | < | 70 % | domain logic (saga, reservation, idempotency, coupon rules) is unit-tested; `src/index.ts` wiring is excluded |
| Duplicated lines | > | 3 % | shared concerns belong in `libs/common` |
| Reliability rating | worse than | A | no new bugs |
| Security rating | worse than | A | no new vulnerabilities |
| Security hotspots reviewed | < | 100 % | every hotspot is triaged |
| Maintainability rating | worse than | A | technical-debt ratio ≤ 5 % |

`waitForQualityGate abortPipeline: true` in `ci/Jenkinsfile` fails the service's branch when the gate fails, before
any image is pushed. SonarQube must call back to Jenkins: **Administration → Configuration → Webhooks →**
`http://jenkins:8080/sonarqube-webhook/`.

Apply the gate with `./setup-quality-gate.sh` (idempotent, uses the Web API):

```bash
SONAR_HOST_URL=http://localhost:9000 SONAR_ADMIN_TOKEN=<admin token> ./setup-quality-gate.sh
```

Notes
- Coverage comes from `vitest run --coverage` (`coverage/lcov.info`, v8 provider) via `sonar.javascript.lcov.reportPaths`.
- Test files (`test/**`) are declared as tests, so they are not counted as source.
- Overall-code conditions are not used: legacy debt does not block delivery, new debt does.
- Dependency vulnerabilities are gated separately (`npm audit --audit-level=high`, and Trivy on the image).
