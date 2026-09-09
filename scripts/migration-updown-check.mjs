// Up -> down -> up harness for every migration in prisma/migrations/, run in
// CI's `migrations` job against a scratch database reachable directly at
// MIGRATE_DATABASE_URL (a GitHub Actions `services:` postgres container, not
// docker compose — unlike scripts/check-migrations.mjs, this script never
// shells to `docker compose exec`).
//
// `prisma migrate deploy` has NO partial-target mode: every call applies
// *every* unapplied migration folder currently visible under
// prisma/migrations/, unconditionally — there is no "deploy up to migration
// N" flag. A naive loop that just calls `prisma migrate deploy` once per
// folder and assumes it applied "up to and including that folder" is wrong:
// on an empty DB, the very first call would apply all N folders at once,
// because all N are visible on disk from the start. That breaks the up ->
// down -> up contract for every migration except the last — by the time the
// loop reached migration 2's down step, migrations 3..N would already be
// applied on top of it, and reversing migration 2 out from under them can
// hard-fail (e.g. `DROP TYPE` on a type a later migration's still-live
// column depends on) or, worse, silently corrupt data if the down-SQL used
// CASCADE to push past that failure.
//
// The fix: before processing migration `m[i]`, temporarily MOVE every later
// folder (`m[i+1..N]`) out of prisma/migrations/ into a sibling scratch
// directory (prisma/migrations.hidden/), so only `m[1..i]` are visible on
// disk. This is a pure directory move — `fs.renameSync`, no file content
// touched — fully reversible and zero risk to the actual migration SQL.
// With the invariant "before processing m[i], the DB already has m[1..i-1]
// applied" (true by induction: satisfied trivially for i=1 on an empty DB,
// and re-established for i+1 at the end of every iteration below):
//
//   1. hide m[i+1..N].
//   2. `prisma migrate deploy`   — only m[1..i] are visible and m[1..i-1]
//                                   are already applied, so this call
//                                   applies EXACTLY m[i]. DB is now at
//                                   m[1..i]. ("up".)
//   3. parse m[i]'s `-- Down:` line (single-line, semicolon-terminated SQL,
//      per docs/migrations.md) and run it, then delete m[i]'s own
//      bookkeeping row from `_prisma_migrations`, as one transaction against
//      the DB directly (see the note below on why this replaces `prisma
//      migrate resolve --rolled-back`). DB is now back at m[1..i-1].
//      ("down".)
//   4. `prisma migrate deploy` again — m[i+1..N] are still hidden, and
//      m[i] is the only unapplied migration visible, so this call
//      re-applies exactly m[i]. DB is back at m[1..i]. ("up", re-apply —
//      completes the up -> down -> up cycle for m[i].)
//   5. restore m[i+1..N] back into prisma/migrations/, in a `finally` so
//      this happens even if step 2, 3, or 4 threw — a script that dies
//      mid-run must never leave prisma/migrations/ missing folders, that
//      would corrupt the checkout for whoever inspects or runs against it
//      next.
//   6. proceed to i+1: the invariant "DB has m[1..i] applied" now holds.
//
// After m[N]'s cycle, the DB has every migration applied and
// prisma/migrations/ is fully restored — the same end state a plain
// `prisma migrate deploy` would have produced, so nothing downstream is
// surprised by a partial migrations/ directory or a partial DB.
//
// `_prisma_migrations` row-delete instead of `prisma migrate resolve
// --rolled-back`: that command was tried first and rejected — its compiled
// error string ("... cannot be rolled back because it is not in a failed
// state") makes clear it only accepts migrations whose `_prisma_migrations`
// row is already in a failed (not cleanly finished) state, which a
// migration this script itself just applied successfully never is. Deleting
// the row directly is what actually makes `prisma migrate deploy` in step 4
// treat the migration as never having been applied — the same effect
// `resolve --rolled-back` documents itself as producing, reached by a route
// the CLI's own guard rail does not block. BEGIN/COMMIT wraps both
// statements so a failure in the down SQL can never leave the bookkeeping
// row deleted out from under DDL that didn't actually revert.
//
// Any step failing (including the `-- Down:` parse, or the folder
// hide/restore itself) aborts the whole script after best-effort restoring
// any folders this run had hidden — a partial run otherwise leaves the
// scratch DB in a known-bad state, which is fine: the job's postgres
// `services:` container is destroyed with the runner at the end of the job.
// What is NOT fine is leaving prisma/migrations/ itself missing folders on
// exit, so folder restoration is not skipped on failure.
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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const MIGRATIONS_DIR = fileURLToPath(new URL("prisma/migrations", ROOT));
// Sibling of prisma/migrations/, not an os.tmpdir() path: renameSync across
// filesystems/drives can fail (EXDEV) on some platforms, and this repo's
// checkout and the OS temp dir are not guaranteed to share a drive (this has
// been developed on Windows, where C:\ vs D:\ is exactly that case). A
// sibling directory under prisma/ is guaranteed to be on the same
// filesystem as prisma/migrations/ itself, so every move here is a cheap,
// atomic rename.
const HIDDEN_DIR = fileURLToPath(new URL("prisma/migrations.hidden", ROOT));

const DOWN_RE = /^-- Down:\s*(.+)$/m;
// Migration folder names are already gated elsewhere (check-migrations.mjs's
// NAME_RE, run as part of `pnpm test`) to `<14-digit>_<snake_case>`. Re-check
// here too, defensively, before interpolating a name into a SQL string.
const SAFE_NAME_RE = /^[A-Za-z0-9_]+$/;

/** Thrown for every expected failure mode below (a failing subprocess, a
 *  missing `-- Down:` line, an unsafe folder name). `.message` is already
 *  the full, formatted "migration-updown-check FAILED" block — the top-level
 *  handler just prints it as-is. Kept distinct from a bare Error so folder
 *  restoration (which can itself throw) is never mistaken for one of these
 *  expected failures. */
class MigrationCheckError extends Error {}

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

// `psql -d <url>` parses the URL with libpq's own connection-URI rules, which
// do NOT recognize Prisma's `?schema=` query parameter — Prisma translates
// `schema` into a `search_path` setting itself, internally, but psql has no
// such translation and hard-fails ("invalid URI query parameter: \"schema\"")
// if the raw MIGRATE_DATABASE_URL is passed straight through. This job (see
// .github/workflows/ci.yml's `migrations` job env:) always sets
// MIGRATE_DATABASE_URL to `...keel_scratch?schema=public`, and Postgres'
// default search_path (`"$user", public`) already resolves unqualified names
// to the `public` schema for every role this script connects as — so the fix
// is simply to strip the query string before handing the URL to psql, not to
// replicate Prisma's schema translation. (The `current_schema()` dynamic
// wrapper used inside the migrations themselves is a separate, unrelated
// mechanism for the integration-test harness, which runs against
// `?schema=test_<hex>` scratch schemas — this script only ever targets this
// job's fixed `public`-schema database, never that harness.)
function psqlConnectionString(url) {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

const psqlUrl = psqlConnectionString(migrateUrl);

// If prisma/migrations.hidden/ already exists and is non-empty, a previous
// run of this script crashed (or was killed) before it could restore folders
// it had hidden — the `names` list read below would silently be missing
// whatever is still sitting in there, and this run would proceed against a
// truncated migration set without ever knowing it. Fail fast instead of
// masking that. (An *empty* leftover directory is harmless — e.g. a
// previous run's best-effort `rmdirSync` cleanup itself failed — and is
// just reused below.)
if (existsSync(HIDDEN_DIR) && readdirSync(HIDDEN_DIR).length > 0) {
  console.error("migration-updown-check FAILED\n");
  console.error(
    `  ${HIDDEN_DIR} already exists and is not empty — a previous run of\n` +
      "  this script likely crashed or was killed before it could restore\n" +
      "  hidden migration folders back into prisma/migrations/. Inspect\n" +
      "  both directories, manually move any folders still sitting in\n" +
      "  migrations.hidden/ back into migrations/, then remove\n" +
      "  migrations.hidden/ before re-running.",
  );
  process.exit(1);
}

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
 *  job's `env:` block) unless overridden. Throws MigrationCheckError instead
 *  of exiting directly — callers are inside a per-migration try/finally that
 *  must always get a chance to restore hidden folders before the process
 *  actually exits. */
function run(cmd, args, step, migrationName) {
  try {
    execFileSync(cmd, args, {
      cwd: ROOT_PATH,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
  } catch (err) {
    throw new MigrationCheckError(
      [
        "migration-updown-check FAILED\n",
        `  migration: ${migrationName}`,
        `  step:      ${step}`,
        `  command:   ${cmd} ${args.join(" ")}`,
        "",
        String(err.stdout || ""),
        String(err.stderr || err.message || err),
      ].join("\n"),
    );
  }
}

function prismaDeploy(step, migrationName) {
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], step, migrationName);
}

/** Move `namesToHide` (folders after the migration currently being
 *  processed) out of MIGRATIONS_DIR and into HIDDEN_DIR. Best-effort atomic:
 *  if a rename partway through throws, everything already moved in this
 *  call is moved back before the error propagates, so a failure here never
 *  leaves a partial hide in place. Returns the list actually hidden (==
 *  namesToHide on success), for the matching restoreFolders call. */
function hideFolders(namesToHide) {
  if (namesToHide.length === 0) return [];
  mkdirSync(HIDDEN_DIR, { recursive: true });
  const moved = [];
  try {
    for (const name of namesToHide) {
      renameSync(join(MIGRATIONS_DIR, name), join(HIDDEN_DIR, name));
      moved.push(name);
    }
  } catch (err) {
    for (const name of moved) {
      try {
        renameSync(join(HIDDEN_DIR, name), join(MIGRATIONS_DIR, name));
      } catch {
        // Nothing more we can do here — the outer error below is what
        // surfaces and aborts the run either way.
      }
    }
    throw err;
  }
  return moved;
}

/** Inverse of hideFolders: move `hiddenNames` back into MIGRATIONS_DIR.
 *  Renames each one individually (not wrapped in its own try/catch per
 *  folder) so a failure partway through still tells the caller exactly
 *  which folders remain unrestored — the caller is responsible for treating
 *  that as fatal (see the per-iteration handling below). */
function restoreFolders(hiddenNames) {
  if (hiddenNames.length === 0) return;
  for (const name of hiddenNames) {
    renameSync(join(HIDDEN_DIR, name), join(MIGRATIONS_DIR, name));
  }
  // Best-effort cleanup of the now-empty scratch dir. Leaving an empty
  // migrations.hidden/ behind is harmless — the leftover check above only
  // treats it as a problem when it still contains folders — so a failure
  // here is swallowed rather than escalated.
  try {
    if (readdirSync(HIDDEN_DIR).length === 0) rmdirSync(HIDDEN_DIR);
  } catch {
    // non-fatal
  }
}

/** Everything for one migration's up -> down -> up cycle, with m[i+1..N]
 *  already hidden by the caller. Throws MigrationCheckError (or lets one
 *  propagate from `run`) on any failure. */
function processMigration(name) {
  // 1. apply exactly this migration (everything after it is hidden, and
  //    the invariant guarantees everything before it is already applied).
  prismaDeploy(
    "prisma migrate deploy (apply this migration — later migrations hidden)",
    name,
  );

  // 2. parse this migration's -- Down: line.
  const sqlPath = fileURLToPath(
    new URL(`prisma/migrations/${name}/migration.sql`, ROOT),
  );
  const sqlText = readFileSync(sqlPath, "utf8");
  const match = sqlText.match(DOWN_RE);
  if (!match) {
    throw new MigrationCheckError(
      [
        "migration-updown-check FAILED\n",
        `  migration: ${name}`,
        "  step:      parse -- Down: line",
        `  ${sqlPath} has no "-- Down: <SQL>" line — every migration must carry`,
        "  one (docs/migrations.md), and this gate does not silently skip a",
        "  missing one.",
      ].join("\n"),
    );
  }
  const downSql = match[1].trim();

  if (!SAFE_NAME_RE.test(name)) {
    throw new MigrationCheckError(
      [
        "migration-updown-check FAILED\n",
        `  migration: ${name}`,
        "  step:      validate folder name before use in SQL",
        `  "${name}" contains characters outside [A-Za-z0-9_] — refusing to`,
        "  interpolate it into a SQL statement.",
      ].join("\n"),
    );
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
    ["-d", psqlUrl, "-v", "ON_ERROR_STOP=1", "-c", transactionalSql],
    `execute -- Down: SQL + delete _prisma_migrations row (${downSql})`,
    name,
  );

  // 4. re-apply forward (later migrations are still hidden), restoring
  //    "up to and including this migration" for the next loop iteration.
  prismaDeploy(
    "prisma migrate deploy (re-apply forward — later migrations hidden)",
    name,
  );
}

for (let i = 0; i < names.length; i++) {
  const name = names[i];
  const laterNames = names.slice(i + 1);

  // hideFolders itself restores whatever it managed to move before
  // rethrowing on partial failure, so a throw here means nothing is left
  // hidden — safe to let it propagate straight to the top-level handler.
  const hidden = hideFolders(laterNames);

  let stepError = null;
  try {
    processMigration(name);
  } catch (err) {
    stepError = err;
  }

  try {
    restoreFolders(hidden);
  } catch (restoreErr) {
    console.error(
      "migration-updown-check: WARNING — failed to restore hidden migration " +
        `folders back into\n${MIGRATIONS_DIR} after processing "${name}".\n` +
        `Folders that may still be sitting in ${HIDDEN_DIR}: ${hidden.join(", ")}\n` +
        "Move them back manually before trusting this checkout's prisma/migrations/ layout.\n",
    );
    console.error(
      String(restoreErr && restoreErr.stack ? restoreErr.stack : restoreErr),
    );
    // Escalate a restore failure only when the migration's own steps
    // otherwise succeeded — a real stepError already fully explains the
    // run's failure and takes priority, but the run still must not exit 0
    // while directories are left mutated, so don't silently drop this.
    if (!stepError) stepError = restoreErr;
  }

  if (stepError) {
    if (stepError instanceof MigrationCheckError) {
      console.error(stepError.message);
    } else {
      console.error("migration-updown-check FAILED\n");
      console.error(
        String(stepError && stepError.stack ? stepError.stack : stepError),
      );
    }
    process.exit(1);
  }
}

console.log(
  `migration-updown-check OK — ${names.length} migrations, each round-tripped up -> down -> up clean.`,
);
