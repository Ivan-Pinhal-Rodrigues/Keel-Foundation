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
      label="Changes"
    />,
  );
  return { onRowClick };
}

/** The visually-hidden activator buttons, one per row, named `Open …`. */
const activators = () => screen.getAllByRole("button", { name: /open/i });

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
  expect(activators()).toHaveLength(2); // one activator button per row
  expect(
    err.mock.calls.some((c) => String(c[0]).toLowerCase().includes("key")),
  ).toBe(false);
  err.mockRestore();
});

test("with onRowClick: an activator button per row calls it with that row", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  render(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(r) => r.id}
      onRowClick={onRowClick}
      label="Changes"
    />,
  );

  const btns = activators();
  expect(btns).toHaveLength(2);
  // the label is `Open <label>: <first-column text>`
  expect(btns[0]?.getAttribute("aria-label")).toBe("Open Changes: CHG-1");

  await user.click(btns[0]!);
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

  // the <tr> is a plain row — not itself a button, not focusable
  const bodyRow = screen.getAllByRole("row")[1];
  expect(bodyRow?.hasAttribute("role")).toBe(false);
  expect(bodyRow?.hasAttribute("tabindex")).toBe(false);
});

test("a click on a plain cell activates the whole row", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  renderTable(onRowClick);

  // "Rotate certs" is ROWS[1]'s title cell — a plain, non-interactive cell.
  // The guarded onClick on the <tr> is the mouse path to onRowClick.
  await user.click(screen.getByText("Rotate certs"));
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
});

test("a plain-cell click still activates a row that also has an actions column", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  const withAction: Column<Row>[] = [
    ...COLUMNS,
    {
      key: "act",
      header: "",
      cell: (r) => (
        <button type="button" onClick={() => {}}>
          edit {r.id}
        </button>
      ),
    },
  ];
  render(
    <DataTable
      columns={withAction}
      rows={ROWS}
      getRowId={(r) => r.id}
      onRowClick={onRowClick}
      label="Changes"
    />,
  );

  // a plain cell in the row still activates it...
  await user.click(screen.getByText("Migrate auth"));
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

  // ...but the actions button in that same row does not fire it again
  await user.click(screen.getByRole("button", { name: /edit CHG-1/i }));
  expect(onRowClick).toHaveBeenCalledTimes(1);
});

test("onRowClick fires with the exact row object on keyboard activation", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  renderTable(onRowClick);
  const btns = activators();
  expect(btns).toHaveLength(2);

  btns[1]?.focus();
  await user.keyboard("{Enter}");
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);

  onRowClick.mockClear();
  btns[0]?.focus();
  await user.keyboard(" ");
  expect(onRowClick).toHaveBeenCalledTimes(1);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
});

test("without onRowClick: no activator, no tabindex, rows are inert", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  for (const bodyRow of screen.getAllByRole("row").slice(1)) {
    expect(bodyRow.hasAttribute("role")).toBe(false);
    expect(bodyRow.hasAttribute("tabindex")).toBe(false);
  }
});

test("an interactive cell does not trigger onRowClick", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  const withAction: Column<Row>[] = [
    ...COLUMNS,
    {
      key: "act",
      header: "",
      cell: (r) => (
        <button type="button" onClick={() => {}}>
          edit {r.id}
        </button>
      ),
    },
  ];
  render(
    <DataTable
      columns={withAction}
      rows={ROWS}
      getRowId={(r) => r.id}
      onRowClick={onRowClick}
    />,
  );

  await user.click(screen.getByRole("button", { name: /edit CHG-1/i }));
  expect(onRowClick).not.toHaveBeenCalled();
});

test("the activator label falls back to `Open <label>` when the first cell is not plain text", () => {
  const cols: Column<Row>[] = [
    {
      key: "id",
      header: "ID",
      cell: (r) => <span className="mono">{r.id}</span>,
    },
    { key: "title", header: "Title", cell: (r) => r.title },
  ];
  render(
    <DataTable
      columns={cols}
      rows={ROWS}
      getRowId={(r) => r.id}
      onRowClick={vi.fn()}
      label="Change register"
    />,
  );
  for (const btn of activators()) {
    expect(btn.getAttribute("aria-label")).toBe("Open Change register");
  }
});

test("names the table via aria-label only when label is given", () => {
  const { rerender } = render(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      onRowClick={vi.fn()}
      getRowId={(r) => r.id}
    />,
  );
  expect(screen.getByRole("table").hasAttribute("aria-label")).toBe(false);

  rerender(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      onRowClick={vi.fn()}
      getRowId={(r) => r.id}
      label="Change register"
    />,
  );
  expect(screen.getByRole("table", { name: "Change register" })).toBeTruthy();
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
