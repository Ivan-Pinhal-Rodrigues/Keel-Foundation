import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import {
  clientForInviteToken,
  createInvite,
  sha256,
} from "@/server/auth/invites";
import { runWithContext } from "@/server/context";
import { ForbiddenError } from "@/server/policy/errors";
import type { Actor } from "@/server/policy/actor";
import { withTestDb } from "@/test/db";

const db = withTestDb();

const internal: Actor = {
  id: "u-internal",
  kind: "INTERNAL",
  hats: ["DEVELOPER"],
  clientId: null,
};
const guest: Actor = {
  id: "u-guest",
  kind: "GUEST",
  hats: [],
  clientId: "c-elsewhere",
};

const seedClient = (name = "Northwind") =>
  db().client.upsert({
    where: { name },
    update: {},
    create: { name, isActive: true },
  });

/** A unique invitee address per test — the per-file schema is shared across
 *  tests, so every row this file writes is scoped by its own email. */
const uniqueEmail = () => `g-${randomBytes(5).toString("hex")}@n.example`;

test("createInvite stores a hashed token and returns a redeem URL", async () => {
  const client = await seedClient();
  const email = uniqueEmail();
  const { url } = await runWithContext(
    { requestId: "req-inv-1", actorId: internal.id },
    () => createInvite(internal, db(), { clientId: client.id, email }),
  );

  const token = url.split("/").pop()!;
  const row = await db().guestInvite.findFirstOrThrow({ where: { email } });
  expect(row.token).not.toBe(token); // stored hashed, not raw
  expect(row.token).toBe(sha256(token));
  expect(url).toContain("/portal/invite/");

  const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);
});

test("createInvite refuses a guest actor with ForbiddenError and writes nothing", async () => {
  const client = await seedClient();
  const before = await db().guestInvite.count();

  await expect(
    runWithContext({ requestId: "req-inv-2", actorId: guest.id }, () =>
      createInvite(guest, db(), { clientId: client.id, email: uniqueEmail() }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  expect(await db().guestInvite.count()).toBe(before);
});

test("createInvite emits a guest_invite.created audit row with the right fields", async () => {
  const client = await seedClient();
  const email = uniqueEmail();
  await runWithContext({ requestId: "req-inv-3", actorId: internal.id }, () =>
    createInvite(internal, db(), { clientId: client.id, email }),
  );

  const invite = await db().guestInvite.findFirstOrThrow({ where: { email } });
  const ev = await db().auditEvent.findFirstOrThrow({
    where: { action: "guest_invite.created", subjectId: invite.id },
  });
  expect(ev.actorId).toBe(internal.id);
  expect(ev.subjectType).toBe("GuestInvite");
  expect(ev.requestId).toBe("req-inv-3");
  expect(ev.payload).toEqual({ clientId: client.id, email });
});

test("clientForInviteToken returns the inviting client name for a live invite", async () => {
  const client = await seedClient("Contoso");
  const { url } = await runWithContext(
    { requestId: "req-inv-4", actorId: internal.id },
    () =>
      createInvite(internal, db(), {
        clientId: client.id,
        email: uniqueEmail(),
      }),
  );
  const raw = url.split("/").pop()!;
  expect(await clientForInviteToken(raw, db())).toEqual({
    clientName: "Contoso",
  });
});

test("clientForInviteToken is null for an unknown, expired, or redeemed token", async () => {
  const client = await seedClient();

  expect(
    await clientForInviteToken(randomBytes(32).toString("base64url"), db()),
  ).toBeNull();

  const expiredRaw = randomBytes(32).toString("base64url");
  await db().guestInvite.create({
    data: {
      token: sha256(expiredRaw),
      clientId: client.id,
      email: uniqueEmail(),
      createdById: internal.id,
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  expect(await clientForInviteToken(expiredRaw, db())).toBeNull();

  const redeemedRaw = randomBytes(32).toString("base64url");
  await db().guestInvite.create({
    data: {
      token: sha256(redeemedRaw),
      clientId: client.id,
      email: uniqueEmail(),
      createdById: internal.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      redeemedAt: new Date(),
    },
  });
  expect(await clientForInviteToken(redeemedRaw, db())).toBeNull();
});
