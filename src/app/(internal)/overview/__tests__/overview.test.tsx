/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverviewClient } from "@/app/(internal)/overview/OverviewClient";
import type { OverviewResponse } from "@/lib/api/schemas/overview";

// The client island re-fetches `/api/overview` through `apiFetch` on focus and
// on a 60s interval (Global Constraint) — mock that, not `globalThis.fetch`.
// Resolving `undefined` makes the refetch a no-op: the seeded `initial` stands.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn().mockResolvedValue(undefined) };
});

afterEach(cleanup);

function payload(over: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    tiles: {
      myOpenItems: 3,
      approvalsWaiting: 2,
      overdue: 1,
      demandsInTriage: 5,
    },
    myQueue: [],
    approvals: [],
    activity: [],
    funnel: [],
    windows: [],
    emailFailures: { count: 0, recent: [] },
    ...over,
  };
}

function queueRow(
  over: Partial<OverviewResponse["myQueue"][number]> = {},
): OverviewResponse["myQueue"][number] {
  return {
    id: "i1",
    kind: "incident",
    ref: "INC-0001",
    title: "Mail relay down",
    hint: "Response due in 2h",
    href: "/incidents?open=i1",
    overdue: false,
    sortKey: 1,
    ...over,
  };
}

function approvalRow(
  over: Partial<OverviewResponse["approvals"][number]> = {},
): OverviewResponse["approvals"][number] {
  return {
    subjectType: "change",
    subjectId: "c1",
    subjectRef: "CHG-0001",
    subjectTitle: "Upgrade the primary database",
    currentRequiredHat: "CHANGE_MANAGER",
    needsOverride: false,
    href: "/approvals",
    ...over,
  };
}

test("the four tiles render their counts", () => {
  render(<OverviewClient initial={payload()} />);

  expect(screen.getByText("My open items")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByText("Approvals waiting")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.getByText("Overdue")).toBeTruthy();
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("Demands in triage")).toBeTruthy();
  expect(screen.getByText("5")).toBeTruthy();
});

test("my queue shows a row per item, the OVERDUE badge only on the flagged one, and links to each href", () => {
  render(
    <OverviewClient
      initial={payload({
        myQueue: [
          queueRow(),
          queueRow({
            id: "i2",
            ref: "INC-0002",
            title: "DNS resolver flapping",
            overdue: true,
            href: "/incidents?open=i2",
          }),
        ],
      })}
    />,
  );

  expect(screen.getByText("INC-0001")).toBeTruthy();
  expect(screen.getByText("INC-0002")).toBeTruthy();
  expect(screen.getAllByText("OVERDUE")).toHaveLength(1);

  const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(hrefs).toContain("/incidents?open=i1");
  expect(hrefs).toContain("/incidents?open=i2");
});

test("approvals panel shows the override badge only where needsOverride is set", () => {
  render(
    <OverviewClient
      initial={payload({
        approvals: [
          approvalRow(),
          approvalRow({
            subjectId: "c2",
            subjectRef: "CHG-0002",
            subjectTitle: "Rotate the edge TLS certificates",
            needsOverride: true,
          }),
        ],
      })}
    />,
  );

  expect(screen.getByText("CHG-0001")).toBeTruthy();
  expect(screen.getByText("CHG-0002")).toBeTruthy();
  expect(screen.getAllByText(/override needed/i)).toHaveLength(1);
});

test("both panels render their empty state when there is nothing", () => {
  render(<OverviewClient initial={payload()} />);

  expect(screen.getByText("Nothing needs you right now.")).toBeTruthy();
  expect(screen.getByText("No approvals waiting on you.")).toBeTruthy();
});
