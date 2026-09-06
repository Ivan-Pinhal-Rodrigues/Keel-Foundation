import { expect, test } from "vitest";
import type { Actor } from "@/server/policy/actor";
import {
  INCIDENT_GUEST_KEYS,
  guestIncidentStatusLabel,
  guestSlaLine,
  serializeIncident,
} from "@/server/modules/incident/serialize";

const internal: Actor = {
  id: "u1",
  kind: "INTERNAL",
  hats: ["DEVELOPER"],
  clientId: null,
};
const guest: Actor = { id: "g1", kind: "GUEST", hats: [], clientId: "c1" };
const now = new Date("2026-09-06T12:00:00.000Z");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    ref: "INC-0001",
    title: "Exports failing",
    description: "500 on export",
    affectedService: "billing",
    impact: "HIGH",
    urgency: "HIGH",
    priority: "P1",
    status: "IN_PROGRESS",
    reportedById: "g1",
    clientId: "c1",
    assigneeId: "u1",
    dueAt: new Date("2026-09-06T10:00:00.000Z"), // 2h in the past → overdue
    overdue: false, // stale stored value — must be ignored
    overdueNotifiedAt: null,
    resolution: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date("2026-09-06T06:00:00.000Z"),
    assignee: { displayName: "Dev One" },
    client: { name: "Northwind" },
    ...over,
  };
}

test("internal reader gets the full row plus a freshly-derived overdue", () => {
  const out = serializeIncident(internal, row(), { now, linkedChanges: [] });
  expect(out.priority).toBe("P1");
  expect(out.assigneeId).toBe("u1");
  expect(out.overdue).toBe(true); // derived, not the stored false
});

test("guest reader gets only the allowlist plus the guest transform; no internal fields", () => {
  const out = serializeIncident(guest, row(), { now, linkedChanges: [] });
  const allowed = new Set([
    ...INCIDENT_GUEST_KEYS,
    "status",
    "slaLine",
    "fix",
    "resolvedAt",
  ]);
  for (const k of Object.keys(out)) expect(allowed.has(k)).toBe(true);
  for (const k of [
    "impact",
    "urgency",
    "priority",
    "assigneeId",
    "dueAt",
    "overdue",
    "reportedById",
    "clientId",
  ]) {
    expect(out).not.toHaveProperty(k);
  }
  expect(out.status).toBe("Investigating");
  expect(out.slaLine).toBe("Response overdue");
  expect(out.fix).toBeNull();
});

test("guest fix line follows a FIXES link's change status", () => {
  const openFix = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "FIXES", status: "SCHEDULED" }],
  });
  expect(openFix.fix).toBe("on_the_way");
  const doneFix = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "FIXES", status: "CLOSED" }],
  });
  expect(doneFix.fix).toBe("fixed");
  const causedOnly = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "CAUSED_BY", status: "CLOSED" }],
  });
  expect(causedOnly.fix).toBeNull();
});

test("guestIncidentStatusLabel maps every state (spec section 6)", () => {
  expect(guestIncidentStatusLabel("NEW")).toBe("Reported");
  expect(guestIncidentStatusLabel("ASSIGNED")).toBe("Reported");
  expect(guestIncidentStatusLabel("IN_PROGRESS")).toBe("Investigating");
  expect(guestIncidentStatusLabel("RESOLVED")).toBe("Resolved");
  expect(guestIncidentStatusLabel("CLOSED")).toBe("Closed");
});

test("guestSlaLine: due, overdue, and resolved wording", () => {
  const base = { createdAt: new Date("2026-09-06T06:00:00.000Z") };
  expect(
    guestSlaLine(
      {
        ...base,
        dueAt: new Date("2026-09-06T15:00:00.000Z"),
        status: "IN_PROGRESS",
        resolvedAt: null,
      },
      now,
    ),
  ).toMatch(/due in/i);
  expect(
    guestSlaLine(
      {
        ...base,
        dueAt: new Date("2026-09-06T10:00:00.000Z"),
        status: "IN_PROGRESS",
        resolvedAt: null,
      },
      now,
    ),
  ).toMatch(/overdue/i);
  expect(
    guestSlaLine(
      {
        ...base,
        dueAt: new Date("2026-09-06T10:00:00.000Z"),
        status: "RESOLVED",
        resolvedAt: new Date("2026-09-08T06:00:00.000Z"),
      },
      now,
    ),
  ).toMatch(/resolved in/i);
});
