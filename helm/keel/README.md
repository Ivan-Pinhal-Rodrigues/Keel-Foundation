# keel

Helm chart for the Keel ITSM platform.

## Install

```bash
# staging
helm install keel helm/keel -f helm/keel/values-staging.yaml

# prod
helm install keel helm/keel -f helm/keel/values-prod.yaml
```

`values-staging.yaml` and `values-prod.yaml` only override a subset of keys —
Helm merges them over the chart's `values.yaml` defaults, so every key below
is always defined even when an environment file doesn't mention it.

## Required secret: `keel-secrets`

The chart does not create the app's secret — it references an
`existingSecret` (see `existingSecret` value below) that must exist in the
target namespace before install. It is consumed via `envFrom.secretRef` by
both the `Deployment` and the pre-install/pre-upgrade migrate `Job`, so its
keys become environment variables in the container.

Required keys:

| Key                    | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`         | App's runtime Postgres connection string                          |
| `MIGRATE_DATABASE_URL` | Migration-role Postgres connection string used by the migrate Job |
| `SMTP_URL`             | Outbound mail connection string                                   |

Example:

```bash
kubectl create secret generic keel-secrets \
  --from-literal=DATABASE_URL="postgresql://keel_app:<password>@<host>:5432/keel?schema=public" \
  --from-literal=MIGRATE_DATABASE_URL="postgresql://keel_migrate:<password>@<host>:5432/keel?schema=public" \
  --from-literal=SMTP_URL="smtp://<host>:587"
```

## Values

### Top-level

| Key              | Default (`values.yaml`) | staging override | prod override | Description                                                                                   |
| ---------------- | ----------------------- | ---------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `replicaCount`   | `1`                     | `1` (unchanged)  | `2`           | Number of app pod replicas                                                                    |
| `existingSecret` | `keel-secrets`          | —                | —             | Name of the pre-existing Secret containing `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SMTP_URL` |

### `image`

| Key                | Default        | staging | prod | Description                                                                       |
| ------------------ | -------------- | ------- | ---- | --------------------------------------------------------------------------------- |
| `image.repository` | `keel`         | —       | —    | Container image repository for the `runner` image built by the project Dockerfile |
| `image.tag`        | `local`        | —       | —    | Container image tag                                                               |
| `image.pullPolicy` | `IfNotPresent` | —       | —    | Pod image pull policy                                                             |

### `migrateImage`

| Key                       | Default | staging | prod | Description                                    |
| ------------------------- | ------- | ------- | ---- | ---------------------------------------------- |
| `migrateImage.repository` | `keel`  | —       | —    | Container image repository for the migrate Job |
| `migrateImage.tag`        | `local` | —       | —    | Container image tag for the migrate Job        |

`migrateImage` is deliberately separate from `image`. The migrate `Job` runs
`docker/migrate-entrypoint.sh` and needs the `prisma` CLI, so it must point
at an image built from the Dockerfile's `build` stage (the full toolchain),
**never** the `runner` stage that `image` points at — `runner` deliberately
has neither the `prisma` CLI nor `docker/migrate-entrypoint.sh` copied in.
`values.yaml` defaults `migrateImage` to the same `repository`/`tag` as
`image` purely so the chart installs out-of-the-box; a real deploy must
override it independently, e.g.:

```bash
helm upgrade --install keel helm/keel -f helm/keel/values-prod.yaml \
  --set image.tag=<runner-tag> \
  --set migrateImage.tag=<build-stage-tag>
```

Neither `values-staging.yaml` nor `values-prod.yaml` override the `image`
section — CI/deploy tooling is expected to pass both tags via `--set` at
install time, as above.

### `config` (rendered into the `-config` ConfigMap and injected via `envFrom`)

| Key                   | Default                 | staging | prod               | Description                                                               |
| --------------------- | ----------------------- | ------- | ------------------ | ------------------------------------------------------------------------- |
| `config.appUrl`       | `http://localhost:3000` | —       | —                  | Public base URL the app uses to build links (e.g. in notification emails) |
| `config.notifyPollMs` | `5000`                  | —       | —                  | Notification worker poll interval in milliseconds                         |
| `config.notifyBatch`  | `20`                    | —       | —                  | Notification worker batch size                                            |
| `config.logLevel`     | `info`                  | `debug` | `info` (unchanged) | Application log level                                                     |

### `service`

| Key            | Default | staging | prod | Description                                       |
| -------------- | ------- | ------- | ---- | ------------------------------------------------- |
| `service.port` | `3000`  | —       | —    | ClusterIP Service port (and Ingress backend port) |

### `ingress`

| Key                   | Default | staging                    | prod               | Description                                      |
| --------------------- | ------- | -------------------------- | ------------------ | ------------------------------------------------ |
| `ingress.enabled`     | `false` | `true`                     | `true`             | Whether to create an Ingress resource            |
| `ingress.className`   | `""`    | `nginx`                    | `nginx`            | `ingressClassName` on the Ingress                |
| `ingress.host`        | `""`    | `staging.keel.example.com` | `keel.example.com` | Hostname routed to the app                       |
| `ingress.annotations` | `{}`    | —                          | —                  | Extra annotations to add to the Ingress metadata |

**Ingress requirement:** the ingress controller MUST replace, not append to,
`X-Forwarded-For` with the real client address before the request reaches
the app — until a trusted proxy is in place, the login rate limiter keys on
the submitted email only (spec 08 §4).

### `resources`

| Key                         | Default | staging             | prod    | Description              |
| --------------------------- | ------- | ------------------- | ------- | ------------------------ |
| `resources.requests.cpu`    | `100m`  | `100m` (unchanged)  | `250m`  | Container CPU request    |
| `resources.requests.memory` | `256Mi` | `256Mi` (unchanged) | `512Mi` | Container memory request |
| `resources.limits.cpu`      | `500m`  | `500m` (unchanged)  | `1000m` | Container CPU limit      |
| `resources.limits.memory`   | `512Mi` | `512Mi` (unchanged) | `1Gi`   | Container memory limit   |

### `autoscaling`

| Key                                          | Default | staging | prod                | Description                        |
| -------------------------------------------- | ------- | ------- | ------------------- | ---------------------------------- |
| `autoscaling.enabled`                        | `false` | —       | `false` (unchanged) | Whether to create an HPA           |
| `autoscaling.minReplicas`                    | `1`     | —       | —                   | HPA minimum replicas               |
| `autoscaling.maxReplicas`                    | `3`     | —       | —                   | HPA maximum replicas               |
| `autoscaling.targetCPUUtilizationPercentage` | `75`    | —       | —                   | HPA target average CPU utilization |

### `serviceAccount`

| Key                     | Default | staging | prod | Description                                                                                  |
| ----------------------- | ------- | ------- | ---- | -------------------------------------------------------------------------------------------- |
| `serviceAccount.create` | `true`  | —       | —    | Whether to create a ServiceAccount                                                           |
| `serviceAccount.name`   | `""`    | —       | —    | ServiceAccount name override; defaults to the chart's fullname (`<release>-keel`) when empty |

## What gets installed

- `Deployment` — runs the `runner` image, probes `/api/healthz` (liveness) and
  `/api/readyz` (readiness), loads env from `existingSecret` and the chart's
  ConfigMap.
- `Service` (ClusterIP) — exposes `service.port` to `targetPort: 3000`.
- `Ingress` — only when `ingress.enabled`.
- `ConfigMap` — non-secret app config (`APP_URL`, `NOTIFY_POLL_MS`,
  `NOTIFY_BATCH`, `LOG_LEVEL`).
- `ServiceAccount` — only when `serviceAccount.create`.
- `Job` (`helm.sh/hook: pre-install,pre-upgrade`) — runs the `migrateImage`
  image's `docker/migrate-entrypoint.sh` against `MIGRATE_DATABASE_URL`
  before each install/upgrade completes, and is deleted/recreated per the
  `before-hook-creation,hook-succeeded` delete policy.
- `HorizontalPodAutoscaler` — only when `autoscaling.enabled`.
