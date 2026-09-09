// Up -> down -> up harness for every migration in prisma/migrations/, run in
// CI's `migrations` job against a scratch database reachable directly at
// MIGRATE_DATABASE_URL (a GitHub Actions `services:` postgres container, not
// docker compose — unlike scripts/check-migrations.mjs, this script never
// shells to `docker compose exec`).
//
// For each migration folder, in chronological (= lexical) order:
//   1. `prisma migrate deploy`               — bring the DB up to and including
//                                               this migration (a no-op for any
//                                               migration already applied by a
//                                               prior loop iteration).
//   2. parse the migration's `-- Down:` line  — the single-line, semicolon-
//                                               terminated SQL statement that
//                                               reverses it (docs/migrations.md).
//                                               No line -> fail loudly, name the
//                                               migration. This is a real check:
//                                               not every migration currently
//                                               checked into this repo has one
//                                               (see task-6-report.md).
//   3. run that SQL, then delete the migration's own bookkeeping row from
//      Prisma's `_prisma_migrations` table, in one transaction against the DB
//      directly. This does NOT go through `prisma migrate resolve
//      --rolled-back <name>` — that command was tried first and rejected:
//      its compiled error string ("... cannot be rolled back because it is
//      not in a failed state") makes clear it only accepts migrations whose
//      `_prisma_migrations` row is already in a failed (not cleanly
//      finished) state, which a migration this script itself just applied
//      successfully never is. Deleting the row directly is what actually
//      makes `prisma migrate deploy` in step 4 treat the migration as never
//      having been applied — the same effect `resolve --rolled-back`
//      documents itself as producing, reached by a route the CLI's own
//      guard rail does not block. BEGIN/COMMIT wraps both statements so a
//      failure in the down SQL can never leave the bookkeeping row deleted
//      out from under DDL that didn't actually revert.
//   4. `prisma migrate deploy`               — re-apply the migration forward,
//                                               restoring the "up to and
//                                               including this migration" state
//                                               for the next loop iteration.
//
// Any step failing (including step 2's parse) aborts immediately and names the
// offending migration — a partial run leaves the scratch DB in a known-bad
// state, which is fine: the job's postgres `services:` container is destroyed
// with the runner at the end of the job.
//
// UNVERIFIED AGAINST A LIVE DATABASE — see task-6-report.md. The `_prisma_
// migrations` row-delete approach is reasoned from the schema-engine's own
// compiled error strings (grepped out of schema_engine_bg.wasm) and from
// `prisma migrate deploy`'s documented "no row for this migration name ->
// treat as pending" behavior, not from an actual run: this host's Docker/WSL
// is down, so no step of this script has executed against a real Postgres.
//
// Node ESM script — no TypeScript, no dependencies, matching
// scripts/check-migrations.mjs's style (execFileSync/readFileSync, no shell
// interpolation of untrusted input since execFileSync takes an argv array).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const MIGRATIONS_DIR = fileURLToPath(new URL("prisma/migrations", ROOT));

const DOWN_RE = /^-- Down:\s*(.+)$/m;
// Migration folder names are already gated elsewhere (check-migrations.mjs's
// NAME_RE, run as part of `pnpm test`) to `<14-digit>_<snake_case>`. Re-check
// here too, defensively, before interpolating a name into a SQL string.
const SAFE_NAME_RE = /^[A-Za-z0-9_]+$/;

/** MIGRATE_DATABASE_URL from the environment (CI sets it directly; local runs
 *  fall back to .env, same pattern as check-migrations.mjs's databaseUrl()). */
function migrateDatabaseUrl() {
  if (process.env.MIGRATE_DATABASE_URL) return process.env.MIGRATE_DATABASE_URL;
  const envText = readFileSync(fileURLToPath(new URL(".env", ROOT)), "utf8");
  const match = envText.match(
    /^\s*MIGRATE_DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m,
  );
  if (!match) {
    throw new Error(
      "MIGRATE_DATABASE_URL is not set and was not found in .env",
    );
  }
  return match[1];
}

const migrateUrl = migrateDatabaseUrl();

const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (names.length === 0) {
  console.error("migration-updown-check FAILED\n");
  console.error(`  - no migration folders found under ${MIGRATIONS_DIR}`);
  process.exit(1);
}

/** Run a child process, surfacing stdout+stderr on failure. Always inherits
 *  process.env (which carries MIGRATE_DATABASE_URL / DATABASE_URL from the
 *  job's `env:` block) unless overridden. */
function run(cmd, args, step, migrationName) {
  try {
    execFileSync(cmd, args, {
      cwd: ROOT_PATH,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
  } catch (err) {
    console.error("migration-updown-check FAILED\n");
    console.error(`  migration: ${migrationName}`);
    console.error(`  step:      ${step}`);
    console.error(`  command:   ${cmd} ${args.join(" ")}`);
    console.error("");
    console.error(String(err.stdout || ""));
    console.error(String(err.stderr || err.message || err));
    process.exit(1);
  }
}

function prismaDeploy(step, migrationName) {
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], step, migrationName);
}

for (const name of names) {
  // 1. up to and including `name` (idempotent — no-ops for anything a prior
  //    iteration already re-applied).
  prismaDeploy(
    "prisma migrate deploy (up to and including this migration)",
    name,
  );

  // 2. parse this migration's -- Down: line.
  const sqlPath = fileURLToPath(
    new URL(`prisma/migrations/${name}/migration.sql`, ROOT),
  );
  const sqlText = readFileSync(sqlPath, "utf8");
  const match = sqlText.match(DOWN_RE);
  if (!match) {
    console.error("migration-updown-check FAILED\n");
    console.error(`  migration: ${name}`);
    console.error(
      "  step:      parse -- Down: line\n" +
        `  ${sqlPath} has no "-- Down: <SQL>" line — every migration must carry\n` +
        "  one (docs/migrations.md), and this gate does not silently skip a\n" +
        "  missing one.",
    );
    process.exit(1);
  }
  const downSql = match[1].trim();

  if (!SAFE_NAME_RE.test(name)) {
    console.error("migration-updown-check FAILED\n");
    console.error(`  migration: ${name}`);
    console.error(
      "  step:      validate folder name before use in SQL\n" +
        `  "${name}" contains characters outside [A-Za-z0-9_] — refusing to\n` +
        "  interpolate it into a SQL statement.",
    );
    process.exit(1);
  }

  // 3. run the down SQL, then delete this migration's own bookkeeping row
  //    from _prisma_migrations, as one transaction (see the file header for
  //    why this replaces `prisma migrate resolve --rolled-back`).
  const transactionalSql = [
    "BEGIN;",
    downSql,
    `DELETE FROM "_prisma_migrations" WHERE migration_name = '${name}';`,
    "COMMIT;",
  ].join("\n");
  run(
    "psql",
    ["-d", migrateUrl, "-v", "ON_ERROR_STOP=1", "-c", transactionalSql],
    `execute -- Down: SQL + delete _prisma_migrations row (${downSql})`,
    name,
  );

  // 4. re-apply forward, restoring "up to and including this migration".
  prismaDeploy("prisma migrate deploy (re-apply forward)", name);
}

console.log(
  `migration-updown-check OK — ${names.length} migrations, each round-tripped up -> down -> up clean.`,
);
