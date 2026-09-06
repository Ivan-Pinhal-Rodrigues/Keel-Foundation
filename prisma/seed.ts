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

main().finally(() => prisma.$disconnect());
