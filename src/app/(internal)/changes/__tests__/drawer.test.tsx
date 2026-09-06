/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeDrawer } from "@/app/(internal)/changes/ChangeDrawer";
import { ApiError, apiFetch } from "@/lib/api/client";
import { stubRadixEnv } from "@/test/dom";
import stepStyles from "@/components/LifecycleStepper/LifecycleStepper.module.css";

// The drawer talks to the route handlers through `apiFetch` (Global
// Constraint), so mock that — not `globalThis.fetch`. Keep `ApiError` real so
// the component's `instanceof ApiError` branch still works.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

stubRadixEnv();

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const OWNER = "u-owner";

function stepperStages() {
  return [
    {
      key: "draft",
      label: "Draft",
      purpose: "Capture the change and write its RFC.",
      gate: [
        { key: "rfc", label: "RFC written", done: true },
        {
          key: "origin",
          label: "Linked to a demand, or confirmed as a standalone change",
          done: false,
        },
      ],
    },
    {
      key: "assessing",
      label: "Assess",
      purpose: "Assess risk and impact, and prepare the rollback plan.",
      gate: [
        { key: "riskLevel", label: "Risk level set", done: true },
        {
          key: "impactAssessment",
          label: "Impact assessment written",
          done: true,
        },
        { key: "rollbackPlan", label: "Rollback plan written", done: true },
      ],
    },
    {
      key: "approval",
      label: "Approval",
      purpose: "Obtain the approvals the change policy requires.",
      gate: [{ key: "approved", label: "Approval granted", done: false }],
    },
    {
      key: "scheduled",
      label: "Scheduled",
      purpose: "Book a change window and keep the rollback plan in place.",
      gate: [
        {
          key: "window",
          label: "A future change window with a start before its end",
          done: false,
        },
        {
          key: "rollbackPlan",
          label: "Rollback plan still in place",
          done: true,
        },
      ],
    },
    {
      key: "implementing",
      label: "Implementing",
      purpose: "Carry out the change during its window.",
      gate: [
        {
          key: "wentToPlanAcknowledged",
          label: "The change went to plan",
          done: false,
        },
      ],
    },
    {
      key: "pir",
      label: "PIR",
      purpose: "Review the outcome and record the lessons learned.",
      gate: [
        { key: "valueRealized", label: "Value realized recorded", done: false },
        { key: "lessons", label: "Lessons learned written", done: false },
      ],
    },
    {
      key: "closed",
      label: "Closed",
      purpose: "The change is complete and closed.",
      gate: [],
    },
  ];
}

const noApproval = {
  status: null,
  steps: [],
  currentStep: null,
  needsOverride: false,
};

function makeChange(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    ref: "CHG-0001",
    title: "Rotate the signing keys",
    changeType: "NORMAL",
    rfc: "Rotate keys via the runbook.",
    riskLevel: "HIGH",
    impactAssessment: "Brief outage window.",
    rollbackPlan: "Restore the previous keys from backup.",
    testPlan: null,
    status: "ASSESSING",
    statusLabel: "Assessing",
    ownerId: OWNER,
    windowStart: null,
    windowEnd: null,
    originatingDemandId: null,
    implementedAt: null,
    closedAt: null,
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    stage: "assessing",
    approval: noApproval,
    linkedIncidents: [],
    originatingDemand: null,
    activity: [{ time: "2026-09-06 10:00", text: "Change created" }],
    stepper: {
      stages: stepperStages(),
      currentStageKey: "assessing",
      canAdvance: false,
    },
    ...overrides,
  };
}

type WireOpts = { change?: Record<string, unknown>; comments?: unknown[] };

function wire(opts: WireOpts = {}) {
  const change = opts.change ?? makeChange();
  const log: unknown[] = [...(opts.comments ?? [])];
  apiFetchMock.mockImplementation((path, o) => {
    if (path === "/api/changes/c1" && !o) return Promise.resolve(change);
    if (path === "/api/changes/c1/comments" && o?.method === "POST") {
      const body = (o.body as { body: string }).body;
      log.push({
        id: `k${log.length + 1}`,
        body,
        createdAt: new Date().toISOString(),
        authorName: "Rey Reviewer",
        visibleToClient: false,
      });
      return Promise.resolve({ comments: [...log] });
    }
    if (path === "/api/changes/c1/comments") {
      return Promise.resolve({ comments: [...log] });
    }
    // Every write endpoint the drawer can call.
    if (o?.method === "POST" || o?.method === "PATCH") {
      return Promise.resolve({ ok: true });
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

const viewer = (hats: string[], id = "v1") => ({
  id,
  kind: "INTERNAL" as const,
  hats,
});

test("opens with the change's ref, title, risk label, and status pill", async () => {
  wire();
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  expect(await screen.findByText("CHG-0001")).toBeTruthy();
  expect(screen.getByText("Rotate the signing keys")).toBeTruthy();
  expect(screen.getByText("HIGH")).toBeTruthy();
  expect(screen.getByText("Assessing")).toBeTruthy();
});

test("the RFC field is an editable textarea for the owner and read-only prose for a non-owner non-DEVELOPER", async () => {
  wire();
  const { unmount } = render(
    <ChangeDrawer id="c1" open onClose={vi.fn()} viewer={viewer([], OWNER)} />,
  );
  const field = await screen.findByLabelText("RFC");
  expect(field.tagName).toBe("TEXTAREA");
  unmount();
  cleanup();
  apiFetchMock.mockReset();

  wire();
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer([], "someone-else")}
    />,
  );
  await screen.findByText("CHG-0001");
  expect(screen.queryByLabelText("RFC")).toBeNull();
  expect(screen.getByText("Rotate keys via the runbook.")).toBeTruthy();
});

test("the lifecycle stepper renders the 7 stages; Advance is disabled and shows the blockedReason", async () => {
  const change = makeChange({
    status: "APPROVAL",
    statusLabel: "In approval",
    stepper: {
      stages: stepperStages().map((s) =>
        s.key === "approval"
          ? {
              ...s,
              gate: [
                { key: "approved", label: "Approval granted", done: true },
              ],
            }
          : s,
      ),
      currentStageKey: "approval",
      canAdvance: false,
      blockedReason: "Waiting on approval",
    },
  });
  wire({ change });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  await screen.findByText("CHG-0001");
  // The drawer portals into document.body, so query there — not the render container.
  await waitFor(() =>
    expect(document.querySelectorAll(`.${stepStyles.step}`)).toHaveLength(7),
  );
  const advance = screen.getByRole("button", { name: /advance/i });
  expect((advance as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Waiting on approval")).toBeTruthy();
});

test("a standalone DRAFT: Advance is disabled until the standalone gate is checked, then POSTs /advance with the acknowledgement", async () => {
  // The real serializer NEVER ships `canAdvance: true` here — the free ack
  // (`standaloneConfirmed`) is hard-coded false server-side and the origin gate
  // item is not done — so the fixture must match that. The drawer re-derives an
  // effective `canAdvance` from the LOCAL checkbox state.
  const change = makeChange({
    status: "DRAFT",
    statusLabel: "Draft",
    stepper: {
      stages: stepperStages(),
      currentStageKey: "draft",
      canAdvance: false,
    },
  });
  wire({ change });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  await screen.findByText("CHG-0001");
  const advance = await screen.findByRole("button", { name: /advance/i });
  expect((advance as HTMLButtonElement).disabled).toBe(true);

  const box = await screen.findByRole("checkbox", { name: /standalone/i });
  await userEvent.click(box);

  await waitFor(() =>
    expect((advance as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(advance);

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/changes/c1/advance" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    const body = call![1]!.body as {
      from: string;
      acknowledgements: Record<string, boolean>;
    };
    expect(body.from).toBe("DRAFT");
    expect(body.acknowledgements.standaloneConfirmed).toBe(true);
  });
});

test("an IMPLEMENTING change: Advance is disabled until the 'went to plan' gate is checked, then POSTs /advance with the acknowledgement", async () => {
  const change = makeChange({
    status: "IMPLEMENTING",
    statusLabel: "Implementing",
    originatingDemandId: "d-1",
    stepper: {
      stages: stepperStages(),
      currentStageKey: "implementing",
      canAdvance: false,
    },
  });
  wire({ change });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  await screen.findByText("CHG-0001");
  const advance = await screen.findByRole("button", { name: /advance/i });
  expect((advance as HTMLButtonElement).disabled).toBe(true);

  const box = await screen.findByRole("checkbox", { name: /went to plan/i });
  await userEvent.click(box);

  await waitFor(() =>
    expect((advance as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(advance);

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/changes/c1/advance" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    const body = call![1]!.body as {
      from: string;
      acknowledgements: Record<string, boolean>;
    };
    expect(body.from).toBe("IMPLEMENTING");
    expect(body.acknowledgements.wentToPlanAcknowledged).toBe(true);
  });
});

test("an advance that 409-conflicts shows the inline 'moved since you opened it' message and refetches", async () => {
  const change = makeChange({
    status: "IMPLEMENTING",
    statusLabel: "Implementing",
    originatingDemandId: "d-1",
    stepper: {
      stages: stepperStages(),
      currentStageKey: "implementing",
      canAdvance: false,
    },
  });
  let getCount = 0;
  apiFetchMock.mockImplementation((path, o) => {
    if (path === "/api/changes/c1" && !o) {
      getCount += 1;
      return Promise.resolve(change);
    }
    if (path === "/api/changes/c1/advance" && o?.method === "POST") {
      return Promise.reject(new ApiError(409, { error: "conflict" }));
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  await screen.findByText("CHG-0001");
  await userEvent.click(
    await screen.findByRole("checkbox", { name: /went to plan/i }),
  );
  await userEvent.click(screen.getByRole("button", { name: /advance/i }));

  expect(await screen.findByText(/moved since you opened it/i)).toBeTruthy();
  await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2));
});

test("the ApprovalPanel offers Approve/Reject to the current step's hat holder; a decision POSTs /approve/technical", async () => {
  const change = makeChange({
    status: "APPROVAL",
    statusLabel: "In approval",
    approval: {
      status: "PENDING",
      steps: [
        {
          id: "s1",
          order: 1,
          requiredHat: "TECHNICAL_APPROVER",
          status: "PENDING",
          decision: null,
        },
      ],
      currentStep: { id: "s1", requiredHat: "TECHNICAL_APPROVER" },
      needsOverride: false,
    },
  });
  wire({ change });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["TECHNICAL_APPROVER"], "v-tech")}
    />,
  );

  const approve = await screen.findByRole("button", { name: "Approve" });
  expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  await userEvent.click(approve);
  await userEvent.type(
    screen.getByLabelText(/reason/i),
    "rollback plan checks out",
  );
  await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) =>
        p === "/api/changes/c1/approve/technical" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    const body = call![1]!.body as { decision: string; reason: string };
    expect(body.decision).toBe("APPROVED");
    expect(body.reason).toBe("rollback plan checks out");
  });
});

test("an empty rollback plan shows the loud 'Required before approval' empty state", async () => {
  wire({ change: makeChange({ rollbackPlan: null }) });
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["DEVELOPER"], OWNER)}
    />,
  );

  expect(await screen.findByText("Required before approval")).toBeTruthy();
});

test("a REVIEWER can post a review comment — it POSTs /comments and appears", async () => {
  wire();
  render(
    <ChangeDrawer
      id="c1"
      open
      onClose={vi.fn()}
      viewer={viewer(["REVIEWER"], "v-rev")}
    />,
  );

  const field = await screen.findByLabelText("Add a review comment");
  await userEvent.type(field, "Please double-check the window");
  await userEvent.click(screen.getByRole("button", { name: /post comment/i }));

  expect(
    await screen.findByText("Please double-check the window"),
  ).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(
      ([p, o]) => p === "/api/changes/c1/comments" && o?.method === "POST",
    ),
  ).toBe(true);
});
