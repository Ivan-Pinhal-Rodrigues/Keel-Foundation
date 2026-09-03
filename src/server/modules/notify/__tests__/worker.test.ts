import { beforeEach, expect, test, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { withTestDb } from "@/test/db";
import { backoffMs, runOutboxOnce } from "@/server/modules/notify/worker";

const db = withTestDb();

// `runOutboxOnce` claims every due PENDING row in the schema, so the outbox is
// truncated before each test rather than scoping every assertion by address.
beforeEach(async () => {
  await db().emailOutbox.deleteMany();
});

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
      // Explicitly due-in-the-past. Relying on the `@default(now())` value being
      // `<= ` the `new Date()` that `runOutboxOnce` captures a few ms later is a
      // race: under the full suite's parallel load the margin flips and the
      // claim query returns 0 rows. A test that wants a future row overrides
      // this via `over`.
      nextAttemptAt: new Date(Date.now() - 60_000),
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

test("the claim query honours ORDER BY createdAt + LIMIT NOTIFY_BATCH", async () => {
  const prev = process.env.NOTIFY_BATCH;
  process.env.NOTIFY_BATCH = "2";
  try {
    // Distinct createdAt values so ORDER BY is deterministic; only the two
    // oldest may be claimed this tick.
    await seedRow("batch-1@b.c", { createdAt: new Date(Date.now() - 3000) });
    await seedRow("batch-2@b.c", { createdAt: new Date(Date.now() - 2000) });
    await seedRow("batch-3@b.c", { createdAt: new Date(Date.now() - 1000) });
    const transport = { send: vi.fn().mockResolvedValue(undefined) };

    const res = await runOutboxOnce({ transport, db: db() });

    expect(res.sent).toBe(2);
    const sent = await db().emailOutbox.findMany({
      where: { status: "SENT" },
      select: { toEmail: true },
    });
    expect(sent.map((r) => r.toEmail).sort()).toEqual([
      "batch-1@b.c",
      "batch-2@b.c",
    ]);
    const third = await db().emailOutbox.findFirstOrThrow({
      where: { toEmail: "batch-3@b.c" },
    });
    expect(third.status).toBe("PENDING");
  } finally {
    if (prev === undefined) delete process.env.NOTIFY_BATCH;
    else process.env.NOTIFY_BATCH = prev;
  }
});

test("advisory lock: runOutboxOnce no-ops while another holder has keel:outbox", async () => {
  await seedRow("locked-1@b.c");
  await seedRow("locked-2@b.c");
  const transport = { send: vi.fn().mockResolvedValue(undefined) };

  // A separate, concurrent transaction holds keel:outbox. `acquired` resolves
  // once it has the lock; `gate` keeps it held until we release it.
  let lockAcquired!: () => void;
  const acquired = new Promise<void>((r) => {
    lockAcquired = r;
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const holder = db().$transaction(
    async (t) => {
      const rows = await t.$queryRaw<{ got: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('keel:outbox')) AS got
      `;
      if (!rows[0]?.got)
        throw new Error("test holder failed to take keel:outbox");
      lockAcquired();
      await gate;
    },
    { timeout: 20_000 },
  );

  try {
    await acquired;

    // runOutboxOnce opens its own $transaction on a different pooled connection;
    // its pg_try_advisory_xact_lock returns false, so the tick no-ops even
    // though two rows are due.
    const held = await runOutboxOnce({ transport, db: db() });
    expect(held).toEqual({ sent: 0, failed: 0, deferred: 0 });
    expect(transport.send).not.toHaveBeenCalled();
    expect(await db().emailOutbox.count({ where: { status: "PENDING" } })).toBe(
      2,
    );
  } finally {
    release();
    await holder;
  }

  // Lock released — the next tick drains both rows.
  const after = await runOutboxOnce({ transport, db: db() });
  expect(after.sent).toBe(2);
  expect(transport.send).toHaveBeenCalledTimes(2);
});

test("two concurrent ticks send one pending row exactly once", async () => {
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

test("a thrown template error is contained to its row; the rest of the tick sends", async () => {
  await seedRow("tick-good@b.c");
  await seedRow("tick-bad@b.c", { template: "does_not_exist" });
  const transport = { send: vi.fn().mockResolvedValue(undefined) };

  const res = await runOutboxOnce({ transport, db: db() });

  expect(res.sent).toBe(1);
  expect(res.failed).toBe(0);
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(transport.send).toHaveBeenCalledWith(
    expect.objectContaining({ to: "tick-good@b.c" }),
  );

  const good = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "tick-good@b.c" },
  });
  expect(good.status).toBe("SENT");

  const bad = await db().emailOutbox.findFirstOrThrow({
    where: { toEmail: "tick-bad@b.c" },
  });
  expect(bad.status).toBe("PENDING");
  expect(bad.attempts).toBe(1);
  expect(bad.lastError).toMatch(/unknown template/i);
});

test("backoffMs is min(2^attempts, 30) minutes", () => {
  expect(backoffMs(1)).toBe(120_000);
  expect(backoffMs(5)).toBe(1_800_000);
  expect(backoffMs(10)).toBe(1_800_000);
});
