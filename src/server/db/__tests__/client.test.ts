import { expect, test } from "vitest";
import { prisma } from "@/server/db/client";

test("prisma client connects and runs a trivial query", async () => {
  const rows =
    await prisma.$queryRawUnsafe<{ one: number }[]>("SELECT 1 as one");
  expect(rows[0]?.one).toBe(1);
});
