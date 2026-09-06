/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandDrawer } from "@/app/(internal)/demands/DemandDrawer";
import { ApiError, apiFetch } from "@/lib/api/client";

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

const demand = {
  id: "d1",
  ref: "DEM-0001",
  title: "Faster exports",
  problem: "Reports take 20 minutes to generate.",
  status: "TRIAGING",
  submittedById: "someone-else",
  worth: {
    businessValue: "High leverage for the retention team",
    valueScore: 8,
    effort: "M",
    feasibility: "Feasible within a sprint",
    costOfDelay: "Grows every billing cycle",
    decision: null,
  },
  activity: [{ time: "2026-09-06 10:00", text: "Demand raised" }],
};

type WireOpts = {
  comments?: unknown[];
  demand?: Record<string, unknown>;
  onWrite?: (
    path: string,
    opts: { method?: string; body?: unknown } | undefined,
  ) => Promise<unknown> | undefined;
};

const WRITE_PATHS =
  /^\/api\/demands\/d1\/(triage|value|effort|cost-of-delay|decision|reject)$/;

/** Wire `apiFetch` for the two initial GETs, the comment POST, and the writes. */
function wire(opts: WireOpts = {}) {
  const d = opts.demand ?? demand;
  const commentLog: unknown[] = [...(opts.comments ?? [])];
  apiFetchMock.mockImplementation((path, o) => {
    if (path === "/api/demands/d1" && !o) return Promise.resolve(d);
    if (path === "/api/demands/d1/comments" && o?.method === "POST") {
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
    if (path === "/api/demands/d1/comments") {
      return Promise.resolve({ comments: [...commentLog] });
    }
    if (opts.onWrite) {
      const r = opts.onWrite(path, o);
      if (r) return r;
    }
    if (WRITE_PATHS.test(path)) return Promise.resolve({ ok: true });
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

const internal = (hats: string[], id = "u1") => ({
  id,
  kind: "INTERNAL" as const,
  hats,
});

test("opens with the demand's ref, title, problem, and a status pill", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} viewer={internal([])} />);

  expect(await screen.findByText("DEM-0001")).toBeTruthy();
  expect(screen.getByText("Faster exports")).toBeTruthy();
  expect(screen.getByText("Reports take 20 minutes to generate.")).toBeTruthy();
  expect(screen.getByText("Triaging")).toBeTruthy();
});

test("renders the worth assessment panels read-only for a viewer with no hats", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} viewer={internal([])} />);

  expect(
    await screen.findByText("High leverage for the retention team"),
  ).toBeTruthy();
  expect(screen.getByText("Feasible within a sprint")).toBeTruthy();
  expect(screen.getByText("8/10")).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

test("renders the activity timeline from the demand's events", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} viewer={internal([])} />);

  expect(await screen.findByText("Demand raised")).toBeTruthy();
  expect(screen.getByText("2026-09-06 10:00")).toBeTruthy();
});

test("posting a comment calls POST .../comments and shows the new comment", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} viewer={internal([])} />);

  const textarea = await screen.findByLabelText("Add a comment");
  await userEvent.type(textarea, "Looks reasonable to me");
  await userEvent.click(screen.getByRole("button", { name: /post comment/i }));

  expect(await screen.findByText("Looks reasonable to me")).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(
      ([path, opts]) =>
        path === "/api/demands/d1/comments" && opts?.method === "POST",
    ),
  ).toBe(true);
});

test("a TRIAGING demand with a BUSINESS_APPROVER viewer: business value is editable, saves via PATCH /value, then re-fetches", async () => {
  wire();
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER"])}
    />,
  );

  const narrative = await screen.findByLabelText("Business value");
  await userEvent.clear(narrative);
  await userEvent.type(narrative, "Unlocks the retention dashboard");
  const score = screen.getByLabelText("Value score (1-10)");
  await userEvent.clear(score);
  await userEvent.type(score, "7");
  await userEvent.click(
    screen.getByRole("button", { name: /save business value/i }),
  );

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/demands/d1/value" && o?.method === "PATCH",
    );
    expect(call).toBeTruthy();
    expect((call![1]!.body as { businessValue: string }).businessValue).toBe(
      "Unlocks the retention dashboard",
    );
    expect((call![1]!.body as { valueScore: number }).valueScore).toBe(7);
  });
  const getCalls = apiFetchMock.mock.calls.filter(
    ([p, o]) => p === "/api/demands/d1" && !o,
  );
  expect(getCalls.length >= 2).toBeTruthy();
});

test("the effort field is read-only for a viewer without TECHNICAL_APPROVER", async () => {
  wire();
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER"])}
    />,
  );

  await screen.findByText("Feasible within a sprint");
  expect(screen.queryByLabelText("Effort")).toBeNull();
  expect(screen.queryByLabelText("Feasibility")).toBeNull();
});

test("decision buttons are disabled until businessValue, effort, and cost of delay are all present", async () => {
  wire({
    demand: {
      ...demand,
      status: "TRIAGING",
      worth: {
        businessValue: "Some value",
        valueScore: null,
        effort: null,
        feasibility: null,
        costOfDelay: null,
        decision: null,
      },
    },
  });
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER", "TECHNICAL_APPROVER"])}
    />,
  );
  const pursue = await screen.findByRole("button", { name: "Pursue" });
  expect((pursue as HTMLButtonElement).disabled).toBeTruthy();

  cleanup();
  apiFetchMock.mockReset();
  wire({ demand: { ...demand, status: "WORTH_ASSESSED" } });
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER", "TECHNICAL_APPROVER"])}
    />,
  );
  const pursue2 = await screen.findByRole("button", { name: "Pursue" });
  expect((pursue2 as HTMLButtonElement).disabled).toBeFalsy();

  // …and disabled again once the demand is terminally decided — the server
  // would 403 a fresh decision, so the buttons must not invite the click.
  cleanup();
  apiFetchMock.mockReset();
  wire({
    demand: {
      ...demand,
      status: "APPROVED",
      worth: { ...demand.worth, decision: "PURSUE" },
    },
  });
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER", "TECHNICAL_APPROVER"])}
    />,
  );
  const pursue3 = await screen.findByRole("button", { name: "Pursue" });
  expect((pursue3 as HTMLButtonElement).disabled).toBeTruthy();
});

test("when the viewer is the submitter, clicking Pursue opens the override dialog; a >=20-char justification calls POST /decision with overrideJustification", async () => {
  wire({
    demand: { ...demand, status: "WORTH_ASSESSED", submittedById: "u1" },
  });
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["BUSINESS_APPROVER"], "u1")}
    />,
  );

  await userEvent.click(await screen.findByRole("button", { name: "Pursue" }));
  const just = await screen.findByLabelText("Override justification");
  const confirm = screen.getByRole("button", { name: /confirm override/i });
  expect((confirm as HTMLButtonElement).disabled).toBeTruthy();

  await userEvent.type(
    just,
    "CTO is on leave all week, recording this decision solo",
  );
  expect((confirm as HTMLButtonElement).disabled).toBeFalsy();
  await userEvent.click(confirm);

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/demands/d1/decision" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    const body = call![1]!.body as {
      decision: string;
      overrideJustification: string;
    };
    expect(body.decision).toBe("PURSUE");
    expect(body.overrideJustification.trim().length >= 20).toBeTruthy();
  });
});

test("a 409 segregation response from /decision (no justification) opens the override dialog", async () => {
  wire({
    demand: {
      ...demand,
      status: "WORTH_ASSESSED",
      submittedById: "someone-else",
    },
    onWrite: (path, o) => {
      if (
        path === "/api/demands/d1/decision" &&
        o?.method === "POST" &&
        !(o.body as { overrideJustification?: string }).overrideJustification
      ) {
        return Promise.reject(
          new ApiError(409, {
            error: "segregation",
            overrideAction: "demand.decide.override",
          }),
        );
      }
      return undefined;
    },
  });
  render(
    <DemandDrawer
      id="d1"
      open
      onClose={vi.fn()}
      viewer={internal(["TECHNICAL_APPROVER"], "viewer-2")}
    />,
  );

  await userEvent.click(await screen.findByRole("button", { name: "Pursue" }));
  expect(await screen.findByLabelText("Override justification")).toBeTruthy();
});
