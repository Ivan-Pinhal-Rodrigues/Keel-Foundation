import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  cancelRequest,
  getApprovalState,
  openApprovalRequest,
  type OpenApprovalInput,
} from "@/server/modules/approval/service";
import type { Hat } from "@/server/policy/actor";
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
