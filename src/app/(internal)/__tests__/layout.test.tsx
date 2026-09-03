/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { redirect, getCurrentActor, whoami } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  getCurrentActor: vi.fn(),
  whoami: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/demands",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/auth/current", () => ({ getCurrentActor, whoami }));

import InternalLayout from "@/app/(internal)/layout";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("no session → redirects to /login", async () => {
  getCurrentActor.mockResolvedValue(null);
  await expect(InternalLayout({ children: null })).rejects.toThrow(
    "redirect:/login",
  );
});

test("a guest session → redirects to /portal", async () => {
  getCurrentActor.mockResolvedValue({
    id: "g1",
    kind: "GUEST",
    hats: [],
    clientId: "c1",
  });
  await expect(InternalLayout({ children: null })).rejects.toThrow(
    "redirect:/portal",
  );
});

test("a dead session mid-render (whoami null) → redirects to /login", async () => {
  getCurrentActor.mockResolvedValue({
    id: "u1",
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  });
  whoami.mockResolvedValue(null);
  await expect(InternalLayout({ children: null })).rejects.toThrow(
    "redirect:/login",
  );
});

test("an internal session → renders the shell with display name, hats, nav and children", async () => {
  getCurrentActor.mockResolvedValue({
    id: "u1",
    kind: "INTERNAL",
    hats: ["DEVELOPER", "REVIEWER"],
    clientId: null,
  });
  whoami.mockResolvedValue({
    id: "u1",
    kind: "INTERNAL",
    hats: ["DEVELOPER", "REVIEWER"],
    clientId: null,
    displayName: "Dana Dev",
    email: "dana@keel.local",
  });

  render(await InternalLayout({ children: <p>inner content</p> }));

  expect(screen.getByText("Dana Dev")).toBeTruthy();
  expect(screen.getByText("Developer · Reviewer")).toBeTruthy();
  expect(screen.getByText("inner content")).toBeTruthy();
  const navLink = screen.getByRole("link", { name: /demand/i });
  expect(navLink.getAttribute("href")).toBe("/demands");
  expect(navLink.getAttribute("aria-current")).toBe("page");
});

test("hatSummary shows an em dash when the actor holds no hats", async () => {
  getCurrentActor.mockResolvedValue({
    id: "u2",
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  });
  whoami.mockResolvedValue({
    id: "u2",
    kind: "INTERNAL",
    hats: [],
    clientId: null,
    displayName: "Sam Support",
    email: "sam@keel.local",
  });

  render(await InternalLayout({ children: null }));
  expect(screen.getByText("—")).toBeTruthy();
});
