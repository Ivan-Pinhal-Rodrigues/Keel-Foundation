#!/bin/bash
set -euo pipefail

# End-to-end smoke test for the `kind` CI job (spec `plans/specs/08-deploy-and-ci.md`
# §7 item 9): stand up a throwaway Postgres + mailpit in the kind cluster, install
# the Helm chart against them, seed the database, then drive the real HTTP API
# (login -> create a demand -> read it back) to prove the deployed image actually
# works end to end, not just that it boots.
#
# Two images are in play, matching Task 5's chart split (helm/keel/README.md,
# "migrateImage is deliberately separate from image"): `keel:ci` is the `runner`
# stage (what the Deployment runs — no prisma CLI, no tsx/dotenv-cli), and
# `keel-migrate:ci` is the `build` stage (full toolchain — what the chart's
# pre-install migrate Job runs, and what this script's seed step below needs).
# Both must already be `kind load docker-image`'d into the `keel-ci` cluster
# before this script runs (see the `kind` job in .github/workflows/ci.yml).

kubectl create namespace keel-smoke

# Cleanup runs on EVERY exit (success or failure), not just success. Without
# this, a mid-script failure (seed pod, api-smoke pod, a `kubectl wait`
# timeout — all plausible on this script's first real CI run) hits `set -e`
# and exits immediately, skipping whatever cleanup sat at the bottom of the
# file. On GitHub Actions that's harmless (the whole runner VM is torn down
# after the job), but on a local `kind` cluster it leaves a stuck
# `keel-smoke` namespace with a running Postgres/mailpit/app behind. `helm
# uninstall` has no `--ignore-not-found` flag (unlike `kubectl delete`), so
# it's wrapped in `|| true` instead; every step here is `|| true` so a
# cleanup failure can never mask the original failure. A trap handler's own
# exit status does not override the exit status `set -e` already captured
# from the failing command (unless the handler calls `exit` itself, which
# this one doesn't), so the script still reports the real failure to CI.
cleanup() {
  helm uninstall keel-smoke -n keel-smoke >/dev/null 2>&1 || true
  kubectl delete namespace keel-smoke --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

kubectl -n keel-smoke create secret generic keel-secrets \
  --from-literal=DATABASE_URL="postgresql://keel_app:keel_app@keel-smoke-db:5432/keel?schema=public" \
  --from-literal=MIGRATE_DATABASE_URL="postgresql://keel_migrate:keel_migrate@keel-smoke-db:5432/keel?schema=public" \
  --from-literal=SMTP_URL="smtp://keel-smoke-mailpit:1025"

kubectl -n keel-smoke run keel-smoke-db --image=postgres:16 \
  --env="POSTGRES_DB=keel" --env="POSTGRES_USER=postgres" --env="POSTGRES_PASSWORD=postgres" \
  --port=5432 --expose
kubectl -n keel-smoke run keel-smoke-mailpit --image=axllent/mailpit:latest --port=1025 --expose

kubectl -n keel-smoke wait --for=condition=ready pod -l run=keel-smoke-db --timeout=60s
DB_POD="$(kubectl -n keel-smoke get pod -l run=keel-smoke-db -o jsonpath='{.items[0].metadata.name}')"

# Pod `Ready` only means the container process started — postgres's own
# initdb + startup sequence still needs a few more seconds before it accepts
# TCP connections (confirmed live: an immediate `psql` right after `Ready`
# got "Connection refused" on a real CI run). `kubectl run` has no simple
# flag for a real readinessProbe, so poll `pg_isready` instead of a fixed
# sleep — proportionate to how long postgres actually takes to come up.
for _ in $(seq 1 30); do
  kubectl -n keel-smoke exec "$DB_POD" -- pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 2
done
kubectl -n keel-smoke exec "$DB_POD" -- pg_isready -h 127.0.0.1 -U postgres

kubectl -n keel-smoke cp docker/postgres-init.sql "$DB_POD":/tmp/init.sql
kubectl -n keel-smoke exec "$DB_POD" -- psql -h 127.0.0.1 -U postgres -d keel -f /tmp/init.sql

# image.tag and migrateImage.tag are two SEPARATE --set flags, deliberately —
# the Deployment must run the `runner` image (keel:ci), the pre-install migrate
# Job must run the `build`-stage image (keel-migrate:ci). A shared tag would
# either give the Deployment a toolchain it doesn't need or hand the migrate
# Job a `runner` image with no `prisma` CLI (helm/keel/templates/migrate-job.yaml
# runs `sh /app/docker/migrate-entrypoint.sh`, which shells out to
# `pnpm exec prisma migrate deploy`).
helm install keel-smoke helm/keel -n keel-smoke \
  --set image.repository=keel --set image.tag=ci \
  --set migrateImage.repository=keel-migrate --set migrateImage.tag=ci \
  --wait --timeout 3m

kubectl -n keel-smoke wait --for=condition=available deployment/keel-smoke-keel --timeout=120s

# Seed the smoke DB. `helm install --wait` above only returns once the
# pre-install migrate Job (docker/migrate-entrypoint.sh -> `prisma migrate
# deploy`) has succeeded — schema exists, but no rows. `pnpm seed` is
# `dotenv -e .env -- tsx prisma/seed.ts`; `tsx`/`dotenv-cli` live in
# devDependencies, present in the `build`-stage image (`deps` stage's
# `pnpm install --frozen-lockfile --offline` has no --prod flag) but absent
# from `runner`. dotenv-cli does not error when `.env` is missing (verified:
# it just skips loading and falls through to the already-set process env),
# so passing DATABASE_URL/MIGRATE_DATABASE_URL as pod env vars is enough —
# no .env file needed in the image. Both vars are set even though the seed
# script only ever connects via DATABASE_URL (`new PrismaClient()` at
# runtime never touches `directUrl`), matching the same "any container that
# touches Prisma tooling gets both" rule already applied to
# docker-compose.yml's `migrate` service.
kubectl -n keel-smoke run keel-smoke-seed --image=keel-migrate:ci --restart=Never --rm -i \
  --env="DATABASE_URL=postgresql://keel_app:keel_app@keel-smoke-db:5432/keel?schema=public" \
  --env="MIGRATE_DATABASE_URL=postgresql://keel_migrate:keel_migrate@keel-smoke-db:5432/keel?schema=public" \
  --command -- pnpm seed

kubectl -n keel-smoke run curl-probe --image=curlimages/curl:latest --rm -i --restart=Never -- \
  curl -sf "http://keel-smoke-keel:3000/api/readyz"

echo "kind smoke: readyz OK"

# Full API smoke (spec §7 item 9): login -> create a demand -> read it back,
# asserting each response status. Run as one shell script inside a single pod
# (not three separate `kubectl run`s) because the session cookie from login and
# the demand id from create must both carry into the next call — each
# `kubectl run` is a fresh container, so state can't cross pod boundaries.
# `--command` is required to override curlimages/curl's default entrypoint
# (`curl`) with `sh -c`.
#
# Request/response shapes read straight from the route handlers, not guessed:
#   - POST /api/auth/login body {email,password} (src/lib/api/schemas/auth.ts
#     loginBody) -> 200 {ok:true} + Set-Cookie session cookie on success
#     (src/app/api/auth/login/route.ts), 401 on bad credentials. No CSRF
#     header needed (src/lib/api/with-request.ts reads the cookie straight off
#     the Cookie header) — only src/middleware.ts's PUBLIC allowlist and the
#     session-cookie-present check gate the route, and /api/auth/login is on
#     that PUBLIC list.
#   - POST /api/demands body {title,problem,source,affectedService?}
#     (src/lib/api/schemas/demands.ts createDemandBody; source is REQUIRED,
#     one of CLIENT/INCIDENT/TECH_DEBT/COMPLIANCE/OPPORTUNITY/INTERNAL) -> 201
#     {id,ref,...} (src/app/api/demands/route.ts POST returns createDemand's
#     `{id,ref}` at minimum). The seeded admin@keel.local user is INTERNAL, so
#     createDemand (src/server/modules/demand/service.ts) honors the supplied
#     `source` verbatim rather than forcing CLIENT.
#   - GET /api/demands/:id -> 200, and for an INTERNAL actor the body is the
#     raw row unchanged (src/server/policy/serialize.ts serializePick: an
#     internal reader "gets the row as-is"), so it still carries `id`.
kubectl -n keel-smoke run api-smoke --image=curlimages/curl:latest --restart=Never --rm -i \
  --command -- sh -c '
set -eu
BASE="http://keel-smoke-keel:3000"
JAR=/tmp/cookies.txt

status=$(curl -sS -o /tmp/login.json -w "%{http_code}" -c "$JAR" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@keel.local\",\"password\":\"Keel-admin-2026\"}" \
  "$BASE/api/auth/login")
echo "login status=$status"; cat /tmp/login.json; echo
[ "$status" = "200" ]

status=$(curl -sS -o /tmp/create.json -w "%{http_code}" -b "$JAR" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"kind smoke demand\",\"problem\":\"kind smoke test - verifying the API end to end\",\"source\":\"INTERNAL\"}" \
  "$BASE/api/demands")
echo "create status=$status"; cat /tmp/create.json; echo
[ "$status" = "201" ]

id=$(sed -n "s/.*\"id\":\"\([^\"]*\)\".*/\1/p" /tmp/create.json)
[ -n "$id" ]
echo "created demand id=$id"

status=$(curl -sS -o /tmp/read.json -w "%{http_code}" -b "$JAR" "$BASE/api/demands/$id")
echo "read status=$status"; cat /tmp/read.json; echo
[ "$status" = "200" ]

case "$(cat /tmp/read.json)" in
  *"\"id\":\"$id\""*) ;;
  *) echo "read-back id mismatch"; exit 1 ;;
esac

echo "kind smoke: login -> create demand -> read back OK"
'

# No explicit cleanup here — the `trap cleanup EXIT` above handles it on
# every exit path, including this normal-completion one.
