import { expect, test } from "vitest";
import type { Actor } from "@/server/policy/actor";
import {
  serializeDemand,
  DEMAND_GUEST_KEYS,
  guestStatusLabel,
} from "@/server/modules/demand/serialize";

const internal: Actor = {
  id: "u1",
  kind: "INTERNAL",
  hats: [],
  clientId: null,
};
const guest: Actor = { id: "g1", kind: "GUEST", hats: [], clientId: "c1" };

const row = {
  id: "d1",
  ref: "DEM-0001",
  title: "T",
  problem: "P",
  source: "CLIENT",
  status: "TRIAGING",
  submittedById: "g1",
  clientId: "c1",
  affectedService: "billing",
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  worth: {
    id: "w1",
    demandId: "d1",
    businessValue: "high",
    valueScore: 8,
    effort: "M",
    costOfDelay: "grows",
    decision: null,
    decisionNote: null,
    isSingleApproverOverride: false,
    overrideJustification: null,
  },
  client: { name: "Northwind" },
} as unknown as Record<string, unknown>;

test("internal reader sees the worth assessment", () => {
  const out = serializeDemand(internal, row);
  expect(out.worth).toBeTruthy();
  expect(out.status).toBe("TRIAGING");
});

test("guest reader gets exactly the allowlisted keys plus the guest transform, and a plain-word status", () => {
  const out = serializeDemand(guest, row);
  expect(Object.keys(out).sort()).toEqual(
    [...DEMAND_GUEST_KEYS, "status", "clientName"].sort(),
  );
  expect(out.worth).toBeUndefined(); // never in guestKeys -> cannot leak
  expect(out.status).toBe("In review");
});

test("guestStatusLabel maps every state", () => {
  expect(guestStatusLabel("SUBMITTED", null, null)).toBe("In review");
  expect(guestStatusLabel("APPROVED", "PURSUE", null)).toBe("Approved");
  expect(guestStatusLabel("CONVERTED", "PURSUE", null)).toBe("In progress");
  expect(guestStatusLabel("REJECTED", "DROP", "out of scope")).toMatch(
    /declined/i,
  );
});
