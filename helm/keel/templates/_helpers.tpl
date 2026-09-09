{{- define "keel.name" -}}
keel
{{- end -}}

{{- define "keel.fullname" -}}
{{ .Release.Name }}-keel
{{- end -}}

{{- define "keel.labels" -}}
app.kubernetes.io/name: {{ include "keel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "keel.selectorLabels" -}}
app.kubernetes.io/name: {{ include "keel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
