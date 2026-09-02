/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShell, type NavItem } from "@/components/AppShell";
import { stubMatchMedia } from "@/test/dom";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NAV: NavItem[] = [
  { key: "overview", label: "Overview", href: "/overview", icon: <svg /> },
  {
    key: "changes",
    label: "Changes",
    href: "/changes",
    icon: <svg />,
    badge: 3,
  },
  { key: "incidents", label: "Incidents", href: "/incidents", icon: <svg /> },
];
const USER = { name: "Kai R.", sub: "technical lead" };

function renderShell(currentKey = "overview") {
  stubMatchMedia(false);
  return render(
    <AppShell
      nav={NAV}
      currentKey={currentKey}
      user={USER}
      topbar={<h1>Overview</h1>}
    >
      <p>stage content</p>
    </AppShell>,
  );
}

test("renders every nav item, the badge, the topbar and the children", () => {
  renderShell();
  for (const item of NAV) {
    expect(
      screen.getByRole("link", { name: new RegExp(item.label, "i") }),
    ).toBeTruthy();
  }
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
  expect(screen.getByText("stage content")).toBeTruthy();
});

test("renders the user identity in the rail", () => {
  renderShell();
  expect(screen.getByText("Kai R.")).toBeTruthy();
  expect(screen.getByText(/technical lead/i)).toBeTruthy();
});

test("marks only the current nav item with aria-current=page", () => {
  renderShell("changes");
  expect(
    screen.getByRole("link", { name: /changes/i }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    screen
      .getByRole("link", { name: /overview/i })
      .getAttribute("aria-current"),
  ).toBeNull();
});

test("keys off matchMedia for the <=920px bottom-bar layout", () => {
  stubMatchMedia((q) => q.includes("920"));
  const { container } = render(
    <AppShell nav={NAV} currentKey="overview" user={USER} topbar={null}>
      <p>x</p>
    </AppShell>,
  );
  expect(container.querySelector('[data-mobile="true"]')).not.toBeNull();
});

test("stays in the desktop layout when the breakpoint does not match", () => {
  const { container } = renderShell();
  expect(container.querySelector('[data-mobile="true"]')).toBeNull();
});
