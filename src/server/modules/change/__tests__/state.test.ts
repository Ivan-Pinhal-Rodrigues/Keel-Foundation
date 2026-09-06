import { expect, test } from "vitest";
import {
  CHANGE_STAGES,
  CHANGE_TRANSITIONS,
  assertTransition,
  gateFor,
  type GateInput,
} from "@/server/modules/change/state";
import { ForbiddenError } from "@/server/policy/errors";

const base: GateInput = {
  rfc: null,
  riskLevel: null,
  impactAssessment: null,
  rollbackPlan: null,
  originatingDemandId: null,
  standaloneConfirmed: false,
  windowStart: null,
  windowEnd: null,
  changeType: "NORMAL",
  valueRealized: null,
  lessons: null,
  wentToPlanAcknowledged: false,
};
const now = new Date("2026-09-10T00:00:00Z");

test("transitions", () => {
  expect(() => assertTransition("DRAFT", "ASSESSING")).not.toThrow();
  expect(() => assertTransition("ASSESSING", "APPROVAL")).not.toThrow();
  expect(() => assertTransition("APPROVAL", "SCHEDULED")).not.toThrow();
  expect(() => assertTransition("APPROVAL", "ASSESSING")).not.toThrow(); // rejection path
  expect(() => assertTransition("SCHEDULED", "IMPLEMENTING")).not.toThrow();
  expect(() => assertTransition("IMPLEMENTING", "PIR")).not.toThrow();
  expect(() => assertTransition("IMPLEMENTING", "ROLLED_BACK")).not.toThrow();
  expect(() => assertTransition("PIR", "CLOSED")).not.toThrow();

  expect(() => assertTransition("DRAFT", "APPROVAL")).toThrow(ForbiddenError);
  expect(() => assertTransition("CLOSED", "PIR")).toThrow(ForbiddenError);
  expect(() => assertTransition("ROLLED_BACK", "IMPLEMENTING")).toThrow(
    ForbiddenError,
  );
  expect(() => assertTransition("SCHEDULED", "PIR")).toThrow(ForbiddenError);
});

test("the transition table is total over ChangeStatus", () => {
  const statuses = [
    "DRAFT",
    "ASSESSING",
    "APPROVAL",
    "SCHEDULED",
    "IMPLEMENTING",
    "PIR",
    "CLOSED",
    "ROLLED_BACK",
  ] as const;
  for (const s of statuses) {
    expect(Array.isArray(CHANGE_TRANSITIONS[s])).toBe(true);
  }
  expect(CHANGE_TRANSITIONS.CLOSED).toEqual([]);
  expect(CHANGE_TRANSITIONS.ROLLED_BACK).toEqual([]);
});

test("CHANGE_STAGES lists the seven non-terminal stages in order", () => {
  expect(CHANGE_STAGES.map((s) => s.key)).toEqual([
    "draft",
    "assessing",
    "approval",
    "scheduled",
    "implementing",
    "pir",
    "closed",
  ]);
  expect(CHANGE_STAGES.map((s) => s.status)).toEqual([
    "DRAFT",
    "ASSESSING",
    "APPROVAL",
    "SCHEDULED",
    "IMPLEMENTING",
    "PIR",
    "CLOSED",
  ]);
});

test("draft gate: RFC + a demand link or a standalone confirmation", () => {
  expect(gateFor("draft", base, null, now).canAdvance).toBe(false);
  expect(
    gateFor(
      "draft",
      { ...base, rfc: "the plan", standaloneConfirmed: true },
      null,
      now,
    ).canAdvance,
  ).toBe(true);
  expect(
    gateFor(
      "draft",
      { ...base, rfc: "the plan", originatingDemandId: "d1" },
      null,
      now,
    ).canAdvance,
  ).toBe(true);
  // RFC present but no demand link and not confirmed standalone
  expect(
    gateFor("draft", { ...base, rfc: "the plan" }, null, now).canAdvance,
  ).toBe(false);
  // whitespace-only RFC does not count
  expect(
    gateFor(
      "draft",
      { ...base, rfc: "   ", standaloneConfirmed: true },
      null,
      now,
    ).canAdvance,
  ).toBe(false);
});

test("assessing gate needs risk, impact, and a rollback plan", () => {
  const ok: GateInput = {
    ...base,
    riskLevel: "LOW",
    impactAssessment: "small",
    rollbackPlan: "revert the migration",
  };
  expect(gateFor("assessing", ok, null, now).canAdvance).toBe(true);
  expect(
    gateFor("assessing", { ...ok, rollbackPlan: null }, null, now).canAdvance,
  ).toBe(false);
  expect(
    gateFor("assessing", { ...ok, riskLevel: null }, null, now).canAdvance,
  ).toBe(false);
  expect(
    gateFor("assessing", { ...ok, impactAssessment: "  " }, null, now)
      .canAdvance,
  ).toBe(false);
  // no dropped "test plan" item
  expect(gateFor("assessing", ok, null, now).items.map((i) => i.key)).toEqual([
    "riskLevel",
    "impactAssessment",
    "rollbackPlan",
  ]);
});

test("approval gate: APPROVED status, or EMERGENCY change type; blockedReason otherwise", () => {
  expect(gateFor("approval", base, "APPROVED", now).canAdvance).toBe(true);
  expect(
    gateFor("approval", { ...base, changeType: "EMERGENCY" }, "PENDING", now)
      .canAdvance,
  ).toBe(true);

  const blocked = gateFor("approval", base, "PENDING", now);
  expect(blocked.canAdvance).toBe(false);
  expect(blocked.blockedReason).toMatch(/waiting on approval/i);

  expect(gateFor("approval", base, "REJECTED", now).blockedReason).toMatch(
    /rejected/i,
  );
  expect(gateFor("approval", base, null, now).blockedReason).toMatch(
    /submit for approval first/i,
  );
  // CANCELLED is treated like null
  expect(gateFor("approval", base, "CANCELLED", now).blockedReason).toMatch(
    /submit for approval first/i,
  );
  // when it can advance there is no blockedReason
  expect(
    gateFor("approval", base, "APPROVED", now).blockedReason,
  ).toBeUndefined();
});

test("scheduled gate: a future window with start < end and a rollback plan", () => {
  const win: GateInput = {
    ...base,
    rollbackPlan: "revert",
    windowStart: new Date("2026-09-12T09:00:00Z"),
    windowEnd: new Date("2026-09-12T11:00:00Z"),
  };
  expect(gateFor("scheduled", win, "APPROVED", now).canAdvance).toBe(true);
  expect(
    gateFor(
      "scheduled",
      { ...win, windowStart: new Date("2026-09-05T09:00:00Z") },
      "APPROVED",
      now,
    ).canAdvance,
  ).toBe(false); // past
  expect(
    gateFor(
      "scheduled",
      { ...win, windowEnd: new Date("2026-09-12T08:00:00Z") },
      "APPROVED",
      now,
    ).canAdvance,
  ).toBe(false); // end < start
  expect(
    gateFor("scheduled", { ...win, rollbackPlan: null }, "APPROVED", now)
      .canAdvance,
  ).toBe(false);
  expect(
    gateFor("scheduled", { ...win, windowEnd: null }, "APPROVED", now)
      .canAdvance,
  ).toBe(false);
});

test("implementing gate: a single went-to-plan acknowledgement", () => {
  expect(gateFor("implementing", base, "APPROVED", now).canAdvance).toBe(false);
  const acked = gateFor(
    "implementing",
    { ...base, wentToPlanAcknowledged: true },
    "APPROVED",
    now,
  );
  expect(acked.canAdvance).toBe(true);
  expect(acked.items.map((i) => i.key)).toEqual(["wentToPlanAcknowledged"]);
});

test("pir gate: valueRealized + lessons; for EMERGENCY also a resolved approval", () => {
  const pir: GateInput = {
    ...base,
    valueRealized: "YES",
    lessons: "went fine",
  };
  expect(gateFor("pir", pir, "APPROVED", now).canAdvance).toBe(true);
  expect(
    gateFor("pir", { ...pir, lessons: null }, "APPROVED", now).canAdvance,
  ).toBe(false);
  expect(
    gateFor("pir", { ...pir, valueRealized: null }, "APPROVED", now).canAdvance,
  ).toBe(false);

  expect(
    gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "PENDING", now)
      .canAdvance,
  ).toBe(false);
  expect(
    gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "PENDING", now)
      .blockedReason,
  ).toMatch(/retrospective approval decision/i);
  expect(
    gateFor("pir", { ...pir, changeType: "EMERGENCY" }, null, now).canAdvance,
  ).toBe(false);
  expect(
    gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "APPROVED", now)
      .canAdvance,
  ).toBe(true);
  expect(
    gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "REJECTED", now)
      .canAdvance,
  ).toBe(true);
});

test("closed gate: terminal", () => {
  const g = gateFor("closed", base, "APPROVED", now);
  expect(g.items).toEqual([]);
  expect(g.canAdvance).toBe(false);
});
