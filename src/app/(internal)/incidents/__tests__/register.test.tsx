/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IncidentRegister } from "@/app/(internal)/incidents/IncidentRegister";
import { apiFetch } from "@/lib/api/client";

// `IncidentRegister` calls `useRouter()` — the filter chips / toggles also write
// the URL so a reload is stable. The repo carries no app-router test context, so
// stub the hook with one module-level `push` a test can assert on.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

// The stub drawer talks to `GET /api/incidents/:id` through `apiFetch` (Global
// Constraint), so mock that — not `globalThis.fetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  push.mockReset();
  apiFetchMock.mockReset();
});

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

const rows = [
  {
    id: "i1",
    ref: "INC-0001",
    title: "Checkout is down",
    affectedService: "Payments API",
    priority: "P1" as const,
    status: "IN_PROGRESS",
    assigneeId: "u9",
    assigneeName: "Ada Lovelace",
    dueAt: hoursAgo(2),
    overdue: true,
    createdAt: hoursAgo(5),
  },
  {
    id: "i2",
    ref: "INC-0002",
    title: "Typo on the About page",
    affectedService: "Marketing site",
    priority: "P4" as const,
    status: "NEW",
    assigneeId: null,
    assigneeName: null,
    dueAt: hoursAhead(100),
    overdue: false,
    createdAt: hoursAgo(1),
  },
];

const viewer = { id: "u1", kind: "INTERNAL", hats: [] as string[] };

// The repo carries no @testing-library/jest-dom, so assert on truthiness / null.
test("renders a card per incident with its ref and title", () => {
  render(
    <IncidentRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(screen.getByText("INC-0001")).toBeTruthy();
  expect(screen.getByText("Checkout is down")).toBeTruthy();
  expect(screen.getByText("INC-0002")).toBeTruthy();
  expect(screen.getByText("Typo on the About page")).toBeTruthy();
});

test("the overdue incident's card shows an OVERDUE badge", () => {
  render(
    <IncidentRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(screen.getByText("OVERDUE")).toBeTruthy();
});

test("shows the assignee name, or 'Unassigned' when there is none", () => {
  render(
    <IncidentRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  expect(screen.getByText("Unassigned")).toBeTruthy();
});

test("toggling 'Overdue only' hides the non-overdue card and pushes ?overdue=true", async () => {
  render(
    <IncidentRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /overdue only/i }));
  expect(screen.queryByText("Typo on the About page")).toBeNull();
  expect(screen.getByText("Checkout is down")).toBeTruthy();
  expect(push).toHaveBeenCalledWith("/incidents?overdue=true");
});

test("clicking a card opens the drawer, which fetches the incident", async () => {
  // The full drawer (Task 9) also fetches its comment thread; a hat-less viewer
  // does not fetch the internal-users list.
  apiFetchMock.mockImplementation((path) => {
    if (path === "/api/incidents/i1/comments") {
      return Promise.resolve({ comments: [] });
    }
    return Promise.resolve({
      id: "i1",
      ref: "INC-0001",
      title: "Checkout is down",
      description: "Payments fail.",
      affectedService: "Payments API",
      impact: "HIGH",
      urgency: "HIGH",
      priority: "P1",
      status: "IN_PROGRESS",
      activity: [],
      linkedChanges: [],
    });
  });
  render(
    <IncidentRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /INC-0001/i }));

  expect(await screen.findByTestId("drawer-scrim")).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(([path]) => path === "/api/incidents/i1"),
  ).toBe(true);
});
