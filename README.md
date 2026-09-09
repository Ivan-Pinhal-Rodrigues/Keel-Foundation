# Keel

## Local development

Two ways to run the stack locally:

**Full stack (containerized app)**

```bash
docker compose up
```

Brings up `db`, `mailpit`, `migrate` (runs `prisma migrate deploy` once and exits), and `app` — `app` waits for `migrate` to complete successfully before starting.

**Faster iteration (app on host)**

```bash
docker compose up db mailpit
pnpm dev
```

Runs only Postgres and Mailpit in containers; `pnpm dev` runs the app directly on the host against the same `db`/`mailpit`, using `.env` (copy `.env.example`).

**Either way**, run this once after the first `up`:

```bash
pnpm seed
```

## Seed data

`pnpm seed` (`prisma/seed.ts`) is idempotent — every fixture is `upsert`ed on
a unique key (or, for the demo notifications, guarded by a row-count check),
so running it again is always a safe no-op. It seeds:

| Email                     | Password          | Kind     | Hats                                                       | Client            |
| ------------------------- | ----------------- | -------- | ---------------------------------------------------------- | ----------------- |
| `admin@keel.local`        | `Keel-admin-2026` | INTERNAL | DEVELOPER, REVIEWER, BUSINESS_APPROVER, TECHNICAL_APPROVER | —                 |
| `ceo@keel.local`          | `Keel-admin-2026` | INTERNAL | DEVELOPER, REVIEWER, BUSINESS_APPROVER                     | —                 |
| `cto@keel.local`          | `Keel-admin-2026` | INTERNAL | DEVELOPER, REVIEWER, TECHNICAL_APPROVER                    | —                 |
| `guest@northwind.example` | `Keel-guest-2026` | GUEST    | —                                                          | Northwind Traders |
| `guest@acme.example`      | `Keel-guest-2026` | GUEST    | —                                                          | Acme Retail       |

It also writes a spread of demo demands, incidents, changes, approvals,
notifications and email-outbox rows covering every lifecycle status, so
`/portal`, the internal register, and the dashboard all have something real to
render on a fresh database. Skipped when `NODE_ENV=production`.

## Deploy

Build the image and deploy it with Helm:

```bash
docker build -t keel:<tag> --target runner .
docker build -t keel-migrate:<tag> --target build .

helm install keel helm/keel \
  -f helm/keel/values-staging.yaml \
  --set image.tag=<tag> \
  --set migrateImage.tag=<tag>
```

`image.tag` and `migrateImage.tag` are two separate values because they point
at two different Dockerfile stages: `image` is the `runner` stage (no dev
deps, no source tree, no `prisma` CLI) that the app `Deployment` runs;
`migrateImage` is the `build` stage (full toolchain) that the pre-install/
pre-upgrade migrate `Job` runs `prisma migrate deploy` from. See
[`helm/keel/README.md`](helm/keel/README.md) for the full value reference,
the required `keel-secrets` keys, and what the chart installs.

## CI

Every push and pull request runs nine gates in `.github/workflows/ci.yml`:
`install` (pnpm install), `lint` (eslint + prettier), `typecheck` (`tsc
--noEmit`), `test` (vitest + migration-history check), `migrations`
(up-down-up over the full migration history), `build` (`next build` +
`docker build --target runner`), `e2e` (Playwright against a seeded stack),
`helm` (chart lint across all three values files + a grep for secret
literals), and `kind` (a real `kind` cluster install + login/create/read
smoke test). `build`, `e2e`, `helm` and `kind` depend on the earlier gates
passing (`needs:`), so nothing merges to `master` while any gate is red.

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE). No license,
right, or interest in this software is granted by its visibility in this
repository.
