import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("ApprovalRequest with ordered steps", async () => {
  const req = await db().approvalRequest.create({
    data: {
      subjectType: "Change",
      subjectId: "chg_x",
      policyKey: "change.highRisk",
      status: "PENDING",
      createdById: "u_x",
      steps: {
        create: [
          { order: 1, requiredHat: "TECHNICAL_APPROVER", status: "PENDING" },
          { order: 2, requiredHat: "BUSINESS_APPROVER", status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  expect(req.steps.map((s) => s.requiredHat)).toEqual([
    "TECHNICAL_APPROVER",
    "BUSINESS_APPROVER",
  ]);
});

test("AuditEvent and EmailOutbox with defaults", async () => {
  const ev = await db().auditEvent.create({
    data: {
      action: "x.y",
      subjectType: "Demand",
      subjectId: "d1",
      requestId: "r1",
    },
  });
  const out = await db().emailOutbox.create({
    data: {
      toEmail: "a@b.c",
      template: "guest_invite",
      payload: {},
      status: "PENDING",
    },
  });
  expect(ev.at).toBeInstanceOf(Date);
  expect(out.nextAttemptAt).toBeInstanceOf(Date);
  expect(out.attempts).toBe(0);
});

test("Comment.visibleToClient defaults to false", async () => {
  const author = await db().user.create({
    data: {
      email: "commenter@k.local",
      passwordHash: "x",
      displayName: "Commenter",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const c = await db().comment.create({
    data: {
      subjectType: "Demand",
      subjectId: "dem_1",
      authorId: author.id,
      body: "internal note",
    },
  });
  expect(c.visibleToClient).toBe(false);
});

test("ApprovalRequest -> ApprovalStep -> ApprovalDecision chain persists; actorId resolves to a real User", async () => {
  const actor = await db().user.create({
    data: {
      email: "approver@k.local",
      passwordHash: "x",
      displayName: "Approver",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });
  const req = await db().approvalRequest.create({
    data: {
      subjectType: "Change",
      subjectId: "chg_chain",
      policyKey: "change.normal",
      createdById: "someone_else",
    },
  });
  const step = await db().approvalStep.create({
    data: { requestId: req.id, order: 1, requiredHat: "TECHNICAL_APPROVER" },
  });
  const decision = await db().approvalDecision.create({
    data: {
      stepId: step.id,
      actorId: actor.id,
      decision: "APPROVED",
      reason: "meets the bar",
    },
    include: { actor: true },
  });
  expect(decision.actor.id).toBe(actor.id);
  expect(decision.actor.email).toBe("approver@k.local");
  expect(decision.decidedAt).toBeInstanceOf(Date);

  const full = await db().approvalRequest.findUnique({
    where: { id: req.id },
    include: { steps: { include: { decisions: true } } },
  });
  expect(full?.steps[0]?.decisions[0]?.id).toBe(decision.id);
});

test("a duplicate (requestId, order) ApprovalStep is rejected", async () => {
  const req = await db().approvalRequest.create({
    data: {
      subjectType: "Change",
      subjectId: "chg_dup",
      policyKey: "change.normal",
      createdById: "u_dup",
      steps: { create: [{ order: 1, requiredHat: "TECHNICAL_APPROVER" }] },
    },
  });

  await expect(
    db().approvalStep.create({
      data: { requestId: req.id, order: 1, requiredHat: "BUSINESS_APPROVER" },
    }),
  ).rejects.toThrow();

  const ok = await db().approvalStep.create({
    data: { requestId: req.id, order: 2, requiredHat: "BUSINESS_APPROVER" },
  });
  expect(ok.order).toBe(2);
});
