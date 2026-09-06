import { expect, test } from "vitest";
import {
  currentStep,
  overrideActionFor,
  resolveRequestStatus,
} from "@/server/modules/approval/state";

const s = (
  order: number,
  requiredHat: "TECHNICAL_APPROVER" | "BUSINESS_APPROVER",
  status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED",
) => ({ order, requiredHat, status });

test("currentStep is the lowest-order PENDING step", () => {
  expect(
    currentStep([
      s(1, "TECHNICAL_APPROVER", "APPROVED"),
      s(2, "BUSINESS_APPROVER", "PENDING"),
    ])?.order,
  ).toBe(2);
  expect(
    currentStep([
      s(1, "TECHNICAL_APPROVER", "APPROVED"),
      s(2, "BUSINESS_APPROVER", "APPROVED"),
    ]),
  ).toBeNull();
  expect(
    currentStep([
      s(2, "BUSINESS_APPROVER", "PENDING"),
      s(1, "TECHNICAL_APPROVER", "PENDING"),
    ])?.order,
  ).toBe(1);
});

test("resolveRequestStatus: any rejection rejects the request; all-approved approves; else pending", () => {
  expect(resolveRequestStatus([s(1, "TECHNICAL_APPROVER", "APPROVED")])).toBe(
    "APPROVED",
  );
  expect(
    resolveRequestStatus([
      s(1, "TECHNICAL_APPROVER", "APPROVED"),
      s(2, "BUSINESS_APPROVER", "PENDING"),
    ]),
  ).toBe("PENDING");
  expect(
    resolveRequestStatus([
      s(1, "TECHNICAL_APPROVER", "REJECTED"),
      s(2, "BUSINESS_APPROVER", "PENDING"),
    ]),
  ).toBe("REJECTED");
  expect(
    resolveRequestStatus([
      s(1, "TECHNICAL_APPROVER", "APPROVED"),
      s(2, "BUSINESS_APPROVER", "APPROVED"),
    ]),
  ).toBe("APPROVED");
  expect(
    resolveRequestStatus([
      s(1, "TECHNICAL_APPROVER", "APPROVED"),
      s(2, "BUSINESS_APPROVER", "SKIPPED"),
    ]),
  ).toBe("PENDING");
  expect(
    resolveRequestStatus([
      s(1, "TECHNICAL_APPROVER", "SKIPPED"),
      s(2, "BUSINESS_APPROVER", "SKIPPED"),
    ]),
  ).toBe("PENDING");
});

test("overrideActionFor maps the two approver hats and throws for others", () => {
  expect(overrideActionFor("TECHNICAL_APPROVER")).toBe(
    "change.approve.technical.override",
  );
  expect(overrideActionFor("BUSINESS_APPROVER")).toBe(
    "change.approve.business.override",
  );
  expect(() => overrideActionFor("DEVELOPER")).toThrow();
});
