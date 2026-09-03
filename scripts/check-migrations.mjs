// Migration gate check. Runs in `pnpm test` (needs the compose DB up, same as
// the integration tests). Two assertions:
//
//   (a) every folder in prisma/migrations/ is `<14-digit UTC timestamp>_<snake>`
//       and no two share a timestamp prefix (apply order stays unambiguous);
//
//   (b) no record-of-fact table (append-only by design) is UPDATE/DELETE-able by
//       the runtime role. 20260901200800_audit_grants grants keel_app full DML
//       `ON ALL TABLES` and sets the same as the default for later tables; each
//       record-of-fact table must REVOKE UPDATE, DELETE in its own migration
//       (see docs/migrations.md).
//
// Node ESM script — no TypeScript, no dependencies. `process` / `console` / URL
// are Node globals.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(new URL("prisma/migrations", ROOT));

/** Tables that are a permanent record of a fact and must never be mutated by the
 *  application. `AuditEvent` is locked by 20260901200800_audit_grants; the rest
 *  by 20260903125809_audit_default_privileges and, going forward, by their own
 *  creating migration. */
const RECORD_OF_FACT = [
  "AuditEvent",
  "ApprovalDecision",
  "PostImplementationReview",
];

const NAME_RE = /^\d{14}_[a-z0-9_]+$/;

/** @type {string[]} */
const problems = [];

// ---------------------------------------------------------------------------
// (a) migration folder naming + no colliding timestamps
// ---------------------------------------------------------------------------

// readdirSync order is filesystem-dependent (ext4 returns hash order), so it is
// not a reliable signal. Sort into apply order — lexical == chronological, since
// every name is prefixed with a zero-padded 14-digit UTC timestamp — and instead
// guard the thing that actually matters: no two migrations share a timestamp.
const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const name of names) {
  if (!NAME_RE.test(name)) {
    problems.push(
      `migration folder "${name}" is not <14-digit UTC timestamp>_<snake_case> ` +
        `(e.g. 20260903120000_add_widget) — see docs/migrations.md`,
    );
  }
}

const stamps = names.map((name) => name.slice(0, 14));
const collisions = [
  ...new Set(stamps.filter((s, i) => stamps.indexOf(s) !== i)),
];
if (collisions.length > 0) {
  problems.push(
    `two or more migrations share a timestamp prefix (${collisions.join(", ")}) — ` +
      "regenerate one so the apply order is unambiguous",
  );
}

// ---------------------------------------------------------------------------
// (b) record-of-fact tables are append-only for the runtime role
// ---------------------------------------------------------------------------

/** DATABASE_URL from the environment (set when run via dotenv) or parsed from
 *  .env — this script runs as its own process after `vitest run`, so it does not
 *  inherit vitest.setup.ts's dotenv load. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(fileURLToPath(new URL(".env", ROOT)), "utf8");
  const match = envText.match(
    /^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m,
  );
  if (!match) {
    throw new Error("DATABASE_URL is not set and was not found in .env");
  }
  return match[1];
}

const url = new URL(databaseUrl());
const dbUser = decodeURIComponent(url.username) || "keel_app";
const dbName = url.pathname.replace(/^\//, "") || "keel";

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbUser)) {
  throw new Error(
    `unexpected database user in DATABASE_URL: ${JSON.stringify(dbUser)}`,
  );
}

const query =
  "SELECT table_name FROM information_schema.role_table_grants " +
  `WHERE grantee = '${dbUser}' AND privilege_type IN ('UPDATE','DELETE') ` +
  "AND table_schema = 'public' " +
  `AND table_name IN (${RECORD_OF_FACT.map((t) => `'${t}'`).join(", ")})`;

let rawGrants = "";
try {
  rawGrants = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      dbUser,
      "-d",
      dbName,
      "-tAc",
      query,
    ],
    {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (err) {
  console.error("check:migrations — could not query the database.");
  console.error("  The compose stack must be up:  docker compose up -d db");
  console.error(String(err.stderr || err.message || err));
  process.exit(1);
}

const offenders = [
  ...new Set(
    rawGrants
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
].sort();

if (offenders.length > 0) {
  problems.push(
    `record-of-fact table(s) are UPDATE/DELETE-able by "${dbUser}": ${offenders.join(", ")}\n` +
      `      add  REVOKE UPDATE, DELETE ON "<table>" FROM ${dbUser}  to the migration that\n` +
      "      creates the table (schema-aware, via current_schema()) — see docs/migrations.md",
  );
}

// ---------------------------------------------------------------------------

if (problems.length > 0) {
  console.error("check:migrations FAILED\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `check:migrations OK — ${names.length} migrations, names + timestamps clean; ` +
    `${RECORD_OF_FACT.length} record-of-fact tables append-only for "${dbUser}".`,
);
