import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Keel-admin-2026");
  await prisma.user.upsert({
    where: { email: "admin@keel.local" },
    update: {},
    create: {
      email: "admin@keel.local",
      passwordHash,
      displayName: "Keel Admin",
      kind: "INTERNAL",
      hats: [
        "DEVELOPER",
        "REVIEWER",
        "BUSINESS_APPROVER",
        "TECHNICAL_APPROVER",
      ],
    },
  });
  await prisma.client.upsert({
    where: { name: "Northwind Traders" },
    update: {},
    create: { name: "Northwind Traders", isActive: true },
  });
  console.log(
    "seeded: admin@keel.local (Keel-admin-2026), client Northwind Traders",
  );

  // Dev-only display fixtures — a guest and three demands across the lifecycle
  // states, so `/portal/demands`, the internal register, and the board all have
  // something real to render on a fresh database. Never in production.
  if (process.env.NODE_ENV !== "production") {
    await seedDemoDemands();
    await seedDemoIncidents();
  }
}

/**
 * Demo demands for the definition-of-done walkthrough (plan-01 Task 10).
 *
 * Composes with `main()`'s seed — it looks the existing "Northwind Traders"
 * client up by its unique name rather than creating a second one. Everything is
 * `upsert`ed on a unique key (user email, demand `ref`, worth `demandId`) so a
 * second run is a no-op. The fixed refs `DEM-9001..9003` sit far above the
 * `Counter`-allocated `DEM-0001..N` range, so they never collide with demands
 * created through the app.
 *
 * These rows are written directly, outside `runWithContext` — they carry no
 * `AuditEvent` and fire no notifications. They are display fixtures, not a
 * replay of the real lifecycle (the integration test covers that).
 */
async function seedDemoDemands(): Promise<void> {
  const northwind = await prisma.client.findUniqueOrThrow({
    where: { name: "Northwind Traders" },
  });

  const guestHash = await hashPassword("Keel-guest-2026");
  const guest = await prisma.user.upsert({
    where: { email: "guest@northwind.example" },
    update: {},
    create: {
      email: "guest@northwind.example",
      passwordHash: guestHash,
      displayName: "Nadia (Northwind Traders)",
      kind: "GUEST",
      hats: [],
      clientId: northwind.id,
    },
  });

  const internalHash = await hashPassword("Keel-admin-2026");
  const ceo = await prisma.user.upsert({
    where: { email: "ceo@keel.local" },
    update: {},
    create: {
      email: "ceo@keel.local",
      passwordHash: internalHash,
      displayName: "Keel CEO",
      kind: "INTERNAL",
      hats: ["BUSINESS_APPROVER"],
    },
  });
  const cto = await prisma.user.upsert({
    where: { email: "cto@keel.local" },
    update: {},
    create: {
      email: "cto@keel.local",
      passwordHash: internalHash,
      displayName: "Keel CTO",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });

  // DEM-9001 — freshly submitted, still in intake.
  await prisma.demand.upsert({
    where: { ref: "DEM-9001" },
    update: {},
    create: {
      ref: "DEM-9001",
      title: "Faster monthly export",
      problem: "The monthly report takes about 20 minutes to generate.",
      source: "CLIENT",
      status: "SUBMITTED",
      submittedById: guest.id,
      clientId: northwind.id,
    },
  });

  // DEM-9002 — in triage, with a partial worth assessment (value only).
  const dem9002 = await prisma.demand.upsert({
    where: { ref: "DEM-9002" },
    update: {},
    create: {
      ref: "DEM-9002",
      title: "Bulk invoice download",
      problem: "Downloading invoices one at a time is slow at month end.",
      source: "CLIENT",
      status: "TRIAGING",
      submittedById: guest.id,
      clientId: northwind.id,
    },
  });
  await prisma.worthAssessment.upsert({
    where: { demandId: dem9002.id },
    update: {},
    create: {
      demandId: dem9002.id,
      businessValue: "Saves the finance team roughly two hours every month.",
      valueScore: 5,
      valueScoredById: ceo.id,
      // effort + costOfDelay deliberately left null — this worth is incomplete.
    },
  });

  // DEM-9003 — approved (PURSUE), with a complete worth assessment.
  const dem9003 = await prisma.demand.upsert({
    where: { ref: "DEM-9003" },
    update: {},
    create: {
      ref: "DEM-9003",
      title: "Single sign-on for the client portal",
      problem: "Users want to sign in with their company account.",
      source: "CLIENT",
      status: "APPROVED",
      submittedById: guest.id,
      clientId: northwind.id,
      decidedAt: new Date(),
    },
  });
  await prisma.worthAssessment.upsert({
    where: { demandId: dem9003.id },
    update: {},
    create: {
      demandId: dem9003.id,
      businessValue: "Removes the top onboarding blocker; unblocks two deals.",
      valueScore: 8,
      valueScoredById: ceo.id,
      effort: "S",
      effortScoredById: cto.id,
      costOfDelay: "Each month of delay risks one account churning.",
      decision: "PURSUE",
      decidedById: cto.id,
    },
  });

  console.log(
    "seeded demo: guest@northwind.example (Keel-guest-2026), ceo@keel.local, " +
      "cto@keel.local, demands DEM-9001 (submitted) / DEM-9002 (triaging) / " +
      "DEM-9003 (approved)",
  );
}

/**
 * Demo incidents for the incident lifecycle walkthrough (plan-02 Task 11).
 *
 * Composes with `main()`'s seed — it looks up the existing "Northwind Traders"
 * client and existing users (guest@northwind.example, cto@keel.local) by their
 * unique keys rather than creating duplicates. Everything is `upsert`ed on a
 * unique key (incident `ref`) so a second run is a no-op. The fixed refs
 * `INC-9001..9004` sit far above the `Counter`-allocated `INC-0001..N` range,
 * so they never collide with incidents created through the app.
 *
 * These rows are written directly, outside `runWithContext` — they carry no
 * `AuditEvent` and fire no notifications. They are display fixtures, not a
 * replay of the real lifecycle (integration tests cover that).
 */
async function seedDemoIncidents(): Promise<void> {
  const northwind = await prisma.client.findUniqueOrThrow({
    where: { name: "Northwind Traders" },
  });

  const guest = await prisma.user.findUniqueOrThrow({
    where: { email: "guest@northwind.example" },
  });

  const cto = await prisma.user.findUniqueOrThrow({
    where: { email: "cto@keel.local" },
  });

  const now = new Date();

  // INC-9001 — freshly reported, still in NEW status, no assignee.
  await prisma.incident.upsert({
    where: { ref: "INC-9001" },
    update: {},
    create: {
      ref: "INC-9001",
      title: "Login page slow after the last release.",
      description:
        "Users report significant latency when accessing the login page.",
      affectedService: "Authentication",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: guest.id,
      clientId: northwind.id,
      dueAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      overdue: false,
    },
  });

  // INC-9002 — assigned to CTO, medium urgency.
  await prisma.incident.upsert({
    where: { ref: "INC-9002" },
    update: {},
    create: {
      ref: "INC-9002",
      title: "Invoices export as an empty file.",
      description:
        "The export feature returns empty files instead of invoice data.",
      affectedService: "Billing",
      impact: "HIGH",
      urgency: "MEDIUM",
      priority: "P2",
      status: "ASSIGNED",
      reportedById: guest.id,
      clientId: northwind.id,
      assigneeId: cto.id,
      dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      overdue: false,
    },
  });

  // INC-9003 — in progress, high priority, overdue (dueAt is in the past).
  await prisma.incident.upsert({
    where: { ref: "INC-9003" },
    update: {},
    create: {
      ref: "INC-9003",
      title: "Portal is returning 500 for all users.",
      description:
        "All requests to the portal result in HTTP 500 server errors.",
      affectedService: "Portal",
      impact: "HIGH",
      urgency: "HIGH",
      priority: "P1",
      status: "IN_PROGRESS",
      reportedById: guest.id,
      clientId: northwind.id,
      assigneeId: cto.id,
      dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      overdue: true,
      overdueNotifiedAt: now,
    },
  });

  // INC-9004 — resolved, with resolution and resolvedAt set.
  await prisma.incident.upsert({
    where: { ref: "INC-9004" },
    update: {},
    create: {
      ref: "INC-9004",
      title: "Typo in the welcome email.",
      description: "The welcome email template contains a grammatical error.",
      affectedService: "Email",
      impact: "MEDIUM",
      urgency: "LOW",
      priority: "P3",
      status: "RESOLVED",
      reportedById: guest.id,
      clientId: northwind.id,
      assigneeId: cto.id,
      dueAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      overdue: false,
      resolution: "Corrected the typo in the email template and redeployed.",
      resolvedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
    },
  });

  console.log(
    "seeded demo: incidents INC-9001 (new) / INC-9002 (assigned) / " +
      "INC-9003 (in progress, overdue) / INC-9004 (resolved)",
  );
}

main().finally(() => prisma.$disconnect());
