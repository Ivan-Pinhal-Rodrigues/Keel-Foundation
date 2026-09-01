import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("can create a Client and an INTERNAL user with hats", async () => {
  const client = await db().client.create({
    data: { name: "Northwind", isActive: true },
  });
  const user = await db().user.create({
    data: {
      email: "cto@keel.local",
      passwordHash: "x",
      displayName: "CTO",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
      isActive: true,
    },
  });
  expect(user.hats).toContain("TECHNICAL_APPROVER");
  expect(client.id).toBeTruthy();
});

test("a GUEST user carries a clientId", async () => {
  const client = await db().client.create({
    data: { name: "Acme", isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: "g@acme.example",
      passwordHash: "x",
      displayName: "Guest",
      kind: "GUEST",
      hats: [],
      isActive: true,
      clientId: client.id,
    },
  });
  expect(guest.clientId).toBe(client.id);
});

test("a GuestInvite round-trips and a Counter upserts", async () => {
  const client = await db().client.create({
    data: { name: "Globex", isActive: true },
  });
  const inviter = await db().user.create({
    data: {
      email: "host@keel.local",
      passwordHash: "x",
      displayName: "Host",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });

  const invite = await db().guestInvite.create({
    data: {
      token: "hashed-token-value",
      clientId: client.id,
      email: "invitee@globex.example",
      createdById: inviter.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  expect(invite.clientId).toBe(client.id);
  expect(invite.redeemedAt).toBeNull();

  const roundTripped = await db().guestInvite.findUnique({
    where: { token: "hashed-token-value" },
  });
  expect(roundTripped?.id).toBe(invite.id);

  const created = await db().counter.upsert({
    where: { name: "DEM" },
    create: { name: "DEM", value: 1 },
    update: { value: { increment: 1 } },
  });
  expect(created.value).toBe(1);

  const bumped = await db().counter.upsert({
    where: { name: "DEM" },
    create: { name: "DEM", value: 1 },
    update: { value: { increment: 1 } },
  });
  expect(bumped.value).toBe(2);
});
