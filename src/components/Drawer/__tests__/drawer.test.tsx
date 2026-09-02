/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "@/components/Drawer";
import { stubRadixEnv } from "@/test/dom";

stubRadixEnv();
afterEach(cleanup);

function renderDrawer(overrides: Partial<Parameters<typeof Drawer>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <Drawer
      open
      onClose={onClose}
      title="Migrate auth to mTLS"
      idLabel="CHG-2024-018"
      {...overrides}
    >
      <p>drawer body content</p>
    </Drawer>,
  );
  return { onClose };
}

test("renders nothing when open is false", () => {
  renderDrawer({ open: false });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("drawer body content")).toBeNull();
});

test("renders the title and children when open", () => {
  renderDrawer();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Migrate auth to mTLS")).toBeTruthy();
  expect(screen.getByText("drawer body content")).toBeTruthy();
});

test("Escape closes the drawer", async () => {
  const user = userEvent.setup();
  const { onClose } = renderDrawer();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking the overlay closes the drawer", async () => {
  const user = userEvent.setup();
  const { onClose } = renderDrawer();
  await user.click(screen.getByTestId("drawer-scrim"));
  expect(onClose).toHaveBeenCalled();
});
