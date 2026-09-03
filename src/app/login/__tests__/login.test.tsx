/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/app/login/LoginForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.restoreAllMocks();
});

test("submits credentials and routes to `next` on 200", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));

  // `next` is deliberately not the "/demands" fallback, so this also proves the
  // prop is threaded through rather than ignored.
  render(<LoginForm next="/incidents" />);
  await userEvent.type(screen.getByLabelText(/email/i), "ceo@keel.local");
  await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/incidents"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/login",
    expect.objectContaining({ method: "POST" }),
  );
});

test("an empty submit shows a field error and never calls the API", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");

  render(<LoginForm next="/demands" />);
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect((await screen.findByRole("alert")).textContent).toMatch(
    /enter your email and password/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("shows an inline error on 401 and does not navigate", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
  );
  render(<LoginForm next="/demands" />);
  await userEvent.type(screen.getByLabelText(/email/i), "x@y.z");
  await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  // The repo carries no @testing-library/jest-dom, so assert on textContent
  // directly (the convention in src/app/portal/invite/__tests__/page.test.tsx)
  // rather than the brief's `.toHaveTextContent` matcher.
  expect((await screen.findByRole("alert")).textContent).toMatch(/incorrect/i);
  expect(push).not.toHaveBeenCalled();
});
