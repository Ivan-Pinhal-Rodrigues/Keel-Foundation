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

test("the activity feed renders a line per event", () => {
  render(
    <OverviewClient
      initial={payload({
        activity: [
          {
            at: new Date(Date.now() - 5 * 60_000).toISOString(),
            label: "incident",
            text: "INC-0001 moved to Monitoring",
          },
          {
            at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
            label: "change",
            text: "CHG-0007 approved by the change manager",
          },
        ],
      })}
    />,
  );

  expect(screen.getByText("INC-0001 moved to Monitoring")).toBeTruthy();
  expect(
    screen.getByText("CHG-0007 approved by the change manager"),
  ).toBeTruthy();
  expect(screen.getByText("5m ago")).toBeTruthy();
  expect(screen.getByText("3h ago")).toBeTruthy();
});

test("the funnel renders a bar per stage with the right counts", () => {
  const { container } = render(
    <OverviewClient
      initial={payload({
        funnel: [
          { stage: "submitted", label: "Submitted", count: 8 },
          { stage: "triaging", label: "Triaging", count: 4 },
          { stage: "approved", label: "Approved", count: 2 },
        ],
      })}
    />,
  );

  const funnel = screen.getByRole("img", { name: /demand funnel/i });
  expect(funnel.getAttribute("aria-label")).toContain("8 Submitted");
  expect(funnel.getAttribute("aria-label")).toContain("2 Approved");

  const bars = [...container.querySelectorAll("[style*='width']")].map((el) =>
    el.getAttribute("style"),
  );
  // busiest stage (8) is full width, 4 is half, 2 is a quarter
  expect(bars).toContain("width: 100%;");
  expect(bars).toContain("width: 50%;");
  expect(bars).toContain("width: 25%;");
  expect(screen.getByText("8")).toBeTruthy();
  expect(screen.getByText("4")).toBeTruthy();
});

test("the windows panel lists the scheduled changes, earliest first", () => {
  render(
    <OverviewClient
      initial={payload({
        windows: [
          {
            id: "c2",
            ref: "CHG-0002",
            title: "Patch the load balancers",
            windowStart: "2026-09-20T22:00:00.000Z",
            windowEnd: "2026-09-21T02:00:00.000Z",
          },
          {
            id: "c1",
            ref: "CHG-0001",
            title: "Upgrade the primary database",
            windowStart: "2026-09-10T01:00:00.000Z",
            windowEnd: "2026-09-10T05:00:00.000Z",
          },
        ],
      })}
    />,
  );

  expect(screen.getByText("CHG-0001")).toBeTruthy();
  expect(screen.getByText("CHG-0002")).toBeTruthy();
  expect(screen.getByText(/2026-09-10 01:00/)).toBeTruthy();

  // earliest window first regardless of input order
  const refs = screen.getAllByText(/^CHG-000[12]$/).map((el) => el.textContent);
  expect(refs).toEqual(["CHG-0001", "CHG-0002"]);
});

test("the windows panel shows its empty state when nothing is scheduled", () => {
  render(<OverviewClient initial={payload({ windows: [] })} />);
  expect(
    screen.getByText("No changes scheduled in the next 14 days."),
  ).toBeTruthy();
});

test("the email panel shows the failure count and expands the list", () => {
  const { container } = render(
    <OverviewClient
      initial={payload({
        emailFailures: {
          count: 2,
          recent: [
            {
              toEmail: "ops@example.com",
              template: "incident-assigned",
              lastError: "550 mailbox unavailable",
              attempts: 3,
            },
            {
              toEmail: "cab@example.com",
              template: "approval-requested",
              lastError: null,
              attempts: 1,
            },
          ],
        },
      })}
    />,
  );

  expect(container.querySelector("details")).toBeTruthy();
  expect(screen.getByText(/failed in the last 7 days/i)).toBeTruthy();
  expect(screen.getByText("Recent failures (2)")).toBeTruthy();
  expect(screen.getByText("ops@example.com")).toBeTruthy();
  expect(screen.getByText("550 mailbox unavailable")).toBeTruthy();
  expect(screen.getByText("cab@example.com")).toBeTruthy();
  expect(screen.getByText("Retry is a manual DB action in v1.")).toBeTruthy();
});

test("the email panel is a healthy one-liner when nothing failed", () => {
  render(<OverviewClient initial={payload()} />);

  expect(screen.getByText(/all sent in the last 7 days/i)).toBeTruthy();
  expect(screen.queryByText(/Recent failures/)).toBeNull();
});
