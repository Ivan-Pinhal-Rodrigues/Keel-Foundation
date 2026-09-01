import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("Demand with a 1:1 WorthAssessment", async () => {
  const u = await db().user.create({
    data: {
      email: "a@k.local",
      passwordHash: "x",
      displayName: "A",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const d = await db().demand.create({
    data: {
      ref: "DEM-0001",
      title: "SSO",
      problem: "need it",
      source: "CLIENT",
      status: "SUBMITTED",
      submittedById: u.id,
      worth: { create: { costOfDelay: "high" } },
    },
    include: { worth: true },
  });
  expect(d.worth?.demandId).toBe(d.id);
});

test("Change links to an Incident via ChangeIncidentLink kinds", async () => {
  const u = await db().user.create({
    data: {
      email: "b@k.local",
      passwordHash: "x",
      displayName: "B",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const inc = await db().incident.create({
    data: {
      ref: "INC-0001",
      title: "down",
      description: "d",
      affectedService: "API",
      impact: "HIGH",
      urgency: "HIGH",
      priority: "P1",
      status: "NEW",
      reportedById: u.id,
      dueAt: new Date(),
      overdue: false,
    },
  });
  const chg = await db().change.create({
    data: {
      ref: "CHG-0001",
      title: "fix",
      changeType: "EMERGENCY",
      status: "DRAFT",
      ownerId: u.id,
    },
  });
  const link = await db().changeIncidentLink.create({
    data: { changeId: chg.id, incidentId: inc.id, kind: "FIXES" },
  });
  expect(link.kind).toBe("FIXES");
});

test("the Demand<->Change conversion link is one FK, navigable from both ends", async () => {
  const u = await db().user.create({
    data: {
      email: "c@k.local",
      passwordHash: "x",
      displayName: "C",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const d = await db().demand.create({
    data: {
      ref: "DEM-0100",
      title: "portal",
      problem: "need a portal",
      source: "INTERNAL",
      status: "APPROVED",
      submittedById: u.id,
    },
  });
  const chg = await db().change.create({
    data: {
      ref: "CHG-0100",
      title: "build portal",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: u.id,
      originatingDemandId: d.id,
    },
  });

  const fromChange = await db().change.findUnique({
    where: { id: chg.id },
    include: { originatingDemand: true },
  });
  const fromDemand = await db().demand.findUnique({
    where: { id: d.id },
    include: { convertedToChange: true },
  });

  expect(fromChange?.originatingDemand?.id).toBe(d.id);
  expect(fromDemand?.convertedToChange?.id).toBe(chg.id);
});

test("ChangeIncidentLink rejects a duplicate (changeId, incidentId, kind) triple", async () => {
  const u = await db().user.create({
    data: {
      email: "d@k.local",
      passwordHash: "x",
      displayName: "D",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const inc = await db().incident.create({
    data: {
      ref: "INC-0100",
      title: "slow",
      description: "d",
      affectedService: "API",
      impact: "LOW",
      urgency: "LOW",
      priority: "P4",
      status: "NEW",
      reportedById: u.id,
      dueAt: new Date(),
      overdue: false,
    },
  });
  const chg = await db().change.create({
    data: {
      ref: "CHG-0101",
      title: "tune",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: u.id,
    },
  });
  await db().changeIncidentLink.create({
    data: { changeId: chg.id, incidentId: inc.id, kind: "CAUSED_BY" },
  });

  await expect(
    db().changeIncidentLink.create({
      data: { changeId: chg.id, incidentId: inc.id, kind: "CAUSED_BY" },
    }),
  ).rejects.toThrow();

  // the same pair with a different kind is still allowed — the unique is on all three columns
  const fixes = await db().changeIncidentLink.create({
    data: { changeId: chg.id, incidentId: inc.id, kind: "FIXES" },
  });
  expect(fixes.kind).toBe("FIXES");
});
