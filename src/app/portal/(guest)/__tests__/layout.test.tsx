/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { redirect, getCurrentActor } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  getCurrentActor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/auth/current", () => ({ getCurrentActor }));

import GuestPortalLayout from "@/app/portal/(guest)/layout";

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

test("a guest session → renders the shell around the children", async () => {
  getCurrentActor.mockResolvedValue({
    id: "g1",
    kind: "GUEST",
    hats: [],
    clientId: "c1",
  });

  render(await GuestPortalLayout({ children: <p>portal content</p> }));

  expect(screen.getByText("portal content")).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
});
