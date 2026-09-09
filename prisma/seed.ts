import { pathToFileURL } from "node:url";
import type { $Enums, Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";

const prisma = new PrismaClient();

export async function main() {
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

  // Dev-only display fixtures — two client guests and demands/incidents/
  // changes spanning every lifecycle status, so `/portal/demands`, the
  // internal register, and the board all have something real to render on a
  // fresh database. Never in production.
  if (process.env.NODE_ENV !== "production") {
    await seedDemoDemands();
    await seedDemoIncidents();
    await seedDemoChanges();
    await seedDemoNotifications();
  }
}

/**
 * Demo demands for the definition-of-done walkthrough (plan-01 Task 10),
 * extended by plan-05 Task 4 for full spec §6 coverage (a second client +
 * guest, and every `DemandStatus` value represented).
 *
 * Composes with `main()`'s seed — it looks the existing "Northwind Traders"
 * client up by its unique name rather than creating a second one, and creates
 * the second client ("Acme Retail") here. Everything is `upsert`ed on a
 * unique key (user email, client name, demand `ref`, worth `demandId`) so a
 * second run is a no-op. The fixed refs `DEM-9001..9007` sit far above the
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

  // Second client (spec §6: "Clients: ... Northwind Traders, Acme Retail; one
  // guest each"), mirroring the Northwind client/guest pattern exactly.
  const acme = await prisma.client.upsert({
    where: { name: "Acme Retail" },
    update: {},
    create: { name: "Acme Retail", isActive: true },
  });
  const acmeGuest = await prisma.user.upsert({
    where: { email: "guest@acme.example" },
    update: {},
    create: {
      email: "guest@acme.example",
      passwordHash: guestHash,
      displayName: "Priya (Acme Retail)",
      kind: "GUEST",
      hats: [],
      clientId: acme.id,
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
      hats: ["DEVELOPER", "REVIEWER", "BUSINESS_APPROVER"],
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
      hats: ["DEVELOPER", "REVIEWER", "TECHNICAL_APPROVER"],
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

  // DEM-9004 — submitted by the Acme Retail guest (spec §6: "one raised by
  // each client guest").
  await prisma.demand.upsert({
    where: { ref: "DEM-9004" },
    update: {},
    create: {
      ref: "DEM-9004",
      title: "Branch-level sales dashboard",
      problem: "Store managers can't see sales broken down by branch.",
      source: "CLIENT",
      status: "SUBMITTED",
      submittedById: acmeGuest.id,
      clientId: acme.id,
    },
  });

  // DEM-9005 — worth assessed (value + effort scored) but no decision yet.
  // Closes DemandStatus coverage (spec §6: "at least one in each
  // DemandStatus") — WORTH_ASSESSED wasn't otherwise represented.
  const dem9005 = await prisma.demand.upsert({
    where: { ref: "DEM-9005" },
    update: {},
    create: {
      ref: "DEM-9005",
      title: "Configurable invoice due dates",
      problem: "Clients want to set their own invoice due date per contract.",
      source: "CLIENT",
      status: "WORTH_ASSESSED",
      submittedById: guest.id,
      clientId: northwind.id,
    },
  });
  await prisma.worthAssessment.upsert({
    where: { demandId: dem9005.id },
    update: {},
    create: {
      demandId: dem9005.id,
      businessValue: "Reduces billing disputes for clients on custom terms.",
      valueScore: 4,
      valueScoredById: ceo.id,
      effort: "M",
      feasibility: "Needs a new field on the client billing profile.",
      effortScoredById: cto.id,
      // decision deliberately left null — assessed but not yet decided.
    },
  });

  // DEM-9006 — approved (PURSUE) and not yet converted, so APPROVED itself is
  // represented in the final data (DEM-9003 leaves APPROVED for CONVERTED
  // once seedDemoChanges converts it).
  const dem9006 = await prisma.demand.upsert({
    where: { ref: "DEM-9006" },
    update: {},
    create: {
      ref: "DEM-9006",
      title: "Two-factor authentication for guests",
      problem: "Guests want an extra layer of security on their accounts.",
      source: "CLIENT",
      status: "APPROVED",
      submittedById: guest.id,
      clientId: northwind.id,
      decidedAt: new Date(),
    },
  });
  await prisma.worthAssessment.upsert({
    where: { demandId: dem9006.id },
    update: {},
    create: {
      demandId: dem9006.id,
      businessValue:
        "Addresses a recurring security ask from enterprise clients.",
      valueScore: 6,
      valueScoredById: ceo.id,
      effort: "M",
      feasibility: "Standard TOTP flow; no new infra.",
      effortScoredById: cto.id,
      costOfDelay: "Low — no active incident, but a recurring sales objection.",
      decision: "PURSUE",
      decidedById: cto.id,
    },
  });

  // DEM-9007 — rejected (DROP decision), with a rejection reason recorded.
  const dem9007 = await prisma.demand.upsert({
    where: { ref: "DEM-9007" },
    update: {},
    create: {
      ref: "DEM-9007",
      title: "Custom report builder",
      problem: "Clients want to build arbitrary reports from raw data.",
      source: "CLIENT",
      status: "REJECTED",
      submittedById: guest.id,
      clientId: northwind.id,
      rejectionReason: "Out of scope for v1; revisit after the export rework.",
      decidedAt: new Date(),
    },
  });
  await prisma.worthAssessment.upsert({
    where: { demandId: dem9007.id },
    update: {},
    create: {
      demandId: dem9007.id,
      businessValue: "Would help power users but few have asked for it.",
      valueScore: 2,
      valueScoredById: ceo.id,
      effort: "L",
      feasibility: "Would require a full query builder and permissions model.",
      effortScoredById: cto.id,
      costOfDelay: "None — no client has escalated this.",
      decision: "DROP",
      decidedById: cto.id,
    },
  });

  console.log(
    "seeded demo: guest@northwind.example / guest@acme.example " +
      "(Keel-guest-2026), ceo@keel.local, cto@keel.local, demands " +
      "DEM-9001 (submitted) / DEM-9002 (triaging) / DEM-9003 (approved -> " +
      "converted) / DEM-9004 (submitted, acme guest) / DEM-9005 (worth " +
      "assessed) / DEM-9006 (approved) / DEM-9007 (rejected)",
  );
}

/**
 * Demo incidents for the incident lifecycle walkthrough (plan-02 Task 11),
 * extended by plan-05 Task 4 with a `CLOSED` row for full `IncidentStatus`
 * coverage.
 *
 * Composes with `main()`'s seed — it looks up the existing "Northwind Traders"
 * client and existing users (guest@northwind.example, cto@keel.local) by their
 * unique keys rather than creating duplicates. Everything is `upsert`ed on a
 * unique key (incident `ref`) so a second run is a no-op. The fixed refs
 * `INC-9001..9005` sit far above the `Counter`-allocated `INC-0001..N` range,
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

  // INC-9005 — closed after resolution. Closes IncidentStatus coverage
  // (spec §6: "one in each IncidentStatus") — CLOSED wasn't otherwise
  // represented (INC-9004 stops at RESOLVED).
  await prisma.incident.upsert({
    where: { ref: "INC-9005" },
    update: {},
    create: {
      ref: "INC-9005",
      title: "Guest password reset email delayed.",
      description: "Password reset emails took over an hour to arrive.",
      affectedService: "Email",
      impact: "LOW",
      urgency: "LOW",
      priority: "P4",
      status: "CLOSED",
      reportedById: guest.id,
      clientId: northwind.id,
      assigneeId: cto.id,
      dueAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      overdue: false,
      resolution: "Fixed a queue backlog in the mail worker.",
      resolvedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      closedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(
    "seeded demo: incidents INC-9001 (new) / INC-9002 (assigned) / " +
      "INC-9003 (in progress, overdue) / INC-9004 (resolved) / " +
      "INC-9005 (closed)",
  );
}

/**
 * Demo changes for the change + approvals walkthrough (plan-03 Task 14),
 * extended by plan-05 Task 4 with `CHG-9004..9008` so every `ChangeStatus`
 * value (incl. `ASSESSING`, `APPROVAL`, `IMPLEMENTING`, `PIR`, `ROLLED_BACK`)
 * is represented.
 *
 * Composes with `main()`'s seed — it looks up the existing internal users
 * (admin@keel.local, ceo@keel.local, cto@keel.local), the approved/pursued demand
 * (DEM-9003), and the resolved incident (INC-9004) by their unique keys rather
 * than creating duplicates. Everything is `upsert`ed on a unique key (change
 * `ref`), with the approval / PIR / incident-link rows guarded by a pre-check, so
 * a second run is a no-op. The fixed refs `CHG-9001..9008` sit far above the
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

  // CHG-9004..9008 close ChangeStatus coverage (spec §6: "one in each
  // ChangeStatus incl. ROLLED_BACK") — only DRAFT / SCHEDULED / CLOSED were
  // otherwise represented; ASSESSING, APPROVAL, IMPLEMENTING, PIR and
  // ROLLED_BACK were not.

  // CHG-9004 — past draft into assessing: the RFC is written, risk / impact /
  // rollback are still being worked out.
  await prisma.change.upsert({
    where: { ref: "CHG-9004" },
    update: {},
    create: {
      ref: "CHG-9004",
      title: "Add rate limiting to the public API.",
      changeType: "NORMAL",
      rfc: "Add a per-client rate limit to the public API so one client's traffic spike can't affect others.",
      status: "ASSESSING",
      ownerId: admin.id,
    },
  });

  // CHG-9005 — assessed and awaiting approval: a pending one-step approval
  // request sits open on it (no decision yet).
  const chg9005 = await prisma.change.upsert({
    where: { ref: "CHG-9005" },
    update: {},
    create: {
      ref: "CHG-9005",
      title: "Migrate file storage to the new bucket.",
      changeType: "NORMAL",
      rfc: "Move uploaded attachments to the new storage bucket ahead of the old one's retirement.",
      riskLevel: "MEDIUM",
      impactAssessment: "Uploads are briefly read-only during the cutover.",
      rollbackPlan:
        "Point reads back at the old bucket; it stays live for 30 days.",
      status: "APPROVAL",
      ownerId: admin.id,
    },
  });
  await seedPendingApproval(chg9005.id, admin.id, "change.standard", [
    { order: 1, requiredHat: "TECHNICAL_APPROVER" },
  ]);

  // CHG-9006 — inside its implementation window; not yet marked implemented.
  await prisma.change.upsert({
    where: { ref: "CHG-9006" },
    update: {},
    create: {
      ref: "CHG-9006",
      title: "Rotate the database credentials.",
      changeType: "NORMAL",
      rfc: "Rotate the Postgres service-account credentials on a scheduled maintenance window.",
      riskLevel: "LOW",
      impactAssessment:
        "Brief connection pool restart; no user-visible downtime expected.",
      rollbackPlan:
        "Re-apply the previous credential secret and restart the pool.",
      status: "IMPLEMENTING",
      ownerId: admin.id,
      windowStart: new Date(now.getTime() - 30 * 60 * 1000),
      windowEnd: new Date(now.getTime() + 30 * 60 * 1000),
    },
  });

  // CHG-9007 — implemented, awaiting its post-implementation review.
  await prisma.change.upsert({
    where: { ref: "CHG-9007" },
    update: {},
    create: {
      ref: "CHG-9007",
      title: "Increase the API request timeout.",
      changeType: "NORMAL",
      rfc: "Raise the API gateway's request timeout from 10s to 30s for the bulk export endpoint.",
      riskLevel: "LOW",
      impactAssessment:
        "Only affects the bulk export endpoint; no other routes change.",
      rollbackPlan: "Revert the gateway config to the previous timeout value.",
      status: "PIR",
      ownerId: admin.id,
      implementedAt: new Date(now.getTime() - day),
    },
  });

  // CHG-9008 — implemented, then rolled back.
  await prisma.change.upsert({
    where: { ref: "CHG-9008" },
    update: {},
    create: {
      ref: "CHG-9008",
      title: "Switch the search index to the new provider.",
      changeType: "NORMAL",
      rfc: "Cut search traffic over to the new hosted search provider.",
      riskLevel: "HIGH",
      impactAssessment:
        "All search queries route through the new provider once cut over.",
      rollbackPlan: "Flip the search-provider flag back to the legacy index.",
      status: "ROLLED_BACK",
      ownerId: admin.id,
      implementedAt: new Date(now.getTime() - 2 * day),
    },
  });

  console.log(
    "seeded demo: changes CHG-9001 (draft) / CHG-9002 (scheduled, from DEM-9003) / " +
      "CHG-9003 (closed, fixes INC-9004) / CHG-9004 (assessing) / " +
      "CHG-9005 (approval, pending) / CHG-9006 (implementing) / " +
      "CHG-9007 (pir) / CHG-9008 (rolled back)",
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

/**
 * Write an open (PENDING) approval request for a demo change — the request
 * and its ordered steps, left at their PENDING defaults with no decisions
 * yet, so the change's status can sit at APPROVAL. Guarded so a second seed
 * run finds the existing request and does nothing.
 */
async function seedPendingApproval(
  changeId: string,
  createdById: string,
  policyKey: string,
  steps: { order: number; requiredHat: $Enums.Hat }[],
): Promise<void> {
  const prior = await prisma.approvalRequest.findFirst({
    where: { subjectType: "change", subjectId: changeId },
  });
  if (prior) return;

  await prisma.approvalRequest.create({
    data: {
      subjectType: "change",
      subjectId: changeId,
      policyKey,
      createdById,
      steps: {
        create: steps.map((s) => ({
          order: s.order,
          requiredHat: s.requiredHat,
        })),
      },
    },
  });
}

/**
 * Demo notifications + one failed email for the notifications / dashboard
 * walkthrough (plan-04 Task 13).
 *
 * Composes with `main()`'s seed — it looks up the existing internal users
 * (admin@keel.local, ceo@keel.local, cto@keel.local), the demo guest
 * (guest@northwind.example), and the demo demand / incident / change rows by
 * their unique keys rather than creating duplicates. The `payload` shape matches
 * what `emitNotification` writes — `{ summary, subjectType, subjectId }` — so the
 * bell menu and `/notifications` page's `serializeNotification` read it cleanly.
 *
 * Idempotent via a count guard: if `admin` already holds any notification the
 * whole function is a no-op, so `pnpm prisma db seed` is safe to run twice. The
 * single FAILED `EmailOutbox` row — content for the dashboard's email-delivery
 * panel — sits under the same guard.
 *
 * These rows are written directly, outside `runWithContext` — they carry no
 * `AuditEvent` and fire no real delivery. They are display fixtures.
 */
async function seedDemoNotifications(): Promise<void> {
  const [admin, ceo, cto, guest] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "admin@keel.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "ceo@keel.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "cto@keel.local" } }),
    prisma.user.findUniqueOrThrow({
      where: { email: "guest@northwind.example" },
    }),
  ]);

  if ((await prisma.notification.count({ where: { userId: admin.id } })) > 0) {
    console.log("  demo notifications already present, skipping");
    return;
  }

  const [dem9001, dem9002, dem9003] = await Promise.all([
    prisma.demand.findUniqueOrThrow({ where: { ref: "DEM-9001" } }),
    prisma.demand.findUniqueOrThrow({ where: { ref: "DEM-9002" } }),
    prisma.demand.findUniqueOrThrow({ where: { ref: "DEM-9003" } }),
  ]);
  const [inc9001, inc9002, inc9003] = await Promise.all([
    prisma.incident.findUniqueOrThrow({ where: { ref: "INC-9001" } }),
    prisma.incident.findUniqueOrThrow({ where: { ref: "INC-9002" } }),
    prisma.incident.findUniqueOrThrow({ where: { ref: "INC-9003" } }),
  ]);
  const [chg9002, chg9003] = await Promise.all([
    prisma.change.findUniqueOrThrow({ where: { ref: "CHG-9002" } }),
    prisma.change.findUniqueOrThrow({ where: { ref: "CHG-9003" } }),
  ]);

  const now = Date.now();
  const hour = 60 * 60 * 1000;

  type Seed = {
    userId: string;
    kind: $Enums.NotificationKind;
    subjectType: string;
    subjectId: string;
    summary: string;
    read: boolean;
    ageHours: number;
  };

  // A spread across all five NotificationKind values, some read some unread,
  // pointing at the demo DEM-9001..3 / INC-9001..3 / CHG-9002..3 rows.
  const seeds: Seed[] = [
    {
      userId: admin.id,
      kind: "ASSIGNED",
      subjectType: "incident",
      subjectId: inc9003.id,
      summary:
        "INC-9003 assigned to you: Portal is returning 500 for all users.",
      read: false,
      ageHours: 1,
    },
    {
      userId: admin.id,
      kind: "OVERDUE",
      subjectType: "incident",
      subjectId: inc9003.id,
      summary: "INC-9003 is past its SLA due time.",
      read: false,
      ageHours: 2,
    },
    {
      userId: admin.id,
      kind: "APPROVAL_NEEDED",
      subjectType: "change",
      subjectId: chg9002.id,
      summary:
        "CHG-9002 needs your approval: Add single sign-on to the client portal.",
      read: false,
      ageHours: 5,
    },
    {
      userId: admin.id,
      kind: "STATUS_CHANGED",
      subjectType: "demand",
      subjectId: dem9003.id,
      summary: "DEM-9003 was approved: Single sign-on for the client portal.",
      read: true,
      ageHours: 30,
    },
    {
      userId: admin.id,
      kind: "COMMENTED",
      subjectType: "incident",
      subjectId: inc9002.id,
      summary: "New comment on INC-9002: Invoices export as an empty file.",
      read: true,
      ageHours: 48,
    },
    {
      userId: ceo.id,
      kind: "APPROVAL_NEEDED",
      subjectType: "change",
      subjectId: chg9003.id,
      summary: "CHG-9003 needs your approval: Fix the welcome-email template.",
      read: true,
      ageHours: 40,
    },
    {
      userId: ceo.id,
      kind: "STATUS_CHANGED",
      subjectType: "demand",
      subjectId: dem9002.id,
      summary: "DEM-9002 entered triage: Bulk invoice download.",
      read: false,
      ageHours: 6,
    },
    {
      userId: cto.id,
      kind: "ASSIGNED",
      subjectType: "incident",
      subjectId: inc9002.id,
      summary: "INC-9002 assigned to you: Invoices export as an empty file.",
      read: false,
      ageHours: 3,
    },
    {
      userId: cto.id,
      kind: "STATUS_CHANGED",
      subjectType: "change",
      subjectId: chg9002.id,
      summary:
        "CHG-9002 is now scheduled: Add single sign-on to the client portal.",
      read: true,
      ageHours: 26,
    },
    {
      userId: guest.id,
      kind: "STATUS_CHANGED",
      subjectType: "demand",
      subjectId: dem9001.id,
      summary: "Your request DEM-9001 is being reviewed by the Keel team.",
      read: false,
      ageHours: 4,
    },
    {
      userId: guest.id,
      kind: "COMMENTED",
      subjectType: "incident",
      subjectId: inc9001.id,
      summary:
        "The Keel team replied on INC-9001: Login page slow after the last release.",
      read: true,
      ageHours: 20,
    },
  ];

  await prisma.notification.createMany({
    data: seeds.map((s) => ({
      userId: s.userId,
      kind: s.kind,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      payload: {
        summary: s.summary,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
      } as Prisma.InputJsonObject,
      createdAt: new Date(now - s.ageHours * hour),
      readAt: s.read
        ? new Date(now - s.ageHours * hour + 10 * 60 * 1000)
        : null,
    })),
  });

  // One FAILED delivery so the dashboard's email-delivery panel has content.
  await prisma.emailOutbox.create({
    data: {
      toEmail: "guest@northwind.example",
      template: "demand_decided",
      payload: { ref: "DEM-9002", status: "TRIAGING" },
      status: "FAILED",
      attempts: 6,
      lastError: "SMTP 550 5.1.1: recipient address rejected: user unknown",
    },
  });

  // One SENT delivery alongside it (spec §6: "a couple of EmailOutbox rows
  // (SENT and one FAILED)").
  await prisma.emailOutbox.create({
    data: {
      toEmail: "guest@northwind.example",
      template: "demand_decided",
      payload: { ref: "DEM-9003", status: "APPROVED" },
      status: "SENT",
      attempts: 1,
      sentAt: new Date(),
    },
  });

  console.log(
    `seeded demo: ${seeds.length} notifications (admin/ceo/cto/guest, all ` +
      "five kinds, some unread) + 1 failed + 1 sent EmailOutbox row",
  );
}

// Only auto-run when this file is the process entry point (`pnpm seed` /
// `tsx prisma/seed.ts`) -- not when a test dynamically imports it to call
// `main()` directly against a disposable test database (see
// `prisma/__tests__/seed-idempotent.test.ts`). ESM has no `require.main ===
// module`; comparing the entry point's path to this module's own URL is the
// equivalent check.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().finally(() => prisma.$disconnect());
}
