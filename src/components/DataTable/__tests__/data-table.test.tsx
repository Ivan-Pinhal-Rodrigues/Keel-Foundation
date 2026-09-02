/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, LifecyclePips } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import pipStyles from "@/components/DataTable/LifecyclePips.module.css";

afterEach(cleanup);

type Row = { id: string; title: string; owner: string };

const ROWS: Row[] = [
  { id: "CHG-1", title: "Migrate auth", owner: "Kai" },
  { id: "CHG-2", title: "Rotate certs", owner: "Devon" },
];

const COLUMNS: Column<Row>[] = [
  { key: "id", header: "ID", cell: (r) => r.id },
  { key: "title", header: "Title", cell: (r) => r.title },
  { key: "owner", header: "Owner", cell: (r) => r.owner },
];

function renderTable(onRowClick: (row: Row) => void = vi.fn()) {
  render(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      onRowClick={onRowClick}
      getRowId={(r) => r.id}
    />,
  );
  return { onRowClick };
}

test("renders one header cell per column and one body cell per column per row", () => {
  renderTable();
  const headers = screen.getAllByRole("columnheader");
  expect(headers.map((h) => h.textContent)).toEqual(["ID", "Title", "Owner"]);

  expect(screen.getAllByRole("cell")).toHaveLength(6); // 2 rows x 3 cols
  expect(screen.getByText("Migrate auth")).toBeTruthy();
  expect(screen.getByText("Devon")).toBeTruthy();
});

test("both rows render without a missing-key warning", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  renderTable();
  expect(screen.getByText("Migrate auth")).toBeTruthy();
  expect(screen.getByText("Rotate certs")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2); // one activatable row each
  expect(
    err.mock.calls.some((c) => String(c[0]).toLowerCase().includes("key")),
  ).toBe(false);
  err.mockRestore();
});

test("onRowClick fires with the exact row object on click", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  renderTable(onRowClick);
  await user.click(screen.getByText("Migrate auth"));
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
});

test("onRowClick fires with the exact row object on keyboard activation", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  renderTable(onRowClick);
  const rows = screen.getAllByRole("button");
  expect(rows).toHaveLength(2);

  rows[1]?.focus();
  await user.keyboard("{Enter}");
  expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);

  onRowClick.mockClear();
  rows[0]?.focus();
  await user.keyboard(" ");
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
});

test("applies a column width when given", () => {
  const cols: Column<Row>[] = [
    { key: "id", header: "ID", width: "80px", cell: (r) => r.id },
    { key: "title", header: "Title", cell: (r) => r.title },
  ];
  const { container } = render(
    <DataTable
      columns={cols}
      rows={ROWS}
      onRowClick={vi.fn()}
      getRowId={(r) => r.id}
    />,
  );
  expect(container.querySelector("col")?.getAttribute("style")).toContain(
    "80px",
  );
});

test("LifecyclePips marks past / now / parked", () => {
  const stages = ["Intake", "Assess", "Build", "Deploy"];
  const { container, rerender } = render(
    <LifecyclePips stages={stages} currentIndex={2} />,
  );
  const pipAt = (i: number) =>
    [...container.querySelectorAll(`.${pipStyles.pip}`)][i];

  expect(container.querySelectorAll(`.${pipStyles.pip}`)).toHaveLength(4);
  expect(pipAt(0)?.matches(`.${pipStyles.past}`)).toBe(true);
  expect(pipAt(1)?.matches(`.${pipStyles.past}`)).toBe(true);
  expect(pipAt(2)?.matches(`.${pipStyles.now}`)).toBe(true);
  expect(pipAt(2)?.matches(`.${pipStyles.past}`)).toBe(false);
  expect(pipAt(3)?.matches(`.${pipStyles.now}`)).toBe(false);
  expect(pipAt(3)?.matches(`.${pipStyles.past}`)).toBe(false);
  expect(pipAt(3)?.matches(`.${pipStyles.parked}`)).toBe(false);

  rerender(<LifecyclePips stages={stages} currentIndex={2} parkedIndex={3} />);
  expect(pipAt(3)?.matches(`.${pipStyles.parked}`)).toBe(true);
});
