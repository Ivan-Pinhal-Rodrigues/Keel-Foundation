import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  cancelRequest,
  getApprovalState,
  openApprovalRequest,
  type OpenApprovalInput,
  recordDecision,
} from "@/server/modules/approval/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { ConflictError, ForbiddenError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);

const rand = () => Math.random().toString(16).slice(2);

async function seedInternal(hats: Hat[] = []): Promise<{ id: string }> {
  const user = await db().user.create({
    data: {
      email: `i-${rand()}@k`,
      passwordHash: "x",
      displayName: "I",
      kind: "INTERNAL",
      hats,
    },
  });
  return { id: user.id };
}

async function seedActor(hats: Hat[] = []): Promise<Actor> {
  const { id } = await seedInternal(hats);
  return { id, kind: "INTERNAL", hats, clientId: null };
}

/** A 1-step standard request: a single TECHNICAL_APPROVER step. */
function standardInput(
  createdById: string,
  subjectId: string,
): OpenApprovalInput {
  return {
    subjectType: "change",
    subjectId,
    createdById,
    policyKey: "change.standard",
    steps: [{ order: 1, requiredHat: "TECHNICAL_APPROVER" }],
  };
}

const open = (input: OpenApprovalInput) =>
  ctx(() => db().$transaction((tx) => openApprovalRequest(tx, input)));

const decide = (input: Parameters<typeof recordDecision>[1]) =>
  ctx(() => db().$transaction((tx) => recordDecision(tx, input)));

async function currentStepId(subjectId: string): Promise<string> {
  const state = await getApprovalState("change", subjectId, db());
  if (!state.currentStep) throw new Error("no current step");
  return state.currentStep.id;
}

/** A 2-step high-risk request: TECHNICAL_APPROVER then BUSINESS_APPROVER. */
function highRiskInput(
  createdById: string,
  subjectId: string,
): OpenApprovalInput {
  return {
    subjectType: "change",
    subjectId,
    createdById,
    policyKey: "change.high_risk",
    steps: [
      { order: 1, requiredHat: "TECHNICAL_APPROVER" },
      { order: 2, requiredHat: "BUSINESS_APPROVER" },
    ],
  };
}

test("openApprovalRequest creates a PENDING request with ordered steps and audits approval.request_opened; notifies holders of step 1's hat, excluding the creator", async () => {
  const owner = await seedInternal(["TECHNICAL_APPROVER"]);
  const otherTech = await seedInternal(["TECHNICAL_APPROVER"]);
  const business = await seedInternal(["BUSINESS_APPROVER"]);
  const subjectId = rand();

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      openApprovalRequest(tx, highRiskInput(owner.id, subjectId)),
    ),
  );

  const request = await db().approvalRequest.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  expect(request.status).toBe("PENDING");
  expect(request.policyKey).toBe("change.high_risk");
  expect(request.createdById).toBe(owner.id);
  expect(request.steps).toHaveLength(2);
  expect(request.steps.map((s) => [s.order, s.requiredHat, s.status])).toEqual([
    [1, "TECHNICAL_APPROVER", "PENDING"],
    [2, "BUSINESS_APPROVER", "PENDING"],
  ]);

  const audit = await db().auditEvent.findMany({
    where: { action: "approval.request_opened", subjectId: id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    policyKey: "change.high_risk",
    subjectType: "change",
    subjectId,
    stepHats: ["TECHNICAL_APPROVER", "BUSINESS_APPROVER"],
  });

  const notes = await db().notification.findMany({
    where: { subjectId, kind: "APPROVAL_NEEDED" },
  });
  expect(notes.map((n) => n.userId)).toEqual([otherTech.id]);
  expect(notes.map((n) => n.userId)).not.toContain(owner.id);
  expect(notes.map((n) => n.userId)).not.toContain(business.id);
});

test("getApprovalState returns the latest request with per-step decisions and the current step", async () => {
  const owner = await seedInternal(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      openApprovalRequest(tx, highRiskInput(owner.id, subjectId)),
    ),
  );

  const state = await getApprovalState("change", subjectId, db());
  expect(state.requestId).toBe(id);
  expect(state.status).toBe("PENDING");
  expect(state.policyKey).toBe("change.high_risk");
  expect(state.createdById).toBe(owner.id);
  expect(state.steps).toHaveLength(2);
  expect(state.steps[0]!.decision).toBeNull();
  expect(state.steps[1]!.decision).toBeNull();
  expect(state.currentStep).toEqual({
    id: state.steps[0]!.id,
    requiredHat: "TECHNICAL_APPROVER",
  });
});

test("getApprovalState returns { status: null } for a subject with no request", async () => {
  const state = await getApprovalState("change", rand(), db());
  expect(state).toEqual({
    requestId: null,
    status: null,
    policyKey: null,
    createdById: null,
    steps: [],
    currentStep: null,
  });
});

test("cancelRequest on a PENDING request → CANCELLED, PENDING steps SKIPPED, approval.request_cancelled audited", async () => {
  const owner = await seedInternal(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      openApprovalRequest(tx, highRiskInput(owner.id, subjectId)),
    ),
  );

  await ctx(() =>
    db().$transaction((tx) =>
      cancelRequest(tx, {
        subjectType: "change",
        subjectId,
        reason: "superseded by a new plan",
        actorId: owner.id,
      }),
    ),
  );

  const request = await db().approvalRequest.findUniqueOrThrow({
    where: { id },
    include: { steps: true },
  });
  expect(request.status).toBe("CANCELLED");
  expect(request.resolvedAt).not.toBeNull();
  expect(request.steps.every((s) => s.status === "SKIPPED")).toBe(true);
  expect(request.steps.every((s) => s.resolvedAt !== null)).toBe(true);

  const audit = await db().auditEvent.findMany({
    where: { action: "approval.request_cancelled", subjectId: id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    reason: "superseded by a new plan",
  });
});

test("cancelRequest is a no-op when there is no pending request", async () => {
  const owner = await seedInternal(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await ctx(() =>
    db().$transaction((tx) =>
      cancelRequest(tx, {
        subjectType: "change",
        subjectId,
        reason: "nothing to cancel",
        actorId: owner.id,
      }),
    ),
  );

  expect(
    await db().approvalRequest.count({
      where: { subjectType: "change", subjectId },
    }),
  ).toBe(0);
  expect(
    await db().auditEvent.count({
      where: { action: "approval.request_cancelled", actorId: owner.id },
    }),
  ).toBe(0);
});

test("a re-opened request is a fresh row; getApprovalState returns the newer one; the old request is untouched", async () => {
  const owner = await seedInternal(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  const first = await ctx(() =>
    db().$transaction((tx) =>
      openApprovalRequest(tx, highRiskInput(owner.id, subjectId)),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      cancelRequest(tx, {
        subjectType: "change",
        subjectId,
        reason: "re-plan",
        actorId: owner.id,
      }),
    ),
  );
  const second = await ctx(() =>
    db().$transaction((tx) =>
      openApprovalRequest(tx, highRiskInput(owner.id, subjectId)),
    ),
  );

  expect(second.id).not.toBe(first.id);
  expect(
    await db().approvalRequest.count({
      where: { subjectType: "change", subjectId },
    }),
  ).toBe(2);

  const state = await getApprovalState("change", subjectId, db());
  expect(state.requestId).toBe(second.id);
  expect(state.status).toBe("PENDING");

  const old = await db().approvalRequest.findUniqueOrThrow({
    where: { id: first.id },
  });
  expect(old.status).toBe("CANCELLED");
});

test("1-step request: one APPROVED decision resolves the request APPROVED", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  const { id } = await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  const result = await decide({
    stepId,
    actor: tech,
    decision: "APPROVED",
    reason: "looks good",
  });
  expect(result).toEqual({ requestStatus: "APPROVED" });

  const request = await db().approvalRequest.findUniqueOrThrow({
    where: { id },
    include: { steps: true },
  });
  expect(request.status).toBe("APPROVED");
  expect(request.resolvedAt).not.toBeNull();
  expect(request.steps[0]!.status).toBe("APPROVED");
  expect(request.steps[0]!.resolvedAt).not.toBeNull();

  const audit = await db().auditEvent.findMany({
    where: { subjectType: "ApprovalRequest", subjectId: id },
  });
  const actions = audit.map((a) => a.action);
  expect(actions).toContain("approval.step_approved");
  expect(actions).toContain("approval.request_resolved");

  const notes = await db().notification.findMany({
    where: { subjectId, kind: "STATUS_CHANGED" },
  });
  expect(notes.map((n) => n.userId)).toEqual([owner.id]);
  // The notification is keyed on the change, not the ApprovalRequest, so a
  // subject-keyed feed and the deep-link match `openApprovalRequest`.
  expect(notes[0]!.subjectType).toBe("change");
  expect(notes[0]!.subjectId).toBe(subjectId);
});

test("2-step high_risk: needs both; step 1 approval notifies the business approver; step 2 approval resolves it", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const business = await seedActor(["BUSINESS_APPROVER"]);
  const subjectId = rand();

  const { id } = await open(highRiskInput(owner.id, subjectId));

  const step1 = await currentStepId(subjectId);
  // Notifications are keyed on the change, so the step-1 `openApprovalRequest`
  // APPROVAL_NEEDED is already on this subject — snapshot it out.
  const preIds = (
    await db().notification.findMany({
      where: { subjectId, kind: "APPROVAL_NEEDED" },
      select: { id: true },
    })
  ).map((n) => n.id);

  const first = await decide({
    stepId: step1,
    actor: tech,
    decision: "APPROVED",
    reason: "tech ok",
  });
  expect(first).toEqual({ requestStatus: "PENDING" });

  const notes = await db().notification.findMany({
    where: { subjectId, kind: "APPROVAL_NEEDED", id: { notIn: preIds } },
  });
  expect(notes.map((n) => n.userId)).toContain(business.id);
  expect(notes.map((n) => n.userId)).not.toContain(owner.id);
  expect(notes.map((n) => n.userId)).not.toContain(tech.id);
  expect(notes[0]!.subjectType).toBe("change");

  const step2 = await currentStepId(subjectId);
  expect(step2).not.toBe(step1);
  const second = await decide({
    stepId: step2,
    actor: business,
    decision: "APPROVED",
    reason: "business ok",
  });
  expect(second).toEqual({ requestStatus: "APPROVED" });

  const request = await db().approvalRequest.findUniqueOrThrow({
    where: { id },
  });
  expect(request.status).toBe("APPROVED");
});

test("a rejection at step 1 resolves the request REJECTED and step 2 never becomes current", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  const { id } = await open(highRiskInput(owner.id, subjectId));
  const step1 = await currentStepId(subjectId);
  const step2Id = (
    await db().approvalStep.findFirstOrThrow({
      where: { requestId: id, order: 2 },
    })
  ).id;

  const result = await decide({
    stepId: step1,
    actor: tech,
    decision: "REJECTED",
    reason: "unsafe rollback plan",
  });
  expect(result).toEqual({ requestStatus: "REJECTED" });

  const request = await db().approvalRequest.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  expect(request.status).toBe("REJECTED");
  expect(request.steps[1]!.status).toBe("PENDING");

  const actions = (
    await db().auditEvent.findMany({
      where: { subjectType: "ApprovalRequest", subjectId: id },
    })
  ).map((a) => a.action);
  expect(actions).toContain("approval.step_rejected");
  expect(actions).toContain("approval.request_resolved");

  // Step 2 can never be decided — the request is no longer pending.
  await expect(
    decide({
      stepId: step2Id,
      actor: await seedActor(["BUSINESS_APPROVER"]),
      decision: "APPROVED",
      reason: "too late",
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("recording a decision on a non-current step → ConflictError", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const business = await seedActor(["BUSINESS_APPROVER"]);
  const subjectId = rand();

  const { id } = await open(highRiskInput(owner.id, subjectId));
  const step2Id = (
    await db().approvalStep.findFirstOrThrow({
      where: { requestId: id, order: 2 },
    })
  ).id;

  await expect(
    decide({
      stepId: step2Id,
      actor: business,
      decision: "APPROVED",
      reason: "jumping the queue",
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("recording a decision on an already-resolved request → ConflictError", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);
  await decide({ stepId, actor: tech, decision: "APPROVED", reason: "ok" });

  await expect(
    decide({ stepId, actor: tech, decision: "APPROVED", reason: "again" }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("an actor without the step's requiredHat → ForbiddenError", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const nobody = await seedActor(["DEVELOPER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  await expect(
    decide({ stepId, actor: nobody, decision: "APPROVED", reason: "no hat" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("the creator approving their own step without an override → SegregationError('change.approve.technical.override')", async () => {
  const owner = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  await expect(
    decide({ stepId, actor: owner, decision: "APPROVED", reason: "mine" }),
  ).rejects.toMatchObject({
    overrideAction: "change.approve.technical.override",
  });
});

test("the creator with a <20-char justification → still SegregationError (treated as no override)", async () => {
  const owner = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  await expect(
    decide({
      stepId,
      actor: owner,
      decision: "APPROVED",
      reason: "mine",
      overrideJustification: "too short",
    }),
  ).rejects.toMatchObject({
    overrideAction: "change.approve.technical.override",
  });
});

test("the creator with a >=20-char justification → decision recorded, isSingleApproverOverride true, approval.override AND approval.step_approved both audited, all internal users notified", async () => {
  const owner = await seedActor(["TECHNICAL_APPROVER"]);
  const other = await seedActor([]);
  const subjectId = rand();

  const { id } = await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  const justification = "I am the sole technical approver available this week";
  const result = await decide({
    stepId,
    actor: owner,
    decision: "APPROVED",
    reason: "self-approved",
    overrideJustification: justification,
  });
  expect(result).toEqual({ requestStatus: "APPROVED" });

  const decision = await db().approvalDecision.findFirstOrThrow({
    where: { stepId },
  });
  expect(decision.isSingleApproverOverride).toBe(true);
  expect(decision.overrideJustification).toBe(justification);

  const audit = await db().auditEvent.findMany({
    where: { subjectType: "ApprovalRequest", subjectId: id },
  });
  const byAction = new Map(audit.map((a) => [a.action, a]));
  expect(byAction.has("approval.step_approved")).toBe(true);
  expect(byAction.has("approval.request_resolved")).toBe(true);
  expect(byAction.get("approval.override")!.payload).toMatchObject({
    stepOrder: 1,
    justification,
    createdById: owner.id,
    actorId: owner.id,
  });

  // The override transparency notice fans out to every other internal user.
  const overrideNotes = await db().notification.findMany({
    where: { subjectId, kind: "STATUS_CHANGED" },
  });
  const recipients = overrideNotes.map((n) => n.userId);
  expect(recipients).toContain(other.id);
  // The actor is never notified of the override they used. (The creator — here
  // the same person — still gets the separate "request resolved" notice.)
  const overrideOnly = overrideNotes.filter(
    (n) =>
      (n.payload as { summary?: string }).summary ===
      "A change approval used a single-approver override",
  );
  expect(overrideOnly.map((n) => n.userId)).not.toContain(owner.id);
});

test("a hatless actor on a non-current step → ConflictError, not ForbiddenError (conflict is enforced before the hat)", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const hatless = await seedActor(["DEVELOPER"]); // no *_APPROVER hat
  const subjectId = rand();

  const { id } = await open(highRiskInput(owner.id, subjectId));
  const step2Id = (
    await db().approvalStep.findFirstOrThrow({
      where: { requestId: id, order: 2 },
    })
  ).id;

  // Step 1 is still PENDING, so step 2 is non-current. Enforcement step 1
  // (conflict) must run before step 2 (hat) — otherwise this throws Forbidden.
  await expect(
    decide({
      stepId: step2Id,
      actor: hatless,
      decision: "APPROVED",
      reason: "no hat, wrong step",
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("a hatless actor on a step of an already-resolved request → ConflictError, not ForbiddenError", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const hatless = await seedActor(["DEVELOPER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);
  await decide({ stepId, actor: tech, decision: "APPROVED", reason: "ok" });

  await expect(
    decide({
      stepId,
      actor: hatless,
      decision: "APPROVED",
      reason: "too late",
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("recordDecision with a blank reason → ConflictError (spec 04 §9: every decision has a non-empty reason)", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);

  await expect(
    decide({ stepId, actor: tech, decision: "APPROVED", reason: "   " }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("recordDecision writes ApprovalDecision with .create only (row is immutable for keel_app)", async () => {
  const owner = await seedActor(["DEVELOPER"]);
  const tech = await seedActor(["TECHNICAL_APPROVER"]);
  const subjectId = rand();

  await open(standardInput(owner.id, subjectId));
  const stepId = await currentStepId(subjectId);
  await decide({ stepId, actor: tech, decision: "APPROVED", reason: "ok" });

  // A second decision on the now-resolved step is rejected — there is no update
  // path — so exactly one row exists.
  await expect(
    decide({ stepId, actor: tech, decision: "REJECTED", reason: "flip" }),
  ).rejects.toBeInstanceOf(ConflictError);

  expect(await db().approvalDecision.count({ where: { stepId } })).toBe(1);
});
