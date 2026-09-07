/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { stubRadixEnv } from "@/test/dom";

const { redirect, getCurrentActor, whoami } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  getCurrentActor: vi.fn(),
  whoami: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/auth/current", () => ({ getCurrentActor, whoami }));

// `<PortalTopBar>` mounts `<NotificationBell>`, which polls through `apiFetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn().mockResolvedValue(null) };
});

import GuestPortalLayout from "@/app/portal/(guest)/layout";
import { PortalTopBar } from "@/app/portal/(guest)/PortalTopBar";

stubRadixEnv();
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("no session → redirects to /login", async () => {
  getCurrentActor.mockResolvedValue(null);
  await expect(GuestPortalLayout({ children: null })).rejects.toThrow(
    "redirect:/login",
  );
});

test("an internal session → redirects to /overview", async () => {
  getCurrentActor.mockResolvedValue({
    id: "u1",
    kind: "INTERNAL",
    hats: ["DEVELOPER"],
    clientId: null,
  });
  await expect(GuestPortalLayout({ children: null })).rejects.toThrow(
    "redirect:/overview",
  );
});

test("a dead session mid-render (whoami null) → redirects to /login", async () => {
  getCurrentActor.mockResolvedValue({
    id: "g1",
    kind: "GUEST",
    hats: [],
    clientId: "c1",
  });
  whoami.mockResolvedValue(null);
  await expect(GuestPortalLayout({ children: null })).rejects.toThrow(
    "redirect:/login",
  );
});

test("a guest session → renders the top bar around the children", async () => {
  getCurrentActor.mockResolvedValue({
    id: "g1",
    kind: "GUEST",
    hats: [],
    clientId: "c1",
  });
  whoami.mockResolvedValue({
    id: "g1",
    kind: "GUEST",
    hats: [],
    clientId: "c1",
    clientName: "Northwind Traders",
    displayName: "Nadia",
    email: "nadia@northwind.example",
  });

  render(await GuestPortalLayout({ children: <p>portal content</p> }));

  expect(screen.getByText("portal content")).toBeTruthy();
  expect(screen.getByText("Northwind Traders")).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
});

test("PortalTopBar shows the client org name", () => {
  render(<PortalTopBar clientName="Northwind Traders" displayName="Nadia" />);
  expect(screen.getByText("Northwind Traders")).toBeTruthy();
});

test("PortalTopBar nav links point at the portal routes", () => {
  render(<PortalTopBar clientName="Northwind Traders" displayName="Nadia" />);
  expect(
    screen.getByRole("link", { name: "My requests" }).getAttribute("href"),
  ).toBe("/portal/demands");
  expect(
    screen.getByRole("link", { name: "My incidents" }).getAttribute("href"),
  ).toBe("/portal/incidents");
  expect(
    screen.getByRole("link", { name: "Submit" }).getAttribute("href"),
  ).toBe("/portal/submit");
});

test("PortalTopBar renders the notification bell", () => {
  render(<PortalTopBar clientName="Northwind Traders" displayName="Nadia" />);
  expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
});

test("PortalTopBar account menu shows the display name and a sign-out control", () => {
  render(<PortalTopBar clientName="Northwind Traders" displayName="Nadia" />);
  // `displayName` appears both in the trigger and the menu body.
  expect(screen.getAllByText("Nadia").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
});

test("PortalTopBar without a client org name omits it", () => {
  render(<PortalTopBar clientName={null} displayName="Nadia" />);
  expect(screen.queryByText("Northwind Traders")).toBeNull();
});
