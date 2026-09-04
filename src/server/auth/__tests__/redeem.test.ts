import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { redeemInvite, sha256 } from "@/server/auth/invites";
import { verifyPassword } from "@/server/auth/password";
import { runWithContext } from "@/server/context";
import { GoneError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

const db = withTestDb();

const PASSWORD = "correct horse battery";

/** Seed a client + a live invite; return the raw (unhashed) token. */
async function seedInvite(overrides: Record<string, unknown> = {}) {
  const client = await db().client.upsert({
    where: { name: "Stark Industries" },
    update: {},
    create: { name: "Stark Industries", isActive: true },
  });
  const raw = randomBytes(32).toString("base64url");
  const invite = await db().guestInvite.create({
    data: {
      token: sha256(raw),
      clientId: client.id,
      email: `invitee-${randomBytes(5).toString("hex")}@stark.example`,
      createdById: "u-internal",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      ...overrides,
    },
  });
  return { client, invite, raw };
}

const redeem = (raw: string, name = "Pepper Potts", password = PASSWORD) =>
  runWithContext({ requestId: `req-${randomBytes(4).toString("hex")}` }, () =>
    redeemInvite(db(), { rawToken: raw, name, password }),
  );

test("a valid token creates a scoped GUEST user, consumes the invite, and audits it", async () => {
  const { client, invite, raw } = await seedInvite();

  const { userId } = await redeem(raw);

  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  expect(user.kind).toBe("GUEST");
  expect(user.hats).toEqual([]);
  expect(user.clientId).toBe(client.id);
  expect(user.displayName).toBe("Pepper Potts");
  expect(user.email).toBe(invite.email);
  expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);

  const consumed = await db().guestInvite.findUniqueOrThrow({
    where: { id: invite.id },
  });
  expect(consumed.redeemedAt).not.toBeNull();

  const ev = await db().auditEvent.findFirstOrThrow({
    where: { action: "guest_invite.redeemed", subjectId: invite.id },
  });
  expect(ev.actorId).toBe(userId);
  expect(ev.subjectType).toBe("GuestInvite");
  expect(ev.requestId).toBeTruthy();
});

test("an expired invite throws GoneError and creates no user", async () => {
  const { invite, raw } = await seedInvite({
    expiresAt: new Date(Date.now() - 1000),
  });
  const before = await db().user.count();
  await expect(redeem(raw)).rejects.toBeInstanceOf(GoneError);
  expect(await db().user.count()).toBe(before);
  const still = await db().guestInvite.findUniqueOrThrow({
    where: { id: invite.id },
  });
  expect(still.redeemedAt).toBeNull();
});

test("a second redemption of the same token throws GoneError", async () => {
  const { raw } = await seedInvite();
  await redeem(raw);
  await expect(redeem(raw, "Someone Else")).rejects.toBeInstanceOf(GoneError);
});

test("an unknown token throws GoneError", async () => {
  const bogus = randomBytes(32).toString("base64url");
  await expect(redeem(bogus)).rejects.toBeInstanceOf(GoneError);
});

test("an invite whose email already has an account throws GoneError, no second user", async () => {
  const { invite, raw } = await seedInvite();
  await db().user.create({
    data: {
      email: invite.email,
      passwordHash: "x",
      displayName: "Already Here",
      kind: "INTERNAL",
      hats: [],
    },
  });
  const before = await db().user.count();
  await expect(redeem(raw)).rejects.toBeInstanceOf(GoneError);
  expect(await db().user.count()).toBe(before);
});

/** Redeem in its own transaction — `db().$transaction` is the wrapper the route
 *  drives `redeemInvite` through (`runInTransaction` is `$transaction` on the
 *  app singleton), so two of these race exactly as two requests would. */
const redeemTxn = (raw: string, name: string) =>
  runWithContext({ requestId: `req-${randomBytes(4).toString("hex")}` }, () =>
    db().$transaction((tx) =>
      redeemInvite(tx, { rawToken: raw, name, password: PASSWORD }),
    ),
  );

test("two redemptions racing one token: one wins, one GoneErrors, one user results", async () => {
  const { invite, raw } = await seedInvite();

  const results = await Promise.allSettled([
    redeemTxn(raw, "First Arrival"),
    redeemTxn(raw, "Second Arrival"),
  ]);

  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toBeInstanceOf(GoneError);

  expect(await db().user.count({ where: { email: invite.email } })).toBe(1);
  const consumed = await db().guestInvite.findUniqueOrThrow({
    where: { id: invite.id },
  });
  expect(consumed.redeemedAt).not.toBeNull();
});

test("two invites for one email, redeemed concurrently: loser GoneErrors via the unique-index backstop", async () => {
  const { client } = await seedInvite();
  const email = `dup-${randomBytes(5).toString("hex")}@stark.example`;
  const mk = async () => {
    const raw = randomBytes(32).toString("base64url");
    await db().guestInvite.create({
      data: {
        token: sha256(raw),
        clientId: client.id,
        email,
        createdById: "u-internal",
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return raw;
  };
  const [a, b] = [await mk(), await mk()];
  const results = await Promise.allSettled([
    redeemTxn(a, "A"),
    redeemTxn(b, "B"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rej = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  expect(rej).toHaveLength(1);
  expect(rej[0]?.reason).toBeInstanceOf(GoneError);
  expect(await db().user.count({ where: { email } })).toBe(1);
});
