/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrioritisationBoard } from "@/app/(internal)/demands/PrioritisationBoard";
import { apiFetch } from "@/lib/api/client";

// The board renders `<ViewToggle>`, which calls `useRouter()`. The repo carries
// no app-router test context, so stub the hook.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The board's cards open the same `<DemandDrawer>` as the register, which talks
// to the route handlers through `apiFetch` (Global Constraint) — mock that.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const rows = [
  {
    id: "d1",
    ref: "DEM-0001",
    title: "A",
    worth: { effort: "S", valueScore: 9 },
    status: "TRIAGING",
  },
  {
    id: "d2",
    ref: "DEM-0002",
    title: "B",
    worth: { effort: "L", valueScore: 3 },
    status: "TRIAGING",
  },
  {
    id: "d3",
    ref: "DEM-0003",
    title: "C",
    worth: { effort: null, valueScore: null },
    status: "SUBMITTED",
  },
];

// The repo carries no @testing-library/jest-dom, so assert on truthiness.
test("places each demand in the cell for its effort column and value-score band", () => {
  render(<PrioritisationBoard rows={rows} />);
  expect(within(screen.getByTestId("cell-S-high")).getByText("A")).toBeTruthy();
  expect(within(screen.getByTestId("cell-L-low")).getByText("B")).toBeTruthy();
  expect(
    within(screen.getByTestId("tray-unscored")).getByText("C"),
  ).toBeTruthy();
});

test("clicking a card opens the demand drawer", async () => {
  apiFetchMock.mockImplementation((path) => {
    if (path === "/api/demands/d1") {
      return Promise.resolve({
        id: "d1",
        ref: "DEM-0001",
        title: "A",
        problem: "Reports are slow.",
        status: "TRIAGING",
        activity: [],
      });
    }
    if (path === "/api/demands/d1/comments") {
      return Promise.resolve({ comments: [] });
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });

  render(
    <PrioritisationBoard
      rows={rows}
      viewer={{ id: "u", kind: "INTERNAL", hats: [] }}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /DEM-0001/i }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});
