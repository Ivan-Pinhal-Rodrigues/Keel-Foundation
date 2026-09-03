# Migration conventions

Prisma Migrate, one migration per logical change. `prisma/migrations/` is the
source of truth; `schema.prisma` is kept in sync but raw-SQL invariants (CHECK
constraints, GRANT/REVOKE) live only in the migration files.

## Naming

```
<14-digit UTC timestamp>_<snake_case description>/migration.sql
```

- The timestamp is `date -u +%Y%m%d%H%M%S` (UTC, seconds precision). Prisma
  generates it; never hand-edit it.
- The description is lowercase `a-z0-9_` only.
- Folders sort lexically into apply order — `scripts/check-migrations.mjs`
  asserts both the name shape and that the on-disk order is ascending.

## Every migration carries a `-- Down:` comment

The first comment block states how to reverse the migration by hand:

```sql
-- Down: ALTER TABLE "User" DROP CONSTRAINT "user_guest_has_client";
```

Prisma has no down-migration runner. This is the reviewer's reversibility check
and the operator's rollback recipe. A genuinely irreversible step (a destructive
column drop) says so explicitly and names the preservation step that must have
preceded it (rename + backfill + later drop — never a bare drop).

The gate runs `check:migrations`; a full `up → down → up` harness is plan-08.

## Record-of-fact tables are append-only at the DB privilege level

`keel_app` (the runtime role) has `SELECT, INSERT, UPDATE, DELETE` on every table
by default — `20260901200800_audit_grants` sets that as the default privilege for
all future tables. A **record-of-fact** table (a permanent, immutable record of
something that happened) must give that back:

```sql
-- Down: GRANT UPDATE, DELETE ON "<table>" TO keel_app;
DO $$
DECLARE s text := current_schema();
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."<table>" FROM keel_app', s);
END $$;
```

The `current_schema()` / `format('%I', s)` wrapper is required: production runs
with `?schema=public`, the integration-test harness runs with `?schema=test_<hex>`,
and the migration must apply the REVOKE in whichever schema it is run against.
Hardcoding `"public"` would leave every test schema unrevoked.

Ship the REVOKE **in the same migration that creates the table.**
`scripts/check-migrations.mjs` connects as `keel_app` and fails the gate if any
table in its `RECORD_OF_FACT` list is still `UPDATE`/`DELETE`-able — add the new
table to that list in the same change.

Current record-of-fact tables:

| Table                      | Locked by                                 |
| -------------------------- | ----------------------------------------- |
| `AuditEvent`               | `20260901200800_audit_grants`             |
| `ApprovalDecision`         | `20260903125809_audit_default_privileges` |
| `PostImplementationReview` | `20260903125809_audit_default_privileges` |

## Raw-SQL migrations

The two-role setup (`keel_app` / `keel_migrate`), the audit-log grant, and every
CHECK constraint are raw SQL checked into `prisma/migrations/`. When a migration
is created with `--create-only` and hand-edited, re-run `prisma migrate dev` so
the recorded checksum matches the final file, then confirm `prisma migrate
status` reports the database up to date.

## Procedure

```
pnpm exec dotenv -e .env -- prisma migrate status          # confirm "up to date"
pnpm exec dotenv -e .env -- prisma migrate dev --create-only --name <desc>
# edit prisma/migrations/<ts>_<desc>/migration.sql — add the -- Down: comment
pnpm exec dotenv -e .env -- prisma migrate dev --name <desc>   # apply + record checksum
node scripts/check-migrations.mjs                          # gate check
```
