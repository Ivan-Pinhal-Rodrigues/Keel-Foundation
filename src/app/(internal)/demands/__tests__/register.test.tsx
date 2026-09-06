/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandRegister } from "@/app/(internal)/demands/DemandRegister";

// `DemandRegister` calls `useRouter()` (a chip / the view toggle also write the
// URL so a reload is stable). The repo carries no app-router test context, so
// stub the hook — one module-level `push` so a test can assert on it.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
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
