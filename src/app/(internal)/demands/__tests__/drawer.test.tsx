/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandDrawer } from "@/app/(internal)/demands/DemandDrawer";
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

const demand = {
  id: "d1",
  ref: "DEM-0001",
  title: "Faster exports",
  problem: "Reports take 20 minutes to generate.",
  status: "TRIAGING",
  worth: {
    businessValue: "High leverage for the retention team",
    valueScore: 8,
    effort: "M",
    feasibility: "Feasible within a sprint",
    costOfDelay: "Grows every billing cycle",
  },
  activity: [{ time: "2026-09-06 10:00", text: "Demand raised" }],
};

/** Wire `apiFetch` for the two initial GETs plus the comment POST. */
function wire(initialComments: unknown[] = []) {
  apiFetchMock.mockImplementation((path, opts) => {
    if (path === "/api/demands/d1") return Promise.resolve(demand);
    if (path === "/api/demands/d1/comments" && opts?.method === "POST") {
      const body = (opts.body as { body: string }).body;
      return Promise.resolve({
        comments: [
          {
            id: "c1",
            body,
            createdAt: new Date().toISOString(),
            authorName: "Ada Lovelace",
            visibleToClient: true,
          },
        ],
      });
    }
    if (path === "/api/demands/d1/comments") {
      return Promise.resolve({ comments: initialComments });
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

test("opens with the demand's ref, title, problem, and a status pill", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} />);

  expect(await screen.findByText("DEM-0001")).toBeTruthy();
  expect(screen.getByText("Faster exports")).toBeTruthy();
  expect(screen.getByText("Reports take 20 minutes to generate.")).toBeTruthy();
  expect(screen.getByText("Triaging")).toBeTruthy();
});

test("renders the worth assessment panels read-only", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} />);

  expect(
    await screen.findByText("High leverage for the retention team"),
  ).toBeTruthy();
  expect(screen.getByText("Feasible within a sprint")).toBeTruthy();
  expect(screen.getByText("8/10")).toBeTruthy();
  // No editable controls for value / effort in this task.
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

test("renders the activity timeline from the demand's events", async () => {
  wire();
  render(<DemandDrawer id="d1" open onClose={vi.fn()} />);

  expect(await screen.findByText("Demand raised")).toBeTruthy();
  expect(screen.getByText("2026-09-06 10:00")).toBeTruthy();
});

test("posting a comment calls POST .../comments and shows the new comment", async () => {
  wire([]);
  render(<DemandDrawer id="d1" open onClose={vi.fn()} />);

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
