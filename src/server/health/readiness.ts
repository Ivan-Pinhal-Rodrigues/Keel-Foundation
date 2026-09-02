import { readdir } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * The readiness probe behind `GET /api/readyz` (spec 08 §5).
 *
 * Two checks, both required for `ok`:
 *  - **db** — `SELECT 1` succeeds against the runtime connection.
 *  - **migrations** — every folder in `prisma/migrations/` has a matching
 *    applied row in `_prisma_migrations`. A folder with no applied row means a
 *    deploy landed new code before its migration ran → `"pending"`.
 *
 * `deps` is a test seam: inject a stub `db` to simulate an outage, or a
 * `migrationsDir` to simulate a lag. Production passes nothing and gets the
 * app `prisma` singleton and the real migrations directory.
 *
 * The migrations check issues its own `$queryRaw`, so when the DB is
 * unreachable both checks report an error — that is expected, not a bug.
 */

type Checks = { db: "ok" | "error"; migrations: "ok" | "pending" | "error" };

export async function checkReadiness(deps?: {
  db?: Pick<PrismaClient, "$queryRaw">;
  migrationsDir?: string;
}): Promise<{ ok: boolean; checks: Checks }> {
  const db = deps?.db ?? prisma;
  const migrationsDir =
    deps?.migrationsDir ?? path.join(process.cwd(), "prisma/migrations");

  const checks: Checks = {
    db: await checkDb(db),
    migrations: await checkMigrations(db, migrationsDir),
  };

  return { ok: checks.db === "ok" && checks.migrations === "ok", checks };
}

async function checkDb(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<"ok" | "error"> {
  try {
    await db.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * The check is one-directional. A migration folder with no applied row →
 * `"pending"` (code shipped ahead of its migration — do not take traffic). An
 * applied row with no folder → still `"ok"`: the DB is ahead of this build,
 * which is the normal mid-rollout state, and an old pod that can still serve
 * every request it receives should stay ready.
 */
async function checkMigrations(
  db: Pick<PrismaClient, "$queryRaw">,
  dir: string,
): Promise<"ok" | "pending" | "error"> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const rows = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    const applied = new Set(rows.map((r) => r.migration_name));

    return folders.every((name) => applied.has(name)) ? "ok" : "pending";
  } catch {
    return "error";
  }
}
