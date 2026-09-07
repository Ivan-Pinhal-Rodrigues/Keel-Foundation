/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandRegister } from "@/app/(internal)/demands/DemandRegister";
import { apiFetch } from "@/lib/api/client";

// `DemandRegister` calls `useRouter()` (a chip / the view toggle also write the
// URL so a reload is stable) and `useSearchParams()` (the `?open=<id>` deep link
// the Overview my-queue builds). The repo carries no app-router test context, so
// stub both — one module-level `push` a test can assert on, and a `get` a test
// can steer.
const push = vi.fn();
const searchParamsGet = vi.fn<(key: string) => string | null>(() => null);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

// The drawer talks to `GET /api/demands/:id` through `apiFetch` (Global
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
    id: "d1",
    ref: "DEM-0001",
    title: "Faster exports",
    source: "CLIENT",
    clientName: "Northwind",
    status: "TRIAGING",
    worth: { effort: "M", valueScore: 8 },
    createdAt: new Date().toISOString(),
  },
  {
    id: "d2",
    ref: "DEM-0002",
    title: "Audit log export",
    source: "COMPLIANCE",
    clientName: null,
    status: "APPROVED",
    worth: { effort: "S", valueScore: 5 },
    createdAt: new Date().toISOString(),
  },
];

// The repo carries no @testing-library/jest-dom, so assert on truthiness /
// null rather than `toBeInTheDocument()`.
test("renders a row per demand with ref, title, source, status", () => {
  render(
    <DemandRegister
      initialRows={rows}
      initialFilters={{}}
      viewer={{ id: "u1", kind: "INTERNAL", hats: [] }}
    />,
  );
  expect(screen.getByText("DEM-0001")).toBeTruthy();
  expect(screen.getByText("Faster exports")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
});

test("the status filter chip narrows the visible rows", async () => {
  render(
    <DemandRegister
      initialRows={rows}
      initialFilters={{}}
      viewer={{ id: "u1", kind: "INTERNAL", hats: [] }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /approved/i }));
  expect(screen.queryByText("Faster exports")).toBeNull();
  expect(screen.getByText("Audit log export")).toBeTruthy();
});

test("the Board toggle routes to ?view=board, preserving the active status filter", async () => {
  render(
    <DemandRegister
      initialRows={rows}
      initialFilters={{}}
      viewer={{ id: "u1", kind: "INTERNAL", hats: [] }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /approved/i }));
  push.mockClear();
  await userEvent.click(screen.getByRole("button", { name: /^board$/i }));
  expect(push).toHaveBeenCalledWith("/demands?status=APPROVED&view=board");
});

test("a ?open=<id> deep link mounts the drawer, which fetches the demand", async () => {
  searchParamsGet.mockImplementation((key) => (key === "open" ? "d1" : null));
  apiFetchMock.mockImplementation((path) => {
    if (path === "/api/demands/d1/comments") {
      return Promise.resolve({ comments: [] });
    }
    return Promise.resolve({
      id: "d1",
      ref: "DEM-0001",
      title: "Faster exports",
      problem: "Reports take 20 minutes to generate.",
      status: "TRIAGING",
      submittedById: "someone-else",
      worth: null,
      activity: [],
    });
  });
  render(
    <DemandRegister
      initialRows={rows}
      initialFilters={{}}
      viewer={{ id: "u1", kind: "INTERNAL", hats: [] }}
    />,
  );
  expect(await screen.findByTestId("drawer-scrim")).toBeTruthy();
  expect(
    apiFetchMock.mock.calls.some(([path]) => path === "/api/demands/d1"),
  ).toBe(true);
});
