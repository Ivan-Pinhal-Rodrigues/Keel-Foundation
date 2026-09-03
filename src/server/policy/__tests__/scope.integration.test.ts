import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { scopeToClient } from "../scope";

/**
 * The DB backing for the "GUEST => clientId non-null" invariant that
 * `scopeToClient` (and the assert-helpers) fail closed on. The
 * `user_guest_has_client` CHECK constraint (migration
 * `20260903005643_user_guest_client_check`) makes the null a guest actor could
 * carry impossible to persist in the first place.
 */

const db = withTestDb();

test("the user_guest_has_client CHECK rejects nulling a guest's clientId", async () => {
  const client = await db().client.create({ data: { name: "Acme" } });
  const guest = await db().user.create({
    data: {
      email: "guest@acme.test",
      passwordHash: "x",
      displayName: "Guest",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });

  const nullOutClientId = () =>
    db()
      .$executeRaw`UPDATE "User" SET "clientId" = NULL WHERE id = ${guest.id}`;
  await expect(nullOutClientId()).rejects.toThrow(
    /user_guest_has_client|check constraint/i,
  );

  // the row is untouched — the write was rejected, not silently dropped
  const after = await db().user.findUniqueOrThrow({ where: { id: guest.id } });
  expect(after.clientId).toBe(client.id);
});

test("an INTERNAL user may still have a null clientId", async () => {
  const internal = await db().user.create({
    data: {
      email: "staff@keel.test",
      passwordHash: "x",
      displayName: "Staff",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  expect(internal.clientId).toBeNull();
});

test("scopeToClient for a null-clientId guest, spread into a real query, matches zero rows", async () => {
  const c1 = await db().client.create({ data: { name: "Client One" } });
  const c2 = await db().client.create({ data: { name: "Client Two" } });
  await db().user.create({
    data: {
      email: "g1@one.test",
      passwordHash: "x",
      displayName: "G1",
      kind: "GUEST",
      hats: [],
      clientId: c1.id,
    },
  });
  await db().user.create({
    data: {
      email: "g2@two.test",
      passwordHash: "x",
      displayName: "G2",
      kind: "GUEST",
      hats: [],
      clientId: c2.id,
    },
  });

  const scoped = scopeToClient({
    id: "g",
    kind: "GUEST",
    hats: [],
    clientId: null,
  });
  const rows = await db().user.findMany({ where: { ...scoped } });
  expect(rows).toEqual([]);

  // sanity: the rows exist — a `{}` where (the old fail-open behaviour) would
  // have returned all of them
  expect(await db().user.count()).toBeGreaterThan(0);
});
