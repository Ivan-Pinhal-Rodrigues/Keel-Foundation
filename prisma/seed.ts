import type { $Enums } from "@prisma/client";
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
    await seedDemoChanges();
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

/**
 * Demo changes for the change + approvals walkthrough (plan-03 Task 14).
 *
 * Composes with `main()`'s seed — it looks up the existing internal users
 * (admin@keel.local, ceo@keel.local, cto@keel.local), the approved/pursued demand
 * (DEM-9003), and the resolved incident (INC-9004) by their unique keys rather
 * than creating duplicates. Everything is `upsert`ed on a unique key (change
 * `ref`), with the approval / PIR / incident-link rows guarded by a pre-check, so
 * a second run is a no-op. The fixed refs `CHG-9001..9003` sit far above the
 * `Counter`-allocated `CHG-0001..N` range, so they never collide with changes
 * created through the app.
 *
 * These rows are written directly, outside `runWithContext` — they carry no
 * `AuditEvent` and fire no notifications. They are display fixtures, not a replay
 * of the real lifecycle (the integration test covers that). The
 * `ApprovalRequest` / `ApprovalStep` / `ApprovalDecision` rows are created here
 * directly: the record-of-fact REVOKE only blocks `UPDATE` / `DELETE`, so an
 * `INSERT` is fine, and the seed runs as the migrate role in any case.
 */
async function seedDemoChanges(): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@keel.local" },
  });
  const ceo = await prisma.user.findUniqueOrThrow({
    where: { email: "ceo@keel.local" },
  });
  const cto = await prisma.user.findUniqueOrThrow({
    where: { email: "cto@keel.local" },
  });
  const dem9003 = await prisma.demand.findUniqueOrThrow({
    where: { ref: "DEM-9003" },
  });
  const inc9004 = await prisma.incident.findUniqueOrThrow({
    where: { ref: "INC-9004" },
  });

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  // CHG-9001 — a standalone draft: the RFC is written, nothing assessed yet.
  await prisma.change.upsert({
    where: { ref: "CHG-9001" },
    update: {},
    create: {
      ref: "CHG-9001",
      title: "Upgrade the Postgres minor version.",
      changeType: "NORMAL",
      rfc: "Move the managed Postgres instance to the latest minor release during a low-traffic window. No schema changes.",
      status: "DRAFT",
      ownerId: admin.id,
    },
  });

  // CHG-9002 — scheduled, MEDIUM risk, converted from DEM-9003, with a resolved
  // one-step standard approval and a change window a few days out.
  const chg9002 = await prisma.change.upsert({
    where: { ref: "CHG-9002" },
    update: {},
    create: {
      ref: "CHG-9002",
      title: "Add single sign-on to the client portal.",
      changeType: "NORMAL",
      rfc: "Add an OIDC provider to the client portal so guests sign in with their company account.",
      riskLevel: "MEDIUM",
      impactAssessment:
        "Touches the portal sign-in path for every guest; internal users are unaffected.",
      rollbackPlan:
        "Feature-flag the SSO button off and fall back to password sign-in.",
      status: "SCHEDULED",
      ownerId: admin.id,
      windowStart: new Date(now.getTime() + 3 * day),
      windowEnd: new Date(now.getTime() + 3 * day + 2 * 60 * 60 * 1000),
      originatingDemandId: dem9003.id,
    },
  });
  await prisma.demand.update({
    where: { id: dem9003.id },
    data: { status: "CONVERTED" },
  });
  await seedResolvedApproval(chg9002.id, admin.id, "change.standard", [
    {
      order: 1,
      requiredHat: "TECHNICAL_APPROVER",
      deciderId: cto.id,
      reason: "Rollback plan is sound and the blast radius is limited.",
    },
  ]);

  // CHG-9003 — closed, HIGH risk, with a resolved two-step high-risk approval, a
  // recorded post-implementation review, and a FIXES link to INC-9004.
  const chg9003 = await prisma.change.upsert({
    where: { ref: "CHG-9003" },
    update: {},
    create: {
      ref: "CHG-9003",
      title: "Fix the welcome-email template.",
      changeType: "NORMAL",
      rfc: "Correct the grammatical error in the welcome-email template and redeploy the mailer.",
      riskLevel: "HIGH",
      impactAssessment:
        "Every new guest receives this email; a bad template would reach all of them.",
      rollbackPlan: "Redeploy the previous mailer image.",
      status: "CLOSED",
      ownerId: admin.id,
      implementedAt: new Date(now.getTime() - 2 * day),
      closedAt: new Date(now.getTime() - day),
    },
  });
  await seedResolvedApproval(chg9003.id, admin.id, "change.high_risk", [
    {
      order: 1,
      requiredHat: "TECHNICAL_APPROVER",
      deciderId: cto.id,
      reason: "Template change only; the rollback is a one-line redeploy.",
    },
    {
      order: 2,
      requiredHat: "BUSINESS_APPROVER",
      deciderId: ceo.id,
      reason: "Customer-facing copy fix — worth doing promptly.",
    },
  ]);

  const priorPir = await prisma.postImplementationReview.findUnique({
    where: { changeId: chg9003.id },
  });
  if (!priorPir) {
    await prisma.postImplementationReview.create({
      data: {
        changeId: chg9003.id,
        valueRealized: "YES",
        lessons:
          "The template lint check would have caught this before release; it is now in CI.",
        reviewedById: ceo.id,
        reviewedAt: new Date(now.getTime() - day),
      },
    });
  }

  await prisma.changeIncidentLink.upsert({
    where: {
      changeId_incidentId_kind: {
        changeId: chg9003.id,
        incidentId: inc9004.id,
        kind: "FIXES",
      },
    },
    update: {},
    create: {
      changeId: chg9003.id,
      incidentId: inc9004.id,
      kind: "FIXES",
    },
  });

  console.log(
    "seeded demo: changes CHG-9001 (draft) / CHG-9002 (scheduled, from DEM-9003) / " +
      "CHG-9003 (closed, fixes INC-9004)",
  );
}

/**
 * Write a fully resolved (APPROVED) approval request for a demo change: the
 * request, its ordered steps (all APPROVED), and one APPROVED `ApprovalDecision`
 * per step. Guarded so a second seed run finds the existing request and does
 * nothing.
 */
async function seedResolvedApproval(
  changeId: string,
  createdById: string,
  policyKey: string,
  steps: {
    order: number;
    requiredHat: $Enums.Hat;
    deciderId: string;
    reason: string;
  }[],
): Promise<void> {
  const prior = await prisma.approvalRequest.findFirst({
    where: { subjectType: "change", subjectId: changeId },
  });
  if (prior) return;

  const resolvedAt = new Date();
  const request = await prisma.approvalRequest.create({
    data: {
      subjectType: "change",
      subjectId: changeId,
      policyKey,
      createdById,
      status: "APPROVED",
      resolvedAt,
      steps: {
        create: steps.map((s) => ({
          order: s.order,
          requiredHat: s.requiredHat,
          status: "APPROVED",
          resolvedAt,
        })),
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  for (const step of request.steps) {
    const spec = steps.find((s) => s.order === step.order);
    if (!spec) continue;
    await prisma.approvalDecision.create({
      data: {
        stepId: step.id,
        actorId: spec.deciderId,
        decision: "APPROVED",
        reason: spec.reason,
      },
    });
  }
}

main().finally(() => prisma.$disconnect());
