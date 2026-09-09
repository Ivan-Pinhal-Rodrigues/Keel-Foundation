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
