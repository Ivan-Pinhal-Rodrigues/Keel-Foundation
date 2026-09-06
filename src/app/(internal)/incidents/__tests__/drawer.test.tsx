/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IncidentDrawer } from "@/app/(internal)/incidents/IncidentDrawer";
import { apiFetch } from "@/lib/api/client";

// The drawer talks to the route handlers through `apiFetch` (Global
// Constraint), so mock that — not `globalThis.fetch`. Keep `ApiError` real so
// the component's `instanceof ApiError` branch still works.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const incident = {
  id: "i1",
  ref: "INC-0001",
  title: "Checkout is down",
  description: "Payments fail at the final step.",
  affectedService: "Checkout API",
  impact: "LOW",
  urgency: "LOW",
  priority: "P4",
  status: "NEW",
  assigneeId: null,
  assignee: null,
  dueAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
  overdue: false,
  resolution: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: "2026-09-06T10:00:00.000Z",
  activity: [{ time: "2026-09-06 10:00", text: "Incident reported" }],
  linkedChanges: [],
};

const internalUsers = [
  { id: "v1", displayName: "Ada Lovelace" },
  { id: "u2", displayName: "Grace Hopper" },
];

type WireOpts = { incident?: Record<string, unknown>; comments?: unknown[] };

const WRITE_PATHS =
  /^\/api\/incidents\/i1\/(categorize|assign|transition|reopen)$/;

/** Wire `apiFetch` for the initial GETs, the users list, the comment POST, and
 *  the write actions. */
function wire(opts: WireOpts = {}) {
  const inc = opts.incident ?? incident;
  const commentLog: unknown[] = [...(opts.comments ?? [])];
  apiFetchMock.mockImplementation((path, o) => {
    if (path === "/api/incidents/i1" && !o) return Promise.resolve(inc);
    if (path === "/api/users?kind=INTERNAL" && !o) {
      return Promise.resolve({ users: internalUsers });
    }
    if (path === "/api/incidents/i1/comments" && o?.method === "POST") {
      const body = (o.body as { body: string }).body;
      commentLog.push({
        id: `c${commentLog.length + 1}`,
        body,
        createdAt: new Date().toISOString(),
        authorName: "Ada Lovelace",
        visibleToClient: true,
      });
      return Promise.resolve({ comments: [...commentLog] });
    }
    if (path === "/api/incidents/i1/comments") {
      return Promise.resolve({ comments: [...commentLog] });
    }
    if (WRITE_PATHS.test(path)) return Promise.resolve({ ok: true });
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

const viewer = (hats: string[], id = "v1") => ({
  id,
  kind: "INTERNAL" as const,
  hats,
});

test("opens with the incident's ref, title, priority tag, and status pill", async () => {
  wire();
  render(<IncidentDrawer id="i1" open onClose={vi.fn()} viewer={viewer([])} />);

  expect(await screen.findByText("INC-0001")).toBeTruthy();
  expect(screen.getByText("Checkout is down")).toBeTruthy();
  expect(screen.getByText("Payments fail at the final step.")).toBeTruthy();
  expect(screen.getByText("P4")).toBeTruthy();
  expect(screen.getByText("New")).toBeTruthy();
});

test("a DEVELOPER sees the categorisation selectors; a hat-less viewer sees them read-only", async () => {
  wire();
  const { unmount } = render(
    <IncidentDrawer
      id="i1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"])}
    />,
  );
  expect(await screen.findByLabelText("Impact")).toBeTruthy();
  expect(screen.getByLabelText("Urgency")).toBeTruthy();
  unmount();
  cleanup();
  apiFetchMock.mockReset();

  wire();
  render(<IncidentDrawer id="i1" open onClose={vi.fn()} viewer={viewer([])} />);
  await screen.findByText("INC-0001");
  expect(screen.queryByLabelText("Impact")).toBeNull();
  expect(screen.queryByLabelText("Urgency")).toBeNull();
});

test("changing impact/urgency updates the live priority preview", async () => {
  wire();
  render(
    <IncidentDrawer
      id="i1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"])}
    />,
  );

  const impact = await screen.findByLabelText("Impact");
  const urgency = screen.getByLabelText("Urgency");
  expect(screen.getByTestId("priority-preview").textContent).toContain("P4");

  await userEvent.selectOptions(impact, "HIGH");
  await userEvent.selectOptions(urgency, "HIGH");
  expect(screen.getByTestId("priority-preview").textContent).toContain("P1");
});

test("Resolve is disabled until a resolution is typed; submitting calls POST .../transition then re-fetches", async () => {
  wire({ incident: { ...incident, status: "IN_PROGRESS", assigneeId: "v1" } });
  render(
    <IncidentDrawer
      id="i1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"])}
    />,
  );

  const resolveBtn = await screen.findByRole("button", { name: "Resolve" });
  expect((resolveBtn as HTMLButtonElement).disabled).toBe(true);

  await userEvent.type(
    screen.getByLabelText("Resolution"),
    "Restarted the payment worker",
  );
  expect((resolveBtn as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(resolveBtn);

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/incidents/i1/transition" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    const body = call![1]!.body as { to: string; resolution: string };
    expect(body.to).toBe("RESOLVED");
    expect(body.resolution).toBe("Restarted the payment worker");
  });
  const getCalls = apiFetchMock.mock.calls.filter(
    ([p, o]) => p === "/api/incidents/i1" && !o,
  );
  expect(getCalls.length >= 2).toBe(true);
});

test("posting a comment calls POST .../comments and shows the new comment", async () => {
  wire();
  render(<IncidentDrawer id="i1" open onClose={vi.fn()} viewer={viewer([])} />);

  const textarea = await screen.findByLabelText("Add a comment");
  await userEvent.type(textarea, "Investigating now");
  await userEvent.click(screen.getByRole("button", { name: /post comment/i }));

  expect(await screen.findByText("Investigating now")).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(
      ([path, opts]) =>
        path === "/api/incidents/i1/comments" && opts?.method === "POST",
    ),
  ).toBe(true);
});

test("the assignee select is populated from GET /api/users?kind=INTERNAL", async () => {
  wire();
  render(
    <IncidentDrawer
      id="i1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"])}
    />,
  );

  expect(await screen.findByLabelText("Assignee")).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Grace Hopper" })).toBeTruthy();
  });
  expect(
    apiFetchMock.mock.calls.some(
      ([path]) => path === "/api/users?kind=INTERNAL",
    ),
  ).toBe(true);
});
