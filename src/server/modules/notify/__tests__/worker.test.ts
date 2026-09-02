import { expect, test, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { withTestDb } from "@/test/db";
import { backoffMs, runOutboxOnce } from "@/server/modules/notify/worker";

const db = withTestDb();

/**
 * The per-file schema is shared, so each test seeds its own row keyed by a
 * unique `toEmail` and scopes its reads to that address. Every `runOutboxOnce`
 * call is given `db: db()` (the disposable-schema client) and a fake transport.
 */
const seedRow = (
  toEmail: string,
  over: Partial<Prisma.EmailOutboxCreateInput> = {},
) =>
  db().emailOutbox.create({
    data: {
      toEmail,
      template: "guest_invite",
      payload: { clientName: "N", url: "http://x/portal/invite/tok" },
      status: "PENDING",
      ...over,
    },
  });

test("sends a PENDING row and marks it SENT", async () => {
  await seedRow("sent@b.c");
  const transport = { send: vi.fn().mockResolvedValue(undefined) };

  const res = await runOutboxOnce({ transport, db: db() });

  expect(res.sent).toBe(1);
  expect(transport.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "sent@b.c",
      subject: expect.stringContaining("Keel"),
    }),
  );
  const row = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "sent@b.c" },
  });
  expect(row.status).toBe("SENT");
  expect(row.sentAt).not.toBeNull();
});

test("transient failure: attempts++ , stays PENDING, nextAttemptAt pushed out", async () => {
  await seedRow("transient@b.c");
  const transport = {
    send: vi.fn().mockRejectedValue(new Error("smtp down")),
  };
  const before = Date.now();

  const res = await runOutboxOnce({ transport, db: db() });

  expect(res.sent).toBe(0);
  expect(res.failed).toBe(0);
  const row = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "transient@b.c" },
  });
  expect(row.attempts).toBe(1);
  expect(row.status).toBe("PENDING");
  expect(row.nextAttemptAt.getTime()).toBeGreaterThan(before);
  expect(row.lastError).toContain("smtp down");
});

test("gives up at attempts >= 6 -> FAILED", async () => {
  await seedRow("givesup@b.c", { attempts: 5 });
  const transport = {
    send: vi.fn().mockRejectedValue(new Error("still down")),
  };

  const res = await runOutboxOnce({ transport, db: db() });

  expect(res.failed).toBe(1);
  const row = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "givesup@b.c" },
  });
  expect(row.status).toBe("FAILED");
  expect(row.attempts).toBe(6);
});

test("a row with nextAttemptAt in the future is skipped and counted deferred", async () => {
  await seedRow("future@b.c", {
    nextAttemptAt: new Date(Date.now() + 3_600_000),
  });
  const transport = { send: vi.fn().mockResolvedValue(undefined) };

  const res = await runOutboxOnce({ transport, db: db() });

  expect(res.sent).toBe(0);
  expect(res.deferred).toBeGreaterThanOrEqual(1);
  expect(transport.send).not.toHaveBeenCalled();
  const row = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "future@b.c" },
  });
  expect(row.status).toBe("PENDING");
});

test("advisory lock: two concurrent ticks send one pending row exactly once", async () => {
  await seedRow("concurrent@b.c");
  const send = vi.fn().mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const transport = { send };

  const [a, b] = await Promise.all([
    runOutboxOnce({ transport, db: db() }),
    runOutboxOnce({ transport, db: db() }),
  ]);

  expect(send).toHaveBeenCalledTimes(1);
  expect(a.sent + b.sent).toBe(1);
  const row = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "concurrent@b.c" },
  });
  expect(row.status).toBe("SENT");
});

test("backoffMs is min(2^attempts, 30) minutes", () => {
  expect(backoffMs(1)).toBe(120_000);
  expect(backoffMs(5)).toBe(1_800_000);
  expect(backoffMs(10)).toBe(1_800_000);
});
