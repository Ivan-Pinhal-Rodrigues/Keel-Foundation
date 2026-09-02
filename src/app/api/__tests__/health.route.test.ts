import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GET as healthzGET } from "@/app/api/healthz/route";
import { GET as readyzGET } from "@/app/api/readyz/route";
import { checkReadiness } from "@/server/health/readiness";

/**
 * Integration test — `checkReadiness()` and `readyzGET()` with no injected deps
 * run against the real `prisma` singleton and the migrated dev DB (docker up),
 * exactly like the other `api/**` route tests. The pending-migration and
 * db-down cases are driven through the `deps` seam instead.
 */

const realMigrationsDir = path.join(process.cwd(), "prisma", "migrations");

async function realMigrationNames(): Promise<string[]> {
  const entries = await readdir(realMigrationsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

test("healthz is always 200 with { status: 'ok' } and touches no DB", async () => {
  const res = await healthzGET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("checkReadiness is all-green against the migrated dev DB", async () => {
  const r = await checkReadiness();
  expect(r).toEqual({ ok: true, checks: { db: "ok", migrations: "ok" } });
});

test("readyz is 200 against the migrated dev DB", async () => {
  const res = await readyzGET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    status: "ok",
    checks: { db: "ok", migrations: "ok" },
  });
});

test("checkReadiness reports migrations: pending when a folder is unapplied", async () => {
  const names = [
    ...(await realMigrationNames()),
    "99999999999999_pending_fake",
  ];
  const tmp = await mkdtemp(path.join(os.tmpdir(), "keel-readyz-"));
  try {
    for (const name of names) await mkdir(path.join(tmp, name));

    const r = await checkReadiness({ migrationsDir: tmp });
    expect(r.checks.migrations).toBe("pending");
    expect(r.ok).toBe(false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("checkReadiness reports db: error when the query rejects", async () => {
  const db = {
    $queryRaw: vi.fn().mockRejectedValue(new Error("db down")),
  } as unknown as Pick<PrismaClient, "$queryRaw">;

  const r = await checkReadiness({ db });
  expect(r.checks.db).toBe("error");
  expect(r.ok).toBe(false);
});
