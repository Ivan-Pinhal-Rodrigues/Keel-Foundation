/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeRegister } from "@/app/(internal)/changes/ChangeRegister";
import { apiFetch } from "@/lib/api/client";
import pipStyles from "@/components/DataTable/LifecyclePips.module.css";

// `ChangeRegister` calls `useRouter()` (the chips write the URL so a reload is
// stable) and `useSearchParams()` (the `?open=<id>` deep link from `/approvals`).
// The repo carries no app-router test context, so stub both — one module-level
// `push` a test can assert on, and a `get` a test can steer.
const push = vi.fn();
const searchParamsGet = vi.fn<(key: string) => string | null>(() => null);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

// The stub drawer talks to `GET /api/changes/:id` through `apiFetch` (Global
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
  searchParamsGet.mockReset();
  searchParamsGet.mockReturnValue(null);
});

const rows = [
  {
    id: "c1",
    ref: "CHG-0001",
    title: "Rotate the signing keys",
    riskLevel: "HIGH" as const,
    status: "ASSESSING",
    stage: "assessing",
    originatingDemandRef: "DEM-0007",
    windowStart: null,
    windowEnd: null,
    ownerId: "u1",
    ownerName: "Ada Lovelace",
  },
  {
    id: "c2",
    ref: "CHG-0002",
    title: "Migrate the billing cron",
    riskLevel: "MEDIUM" as const,
    status: "SCHEDULED",
    stage: "scheduled",
    originatingDemandRef: null,
    windowStart: new Date(Date.now() + 3_600_000).toISOString(),
    windowEnd: new Date(Date.now() + 7_200_000).toISOString(),
    ownerId: "u9",
    ownerName: "Grace Hopper",
  },
  {
    id: "c3",
    ref: "CHG-0003",
    title: "Swap the load balancer",
    riskLevel: "LOW" as const,
    status: "ROLLED_BACK",
    stage: null,
    originatingDemandRef: null,
    windowStart: null,
    windowEnd: null,
    ownerId: "u1",
    ownerName: "Ada Lovelace",
  },
];

const viewer = { id: "u1", kind: "INTERNAL", hats: [] as string[] };

// The repo carries no @testing-library/jest-dom, so assert on truthiness / null.
test("renders a row per change with its ref, title, and risk label", () => {
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(screen.getByText("CHG-0001")).toBeTruthy();
  expect(screen.getByText("Rotate the signing keys")).toBeTruthy();
  expect(screen.getByText("CHG-0002")).toBeTruthy();
  expect(screen.getByText("Swap the load balancer")).toBeTruthy();
  expect(screen.getByText("HIGH")).toBeTruthy();
  expect(screen.getByText("MEDIUM")).toBeTruthy();
});

test("renders the owner column (spec 03 §8.1)", () => {
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(screen.getByText("Grace Hopper")).toBeTruthy();
});

test("the lifecycle pips mark the current stage of a mid-lifecycle change", () => {
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  // CHG-0002 is SCHEDULED — the 4th stage (index 3: Draft, Assess, Approval,
  // Scheduled, ...).
  const row = screen.getByText("CHG-0002").closest("tr");
  expect(row).toBeTruthy();
  const pips = [...row!.querySelectorAll(`.${pipStyles.pip}`)];
  expect(pips).toHaveLength(7);
  expect(pips[3]?.matches(`.${pipStyles.now}`)).toBe(true);
  expect(pips[0]?.matches(`.${pipStyles.past}`)).toBe(true);
  expect(pips[2]?.matches(`.${pipStyles.past}`)).toBe(true);
});

test("a rolled-back change shows the parked pip at the Implementing stage", () => {
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  const row = screen.getByText("Swap the load balancer").closest("tr");
  const pips = [...row!.querySelectorAll(`.${pipStyles.pip}`)];
  // Implementing is index 4.
  expect(pips[4]?.matches(`.${pipStyles.parked}`)).toBe(true);
});

test("the Mine chip filters to the viewer's own changes and pushes ?mine=true", async () => {
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^mine$/i }));
  expect(screen.getByText("Rotate the signing keys")).toBeTruthy();
  expect(screen.queryByText("Migrate the billing cron")).toBeNull();
  expect(push).toHaveBeenCalledWith("/changes?mine=true");
});

test("a ?open=<id> deep link mounts the drawer, which fetches the change", async () => {
  searchParamsGet.mockImplementation((key) => (key === "open" ? "c1" : null));
  apiFetchMock.mockResolvedValue({
    id: "c1",
    ref: "CHG-0001",
    title: "Rotate the signing keys",
    status: "ASSESSING",
    statusLabel: "Assessing",
  });
  render(
    <ChangeRegister initialRows={rows} initialFilters={{}} viewer={viewer} />,
  );
  expect(await screen.findByTestId("drawer-scrim")).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(([path]) => path === "/api/changes/c1"),
  ).toBe(true);
});
