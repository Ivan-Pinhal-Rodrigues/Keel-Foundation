import { expect, test } from "vitest";
import {
  SLA_HOURS,
  dueAtFrom,
  isOverdue,
  priorityFor,
} from "@/server/modules/incident/priority";

test("the nine impact x urgency combinations map per data-model.md", () => {
  // H×H → P1; H×M, M×H → P2; H×L, M×M, L×H → P3; M×L, L×M, L×L → P4
  expect(priorityFor("HIGH", "HIGH")).toBe("P1");
  expect(priorityFor("HIGH", "MEDIUM")).toBe("P2");
  expect(priorityFor("MEDIUM", "HIGH")).toBe("P2");
  expect(priorityFor("HIGH", "LOW")).toBe("P3");
  expect(priorityFor("MEDIUM", "MEDIUM")).toBe("P3");
  expect(priorityFor("LOW", "HIGH")).toBe("P3");
  expect(priorityFor("MEDIUM", "LOW")).toBe("P4");
  expect(priorityFor("LOW", "MEDIUM")).toBe("P4");
  expect(priorityFor("LOW", "LOW")).toBe("P4");
});

test("dueAt is createdAt plus the priority's SLA hours", () => {
  const created = new Date("2026-09-06T00:00:00.000Z");
  expect(dueAtFrom("P1", created).toISOString()).toBe(
    "2026-09-06T04:00:00.000Z",
  );
  expect(dueAtFrom("P2", created).toISOString()).toBe(
    "2026-09-07T00:00:00.000Z",
  );
  expect(dueAtFrom("P3", created).toISOString()).toBe(
    "2026-09-09T00:00:00.000Z",
  );
  expect(dueAtFrom("P4", created).toISOString()).toBe(
    "2026-09-13T00:00:00.000Z",
  );
  expect(SLA_HOURS.P1).toBe(4);
});

test("isOverdue: true past dueAt while open, false for resolved/closed and before dueAt", () => {
  const due = new Date("2026-09-06T04:00:00.000Z");
  const after = new Date("2026-09-06T04:00:01.000Z");
  const before = new Date("2026-09-06T03:59:59.000Z");
  expect(isOverdue({ dueAt: due, status: "IN_PROGRESS" }, after)).toBe(true);
  expect(isOverdue({ dueAt: due, status: "IN_PROGRESS" }, before)).toBe(false);
  expect(isOverdue({ dueAt: due, status: "RESOLVED" }, after)).toBe(false);
  expect(isOverdue({ dueAt: due, status: "CLOSED" }, after)).toBe(false);
  // exactly at dueAt is not yet overdue
  expect(isOverdue({ dueAt: due, status: "NEW" }, due)).toBe(false);
});
