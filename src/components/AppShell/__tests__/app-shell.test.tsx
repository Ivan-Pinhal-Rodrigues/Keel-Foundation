/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShell, type NavItem } from "@/components/AppShell";

afterEach(cleanup);

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

test("renders each nav item as a link, marks the current one, and places topbar + children", () => {
  renderShell("changes");

  for (const item of NAV) {
    const link = screen.getByRole("link", {
      name: new RegExp(item.label, "i"),
    });
    expect(link.getAttribute("href")).toBe(item.href);
    expect(link.getAttribute("aria-current")).toBe(
      item.key === "changes" ? "page" : null,
    );
  }

  expect(screen.getByText("3")).toBeTruthy(); // nav badge
  expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy(); // topbar
  expect(screen.getByText("stage content")).toBeTruthy(); // children
});

test("renders the user identity in the rail", () => {
  renderShell();
  expect(screen.getByText("Kai R.")).toBeTruthy();
  expect(screen.getByText(/technical lead/i)).toBeTruthy();
});

// TODO(phase-2 e2e): viewport test for the <=920px bottom-bar against
// /dev/components (Playwright). The switch is pure CSS (@media in
// AppShell.module.css); jsdom does not evaluate media queries, so it cannot be
// asserted meaningfully here.
