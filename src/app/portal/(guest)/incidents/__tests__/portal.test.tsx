/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortalIncidentDetail } from "@/app/portal/(guest)/incidents/PortalIncidentDetail";
import { PortalIncidentForm } from "@/app/portal/(guest)/submit/PortalIncidentForm";
import { PortalIncidentList } from "@/app/portal/(guest)/incidents/PortalIncidentList";
import { apiFetch } from "@/lib/api/client";

// `PortalIncidentForm` routes with `useRouter().push` on success.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The comment thread and the report form both talk to the API through
// `apiFetch` (Global Constraint), so mock that — not `globalThis.fetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
  push.mockReset();
});

// The rows the guest list receives are ALREADY guest-serialized by
// `listIncidents` — a plain-word `status`, an `slaLine`, no impact / priority /
// assignee / enum.
const rows = [
  {
    id: "i1",
    ref: "INC-0001",
    title: "Checkout is down",
    status: "Reported",
    affectedService: "Storefront",
    slaLine: "Response due in 3h",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "i2",
    ref: "INC-0002",
    title: "Reports are slow",
    status: "Investigating",
    affectedService: "Analytics",
    slaLine: "Response overdue",
    createdAt: "2026-08-20T09:00:00.000Z",
  },
];

test("the list shows each incident's title, status word, affected software and SLA line, and links each row to its detail page", () => {
  render(<PortalIncidentList rows={rows} />);

  expect(screen.getByText("Checkout is down")).toBeTruthy();
  expect(screen.getByText("Reported")).toBeTruthy();
  expect(screen.getByText("Investigating")).toBeTruthy();
  expect(screen.getByText("Response due in 3h")).toBeTruthy();
  expect(screen.getByText("Storefront")).toBeTruthy();

  const link = screen.getByRole("link", { name: /Checkout is down/i });
  expect(link.getAttribute("href")).toBe("/portal/incidents/i1");
});

test("the list renders an empty state when the guest has no incidents", () => {
  render(<PortalIncidentList rows={[]} />);
  expect(screen.getByText(/no incidents yet/i)).toBeTruthy();
});

test("an unread-comment dot marks only the cards whose id is in unreadIds", () => {
  render(<PortalIncidentList rows={rows} unreadIds={["i2"]} />);

  const firstCard = screen.getByRole("link", { name: /Checkout is down/i });
  const secondCard = screen.getByRole("link", { name: /Reports are slow/i });

  expect(within(secondCard).getByLabelText("unread messages")).toBeTruthy();
  expect(within(firstCard).queryByLabelText("unread messages")).toBeNull();
});

test("no unread-comment dot renders when unreadIds is empty", () => {
  render(<PortalIncidentList rows={rows} unreadIds={[]} />);
  expect(screen.queryByLabelText("unread messages")).toBeNull();
});

test("detail for an in-progress incident shows the plain-word status, the SLA line, the description, a message box, and no internal vocabulary", async () => {
  apiFetchMock.mockResolvedValue({ comments: [] });

  const incident = {
    // Real guest-serialized fields.
    id: "i1",
    ref: "INC-0001",
    title: "Checkout is down",
    description: "Customers cannot pay at the till.",
    affectedService: "Storefront",
    status: "Investigating",
    slaLine: "Response due in 3h",
    fix: null,
    activity: [{ time: "2026-09-01 09:00", text: "Problem reported" }],
    // Internal-only keys that must NEVER reach the guest DOM. If a future edit
    // rendered `{incident.priority}` (etc.) the assertions below would fail.
    priority: "P1",
    assigneeId: "u5",
    impact: "HIGH",
    urgency: "HIGH",
    reportedById: "g9",
    overdue: true,
    rawStatus: "IN_PROGRESS",
  };

  const { container } = render(<PortalIncidentDetail incident={incident} />);

  expect(screen.getByText("Investigating")).toBeTruthy();
  expect(screen.getByText("Response due in 3h")).toBeTruthy();
  expect(screen.getByText("Customers cannot pay at the till.")).toBeTruthy();
  expect(screen.getByText("Problem reported")).toBeTruthy();
  expect(await screen.findByLabelText("Add a message")).toBeTruthy();

  const dom = container.innerHTML;
  for (const forbidden of [
    "P1",
    "assigneeId",
    "u5",
    "IN_PROGRESS",
    "reportedById",
    "g9",
    "HIGH",
  ]) {
    expect(dom).not.toContain(forbidden);
  }
});

test("detail shows 'A fix is on the way' when fix is on_the_way", () => {
  apiFetchMock.mockResolvedValue({ comments: [] });

  const incident = {
    id: "i1",
    ref: "INC-0001",
    title: "Checkout is down",
    description: "Customers cannot pay.",
    affectedService: "Storefront",
    status: "Investigating",
    slaLine: "Response overdue",
    fix: "on_the_way",
    activity: [],
  };

  render(<PortalIncidentDetail incident={incident} />);
  expect(screen.getByText("A fix is on the way")).toBeTruthy();
});

test("detail shows 'This has been fixed' when fix is fixed", () => {
  apiFetchMock.mockResolvedValue({ comments: [] });

  const incident = {
    id: "i1",
    ref: "INC-0001",
    title: "Checkout is down",
    description: "Customers cannot pay.",
    affectedService: "Storefront",
    status: "Resolved",
    slaLine: "Resolved within SLA",
    fix: "fixed",
    activity: [],
  };

  render(<PortalIncidentDetail incident={incident} />);
  expect(screen.getByText("This has been fixed")).toBeTruthy();
  expect(screen.queryByText("A fix is on the way")).toBeNull();
});

test("the report form posts the four guest fields to /api/incidents and routes to the list on success", async () => {
  apiFetchMock.mockResolvedValue({ id: "i9", ref: "INC-0009" });

  render(<PortalIncidentForm />);

  await userEvent.type(
    screen.getByLabelText(/what went wrong/i),
    "Checkout is down",
  );
  await userEvent.type(
    screen.getByLabelText(/more detail/i),
    "Customers cannot pay at the till",
  );
  await userEvent.type(screen.getByLabelText(/which software/i), "Storefront");
  await userEvent.type(
    screen.getByLabelText(/how much is it affecting you/i),
    "We cannot take any orders",
  );
  await userEvent.click(
    screen.getByRole("button", { name: /report the problem/i }),
  );

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(([p]) => p === "/api/incidents");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      method: "POST",
      body: {
        title: "Checkout is down",
        description: "Customers cannot pay at the till",
        affectedService: "Storefront",
        affectingLevel: "We cannot take any orders",
      },
    });
  });

  await waitFor(() => expect(push).toHaveBeenCalledWith("/portal/incidents"));
});

test("the report form does not call the API when a field is blank", async () => {
  render(<PortalIncidentForm />);

  await userEvent.type(
    screen.getByLabelText(/what went wrong/i),
    "Only a title",
  );
  await userEvent.click(
    screen.getByRole("button", { name: /report the problem/i }),
  );

  expect(apiFetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});
