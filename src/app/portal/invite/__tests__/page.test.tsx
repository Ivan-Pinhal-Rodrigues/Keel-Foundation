/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvitePage from "@/app/portal/invite/[token]/page";
import { RedeemForm } from "@/app/portal/invite/[token]/RedeemForm";
import { clientForInviteToken } from "@/server/auth/invites";

vi.mock("@/server/auth/invites", () => ({
  clientForInviteToken: vi.fn(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPage = async (token: string) => {
  const ui = await InvitePage({ params: Promise.resolve({ token }) });
  render(ui);
};

test("the page shows the invalid-invite copy when the token does not resolve", async () => {
  vi.mocked(clientForInviteToken).mockResolvedValue(null);

  await renderPage("dead-token");

  expect(screen.getByText(/no longer valid/i)).toBeTruthy();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
});

test("the page shows the inviting client and the redeem form for a live token", async () => {
  vi.mocked(clientForInviteToken).mockResolvedValue({
    clientName: "Umbrella Corp",
  });

  await renderPage("live-token");

  expect(screen.getByRole("heading").textContent).toMatch(/Umbrella Corp/);
  expect(screen.getByLabelText(/your name/i)).toBeTruthy();
  expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
  expect(screen.getByLabelText(/confirm password/i)).toBeTruthy();
});

test("RedeemForm refuses to submit when the passwords differ", async () => {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  render(<RedeemForm token="tok" />);

  await user.type(screen.getByLabelText(/your name/i), "Jill");
  await user.type(screen.getByLabelText(/^password$/i), "valentine123");
  await user.type(screen.getByLabelText(/confirm password/i), "nemesis00000");
  await user.click(screen.getByRole("button"));

  expect(screen.getByRole("alert").textContent).toMatch(/match/i);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

test("RedeemForm posts to the redeem endpoint and routes to /portal on 200", async () => {
  const user = userEvent.setup();
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

  render(<RedeemForm token="tok-abc" />);
  await user.type(screen.getByLabelText(/your name/i), "Chris");
  await user.type(screen.getByLabelText(/^password$/i), "redfield12345");
  await user.type(screen.getByLabelText(/confirm password/i), "redfield12345");
  await user.click(screen.getByRole("button"));

  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/guest-invites/tok-abc/redeem",
    expect.objectContaining({ method: "POST" }),
  );
  const body = JSON.parse(
    (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string,
  );
  expect(body).toEqual({ name: "Chris", password: "redfield12345" });
  expect(push).toHaveBeenCalledWith("/portal");
  // Stays disabled after a successful redeem — no second submit during nav.
  expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  fetchSpy.mockRestore();
});

test("RedeemForm shows the invalid-link message on a 410", async () => {
  const user = userEvent.setup();
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ error: "gone" }), { status: 410 }),
    );

  render(<RedeemForm token="tok" />);
  await user.type(screen.getByLabelText(/your name/i), "Leon");
  await user.type(screen.getByLabelText(/^password$/i), "raccooncity1");
  await user.type(screen.getByLabelText(/confirm password/i), "raccooncity1");
  await user.click(screen.getByRole("button"));

  expect(screen.getByRole("alert").textContent).toMatch(/no longer valid/i);
  expect(push).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
