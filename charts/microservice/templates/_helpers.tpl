{{/*
Service name. Contract: release name == service name.
*/}}
{{- define "microservice.name" -}}
{{- default .Release.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "microservice.fullname" -}}
{{- include "microservice.name" . -}}
{{- end -}}

{{- define "microservice.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "microservice.version" -}}
{{- .Values.image.tag | default .Chart.AppVersion | toString | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Selector labels shared by every pod of the service (workload + migration job) */}}
{{- define "microservice.selectorLabels" -}}
app.kubernetes.io/name: {{ include "microservice.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Selector for serving pods only (excludes migration job pods) */}}
{{- define "microservice.workloadSelectorLabels" -}}
{{ include "microservice.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end -}}

{{- define "microservice.labels" -}}
helm.sh/chart: {{ include "microservice.chart" . }}
{{ include "microservice.selectorLabels" . }}
app.kubernetes.io/version: {{ include "microservice.version" . | quote }}
app.kubernetes.io/part-of: {{ .Values.global.partOf }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
shopverse.io/env: {{ .Values.global.env }}
{{- end -}}

{{- define "microservice.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "microservice.name" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "microservice.irsaRoleArn" -}}
{{- if .Values.serviceAccount.irsa.roleArn -}}
{{- .Values.serviceAccount.irsa.roleArn -}}
{{- else -}}
{{- printf "arn:aws:iam::%s:role/shopverse-%s-%s" (toString .Values.global.awsAccountId) .Values.global.env (include "microservice.name" .) -}}
{{- end -}}
{{- end -}}

{{- define "microservice.image" -}}
{{- $repo := .Values.image.repository | default (printf "%s.dkr.ecr.%s.amazonaws.com/shopverse/%s" (toString .Values.global.awsAccountId) .Values.global.awsRegion (include "microservice.name" .)) -}}
{{- if .Values.image.digest -}}
{{- printf "%s:%s@%s" $repo (toString .Values.image.tag) .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repo (toString .Values.image.tag) -}}
{{- end -}}
{{- end -}}

{{- define "microservice.ingressHost" -}}
{{- .Values.ingress.host | default (printf "api.%s" .Values.global.domain) -}}
{{- end -}}

{{/* Contract environment merged with user env (user wins) */}}
{{- define "microservice.envMap" -}}
{{- $name := include "microservice.name" . -}}
{{- $defaults := dict
  "SERVICE_NAME" $name
  "PORT" (toString .Values.containerPort)
  "NODE_ENV" .Values.nodeEnv
  "LOG_LEVEL" .Values.logLevel
  "OTEL_EXPORTER_OTLP_ENDPOINT" "http://otel-collector.tracing:4318"
  "OTEL_SERVICE_NAME" $name
  "OTEL_RESOURCE_ATTRIBUTES" (printf "deployment.environment=%s,service.namespace=shopverse" .Values.global.env)
  "JWT_ISSUER" (printf "https://api.%s/api/v1/auth" .Values.global.domain)
  "JWKS_URL" "http://auth-service.shop:8080/api/v1/auth/.well-known/jwks.json"
  "AWS_REGION" .Values.global.awsRegion
  "APP_ENV" .Values.global.env
-}}
{{- $merged := merge (deepCopy .Values.env) $defaults -}}
{{- toYaml $merged -}}
{{- end -}}

{{/* scaleTargetRef / workload kind */}}
{{- define "microservice.workloadApiVersion" -}}
{{- if .Values.rollout.enabled -}}argoproj.io/v1alpha1{{- else -}}apps/v1{{- end -}}
{{- end -}}
{{- define "microservice.workloadKind" -}}
{{- if .Values.rollout.enabled -}}Rollout{{- else -}}Deployment{{- end -}}
{{- end -}}

{{/* Pod template shared by Deployment and Rollout */}}
{{- define "microservice.podTemplate" -}}
metadata:
  labels:
    {{- include "microservice.labels" . | nindent 4 }}
    app.kubernetes.io/component: api
    {{- with .Values.podLabels }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    checksum/config: {{ include "microservice.envMap" . | sha256sum }}
    checksum/secrets: {{ toYaml .Values.externalSecrets.items | sha256sum }}
    {{- with .Values.podAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  serviceAccountName: {{ include "microservice.serviceAccountName" . }}
  automountServiceAccountToken: {{ or .Values.serviceAccount.automountServiceAccountToken .Values.serviceAccount.irsa.enabled }}
  {{- with .Values.imagePullSecrets }}
  imagePullSecrets:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.priorityClassName }}
  priorityClassName: {{ . }}
  {{- end }}
  terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
  securityContext:
    {{- toYaml .Values.podSecurityContext | nindent 4 }}
  {{- if .Values.topologySpread.enabled }}
  topologySpreadConstraints:
    - maxSkew: {{ .Values.topologySpread.maxSkew }}
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: {{ .Values.topologySpread.zoneWhenUnsatisfiable }}
      labelSelector:
        matchLabels:
          {{- include "microservice.workloadSelectorLabels" . | nindent 10 }}
      matchLabelKeys:
        - {{ if .Values.rollout.enabled }}rollouts-pod-template-hash{{ else }}pod-template-hash{{ end }}
    - maxSkew: {{ .Values.topologySpread.maxSkew }}
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: {{ .Values.topologySpread.hostWhenUnsatisfiable }}
      labelSelector:
        matchLabels:
          {{- include "microservice.workloadSelectorLabels" . | nindent 10 }}
      matchLabelKeys:
        - {{ if .Values.rollout.enabled }}rollouts-pod-template-hash{{ else }}pod-template-hash{{ end }}
  {{- end }}
  containers:
    - name: {{ include "microservice.name" . }}
      image: {{ include "microservice.image" . | quote }}
      imagePullPolicy: {{ .Values.image.pullPolicy }}
      ports:
        - name: http
          containerPort: {{ .Values.containerPort }}
          protocol: TCP
      envFrom:
        - configMapRef:
            name: {{ include "microservice.name" . }}-env
        {{- if .Values.externalSecrets.enabled }}
        {{- range .Values.externalSecrets.items }}
        - secretRef:
            name: {{ include "microservice.name" $ }}-{{ .name }}
        {{- end }}
        {{- end }}
      env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: APP_VERSION
          value: {{ include "microservice.version" . | quote }}
        {{- with .Values.extraEnv }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      startupProbe:
        httpGet:
          path: {{ .Values.probes.startup.path }}
          port: http
        periodSeconds: {{ .Values.probes.startup.periodSeconds }}
        timeoutSeconds: {{ .Values.probes.startup.timeoutSeconds }}
        failureThreshold: {{ .Values.probes.startup.failureThreshold }}
      livenessProbe:
        httpGet:
          path: {{ .Values.probes.liveness.path }}
          port: http
        initialDelaySeconds: {{ .Values.probes.liveness.initialDelaySeconds }}
        periodSeconds: {{ .Values.probes.liveness.periodSeconds }}
        timeoutSeconds: {{ .Values.probes.liveness.timeoutSeconds }}
        failureThreshold: {{ .Values.probes.liveness.failureThreshold }}
      readinessProbe:
        httpGet:
          path: {{ .Values.probes.readiness.path }}
          port: http
        initialDelaySeconds: {{ .Values.probes.readiness.initialDelaySeconds }}
        periodSeconds: {{ .Values.probes.readiness.periodSeconds }}
        timeoutSeconds: {{ .Values.probes.readiness.timeoutSeconds }}
        failureThreshold: {{ .Values.probes.readiness.failureThreshold }}
      {{- if gt (int .Values.lifecycle.preStopSleepSeconds) 0 }}
      lifecycle:
        preStop:
          sleep:
            seconds: {{ .Values.lifecycle.preStopSleepSeconds }}
      {{- end }}
      resources:
        {{- toYaml .Values.resources | nindent 8 }}
      securityContext:
        {{- toYaml .Values.securityContext | nindent 8 }}
      volumeMounts:
        {{- if .Values.tmpVolume.enabled }}
        - name: tmp
          mountPath: /tmp
        {{- end }}
        {{- with .Values.extraVolumeMounts }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
  volumes:
    {{- if .Values.tmpVolume.enabled }}
    - name: tmp
      emptyDir:
        sizeLimit: {{ .Values.tmpVolume.sizeLimit }}
    {{- end }}
    {{- with .Values.extraVolumes }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  {{- with .Values.nodeSelector }}
  nodeSelector:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.affinity }}
  affinity:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.tolerations }}
  tolerations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end -}}
