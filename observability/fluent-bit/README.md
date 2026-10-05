# Fluent Bit

Runs as a DaemonSet in `logging` (Application `fluent-bit`, wave -1).

Pipeline: `tail /var/log/containers/*.log` (multiline `cri`/`docker`) -> `kubernetes` filter
(pod/namespace/labels metadata, `Merge_Log On` decodes the JSON payload into `app.*`) -> `lua`
(`lift_app_fields` copies `trace_id`, `span_id`, `correlationId`, `msg`, `level` to top level and
maps pino numeric levels to names) -> `modify` (adds `env`, `cluster`) -> Elasticsearch
`shopverse-es-http.logging.svc:9200` (TLS with the ECK CA, user `fluentbit`, role
`shopverse_log_writer`), daily indices `logs-k8s-YYYY.MM.DD` governed by ILM policy `shopverse-logs`.

Per-pod overrides (annotations):

| Annotation | Effect |
|---|---|
| `fluentbit.io/parser: pino_json` | force a parser from `parsers.conf` |
| `fluentbit.io/exclude: "true"` | drop the pod's logs (e.g. noisy batch jobs) |
