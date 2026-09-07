import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import type { PrismaTransaction } from "@/server/db/tx";
import {
  getApprovalState,
  recordDecision,
} from "@/server/modules/approval/service";
import {
  advanceChange,
  createChange,
  editChange,
  recordPir,
  scheduleChange,
  submitForApproval,
} from "@/server/modules/change/service";
import {
  convertDemand,
  getDemandForActor,
} from "@/server/modules/demand/service";
import type { Actor } from "@/server/policy/actor";
import { SegregationError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

/**
 * Spec 03 §10 — the whole change lifecycle end to end, at the service layer, on a
 * real disposable database. Not a unit test of any one function (those live in
 * `change/__tests__/service.test.ts` and `approval/__tests__/service.test.ts`) —
 * a regression anchor that the pieces plan-03 built compose: an approved demand
 * is converted → the owner assesses a HIGH-risk change → a two-step approval →
 * scheduled, implemented, reviewed, closed, audited and notified at every step,
 * the guest tracking it as "Delivered"; plus the segregation-of-duties
 * sub-case where the change owner is the only technical approver.
 */

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);
const tx = <T>(fn: (t: PrismaTransaction) => Promise<T>): Promise<T> =>
  ctx(() => db().$transaction((t) => fn(t as PrismaTransaction)));
const rand = () => Math.random().toString(16).slice(2);

const day = 24 * 60 * 60 * 1000;

async function currentStepId(changeId: string): Promise<string> {
  const state = await getApprovalState("change", changeId, db());
  if (!state.currentStep) throw new Error("no current approval step");
  return state.currentStep.id;
}

test("an approved demand is converted, assessed HIGH-risk, two-step approved, scheduled, implemented, reviewed and closed; the guest sees 'Delivered'; the owner-only-approver path needs an override", async () => {
  // --- seed: a client + guest submitter, the owner (DEVELOPER + technical
  //     approver), a separate technical approver, a separate business approver --
  const client = await db().client.create({
    data: { name: `Northwind-${rand()}`, isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: `guest-${rand()}@nw.example`,
      passwordHash: "x",
      displayName: "Guest",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const owner = await db().user.create({
    data: {
      email: `owner-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "Owner",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    },
  });
  const tech = await db().user.create({
    data: {
      email: `tech-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "Tech Approver",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });
  const business = await db().user.create({
    data: {
      email: `biz-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "Business Approver",
      kind: "INTERNAL",
      hats: ["BUSINESS_APPROVER"],
    },
  });

  const ownerActor: Actor = {
    id: owner.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    clientId: null,
  };
  const techActor: Actor = {
    id: tech.id,
    kind: "INTERNAL",
    hats: ["TECHNICAL_APPROVER"],
    clientId: null,
  };
  const businessActor: Actor = {
    id: business.id,
    kind: "INTERNAL",
    hats: ["BUSINESS_APPROVER"],
    clientId: null,
  };
  const guestActor: Actor = {
    id: guest.id,
    kind: "GUEST",
    hats: [],
    clientId: client.id,
  };

  // --- 1. an APPROVED / PURSUE demand, submitted by the guest --------------
  const demand = await db().demand.create({
    data: {
      ref: `DEM-${rand()}`,
      title: "Single sign-on for the client portal",
      problem: "Users want to sign in with their company account.",
      source: "CLIENT",
      status: "APPROVED",
      submittedById: guest.id,
      clientId: client.id,
      decidedAt: new Date(),
      worth: {
        create: {
          businessValue: "Removes the top onboarding blocker.",
          valueScore: 8,
          effort: "S",
          costOfDelay: "Each month of delay risks an account churning.",
          decision: "PURSUE",
        },
      },
    },
  });

  // --- 2. convert the demand → a change linked to it ----------------------
  const { changeId } = await tx((t) => convertDemand(ownerActor, t, demand.id));

  const converted = await db().demand.findUniqueOrThrow({
    where: { id: demand.id },
  });
  expect(converted.status).toBe("CONVERTED");

  let change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("DRAFT");
  expect(change.originatingDemandId).toBe(demand.id);
  expect(change.ownerId).toBe(owner.id);
  expect(
    await db().auditEvent.findMany({
      where: { action: "demand.converted", subjectId: demand.id },
    }),
  ).toHaveLength(1);

  // --- 3. the owner assesses it: RFC, HIGH risk, impact, rollback plan ----
  await tx((t) =>
    editChange(ownerActor, t, changeId, {
      rfc: "Add an OIDC provider to the portal; guests sign in with their company account.",
      riskLevel: "HIGH",
      impactAssessment: "Touches the sign-in path for every guest.",
      rollbackPlan: "Feature-flag SSO off and fall back to password sign-in.",
    }),
  );

  const editActions = (
    await db().auditEvent.findMany({ where: { subjectId: changeId } })
  ).map((a) => a.action);
  expect(editActions).toEqual(
    expect.arrayContaining([
      "change.edited",
      "change.risk_assessed",
      "change.rollback_plan_set",
    ]),
  );

  // --- 4. DRAFT → ASSESSING (RFC + demand link gate) ---------------------
  await tx((t) => advanceChange(ownerActor, t, changeId, { from: "DRAFT" }));
  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("ASSESSING");
  expect(
    (
      await db().auditEvent.findFirstOrThrow({
        where: { action: "change.advanced", subjectId: changeId },
      })
    ).payload,
  ).toMatchObject({ from: "DRAFT", to: "ASSESSING" });

  // --- 5. submit for approval → a 2-step TECHNICAL-then-BUSINESS request --
  await tx((t) => submitForApproval(ownerActor, t, changeId));

  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("APPROVAL");

  const request = await db().approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: changeId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  expect(request.policyKey).toBe("change.high_risk");
  expect(request.createdById).toBe(owner.id);
  expect(request.steps.map((s) => [s.order, s.requiredHat])).toEqual([
    [1, "TECHNICAL_APPROVER"],
    [2, "BUSINESS_APPROVER"],
  ]);
  expect(
    await db().auditEvent.findMany({
      where: { action: "change.submitted_for_approval", subjectId: changeId },
    }),
  ).toHaveLength(1);
  const step1Notes = await db().notification.findMany({
    where: { subjectId: changeId, kind: "APPROVAL_NEEDED" },
  });
  expect(step1Notes.map((n) => n.userId)).toContain(tech.id);
  expect(step1Notes.map((n) => n.userId)).not.toContain(owner.id);

  // --- 6. the technical approver (not the owner) approves step 1 ---------
  const step1Id = await currentStepId(changeId);
  const priorApprovalNotes = (
    await db().notification.findMany({
      where: { subjectId: changeId, kind: "APPROVAL_NEEDED" },
      select: { id: true },
    })
  ).map((n) => n.id);

  const afterStep1 = await tx((t) =>
    recordDecision(t, {
      stepId: step1Id,
      actor: techActor,
      decision: "APPROVED",
      reason: "Rollback plan is sound; the OIDC integration is well scoped.",
    }),
  );
  expect(afterStep1.requestStatus).toBe("PENDING");

  const step2Notes = await db().notification.findMany({
    where: {
      subjectId: changeId,
      kind: "APPROVAL_NEEDED",
      id: { notIn: priorApprovalNotes },
    },
  });
  expect(step2Notes.map((n) => n.userId)).toContain(business.id);

  // --- 7. the business approver approves step 2 → request APPROVED ------
  const step2Id = await currentStepId(changeId);
  expect(step2Id).not.toBe(step1Id);
  const afterStep2 = await tx((t) =>
    recordDecision(t, {
      stepId: step2Id,
      actor: businessActor,
      decision: "APPROVED",
      reason: "Clear onboarding value; proceed.",
    }),
  );
  expect(afterStep2.requestStatus).toBe("APPROVED");
  expect(
    await db().auditEvent.findMany({
      where: {
        action: "approval.request_resolved",
        subjectType: "ApprovalRequest",
        subjectId: request.id,
      },
    }),
  ).toHaveLength(1);
  expect(
    await db().notification.count({
      where: {
        subjectId: changeId,
        kind: "STATUS_CHANGED",
        userId: owner.id,
      },
    }),
  ).toBeGreaterThanOrEqual(1);

  // --- 8. schedule a future window → APPROVAL → SCHEDULED --------------
  const windowStart = new Date(Date.now() + 3 * day);
  const windowEnd = new Date(windowStart.getTime() + 2 * 60 * 60 * 1000);
  await tx((t) =>
    scheduleChange(ownerActor, t, changeId, { windowStart, windowEnd }),
  );
  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("SCHEDULED");
  expect(
    await db().auditEvent.findMany({
      where: { action: "change.scheduled", subjectId: changeId },
    }),
  ).toHaveLength(1);
  const advancedToScheduled = await db().auditEvent.findMany({
    where: { action: "change.advanced", subjectId: changeId },
  });
  expect(
    advancedToScheduled.some(
      (a) =>
        (a.payload as { from?: string; to?: string }).from === "APPROVAL" &&
        (a.payload as { to?: string }).to === "SCHEDULED",
    ),
  ).toBe(true);

  // --- 9. SCHEDULED → IMPLEMENTING, implementedAt set ------------------
  await tx((t) =>
    advanceChange(ownerActor, t, changeId, { from: "SCHEDULED" }),
  );
  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("IMPLEMENTING");
  expect(change.implementedAt).not.toBeNull();
  expect(
    await db().auditEvent.findMany({
      where: { action: "change.implementing", subjectId: changeId },
    }),
  ).toHaveLength(1);

  // --- 10. IMPLEMENTING → PIR (went-to-plan acknowledgement) ----------
  await tx((t) =>
    advanceChange(ownerActor, t, changeId, {
      from: "IMPLEMENTING",
      acknowledgements: { wentToPlanAcknowledged: true },
    }),
  );
  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("PIR");

  // --- 11. record the post-implementation review --------------------
  await tx((t) =>
    recordPir(ownerActor, t, changeId, {
      valueRealized: "YES",
      lessons: "The OIDC rollout went smoothly; document the provider config.",
    }),
  );
  const pir = await db().postImplementationReview.findFirstOrThrow({
    where: { changeId },
  });
  expect(pir.valueRealized).toBe("YES");
  expect(
    await db().auditEvent.findMany({
      where: { action: "change.pir_recorded", subjectId: changeId },
    }),
  ).toHaveLength(1);

  // --- 12. PIR → CLOSED; the demand's submitter is told it was delivered
  await tx((t) => advanceChange(ownerActor, t, changeId, { from: "PIR" }));
  change = await db().change.findUniqueOrThrow({ where: { id: changeId } });
  expect(change.status).toBe("CLOSED");
  expect(change.closedAt).not.toBeNull();
  expect(
    await db().auditEvent.findMany({
      where: { action: "change.closed", subjectId: changeId },
    }),
  ).toHaveLength(1);
  const deliveredNote = await db().notification.findFirstOrThrow({
    where: {
      userId: guest.id,
      subjectType: "demand",
      subjectId: demand.id,
      kind: "STATUS_CHANGED",
    },
  });
  expect((deliveredNote.payload as { summary: string }).summary).toBe(
    "Your request has been delivered",
  );

  // --- 13. the guest tracks the demand as "Delivered" -----------------
  const guestView = await getDemandForActor(guestActor, demand.id, db());
  expect(guestView.status).toBe("Delivered");

  // --- 14. segregation of duties: the owner is the only technical approver
  const { id: soloId } = await tx((t) =>
    createChange(ownerActor, t, {
      title: "Rotate the API signing key",
      rfc: "Rotate the signing key and redeploy the API.",
    }),
  );
  await tx((t) =>
    editChange(ownerActor, t, soloId, {
      riskLevel: "LOW",
      impactAssessment: "Brief token-verification blip during the redeploy.",
      rollbackPlan: "Re-deploy with the previous key.",
    }),
  );
  await tx((t) =>
    advanceChange(ownerActor, t, soloId, {
      from: "DRAFT",
      acknowledgements: { standaloneConfirmed: true },
    }),
  );
  await tx((t) => submitForApproval(ownerActor, t, soloId));

  const soloStepId = await currentStepId(soloId);

  // Without a justification the creator cannot approve their own request.
  await expect(
    tx((t) =>
      recordDecision(t, {
        stepId: soloStepId,
        actor: ownerActor,
        decision: "APPROVED",
        reason: "self",
      }),
    ),
  ).rejects.toMatchObject({
    overrideAction: "change.approve.technical.override",
  });
  await expect(
    tx((t) =>
      recordDecision(t, {
        stepId: soloStepId,
        actor: ownerActor,
        decision: "APPROVED",
        reason: "self",
      }),
    ),
  ).rejects.toBeInstanceOf(SegregationError);

  // With a >= 20-char justification it goes through as a flagged override.
  const soloRequest = await db().approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: soloId },
  });
  const justification = "I am the only technical approver available this week.";
  const soloResult = await tx((t) =>
    recordDecision(t, {
      stepId: soloStepId,
      actor: ownerActor,
      decision: "APPROVED",
      reason: "Self-approved with justification.",
      overrideJustification: justification,
    }),
  );
  expect(soloResult.requestStatus).toBe("APPROVED");

  const soloDecision = await db().approvalDecision.findFirstOrThrow({
    where: { stepId: soloStepId },
  });
  expect(soloDecision.isSingleApproverOverride).toBe(true);
  expect(soloDecision.overrideJustification).toBe(justification);

  const soloActions = (
    await db().auditEvent.findMany({
      where: { subjectType: "ApprovalRequest", subjectId: soloRequest.id },
    })
  ).map((a) => a.action);
  expect(soloActions).toEqual(
    expect.arrayContaining(["approval.override", "approval.step_approved"]),
  );
});
