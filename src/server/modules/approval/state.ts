import type { $Enums } from "@prisma/client";

export type StepView = {
  order: number;
  requiredHat: $Enums.Hat;
  status: $Enums.StepStatus;
};

export function currentStep<T extends StepView>(steps: readonly T[]): T | null {
  return (
    [...steps]
      .filter((s) => s.status === "PENDING")
      .sort((a, b) => a.order - b.order)[0] ?? null
  );
}

export function resolveRequestStatus(
  steps: readonly StepView[],
): $Enums.ApprovalStatus {
  if (steps.some((s) => s.status === "REJECTED")) return "REJECTED";
  if (steps.every((s) => s.status === "APPROVED")) return "APPROVED";
  return "PENDING";
}

const OVERRIDE_ACTIONS: Partial<Record<$Enums.Hat, string>> = {
  TECHNICAL_APPROVER: "change.approve.technical.override",
  BUSINESS_APPROVER: "change.approve.business.override",
};

export function overrideActionFor(requiredHat: $Enums.Hat): string {
  const action = OVERRIDE_ACTIONS[requiredHat];
  if (!action) {
    throw new Error(`no override action for the ${requiredHat} hat`);
  }
  return action;
}
