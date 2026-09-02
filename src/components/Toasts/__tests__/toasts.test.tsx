/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ToastProvider, toast } from "@/components/Toasts";

// `toast()` is backed by a module-level store, so every test must leave it
// empty. Fake timers file-wide + draining any pending auto-dismiss in afterEach
// keeps the suite order-independent.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  cleanup();
  vi.useRealTimers();
});

test("the live region starts empty", () => {
  render(<ToastProvider />);
  expect(screen.getByRole("status").textContent).toBe("");
});

test("toast() shows a message in a polite status live region", () => {
  render(<ToastProvider />);
  act(() => {
    toast("saved to the register");
  });
  const region = screen.getByRole("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toContain("saved to the register");
});

test("toast() works when called from a provider that wraps children", () => {
  render(
    <ToastProvider>
      <p>app</p>
    </ToastProvider>,
  );
  expect(screen.getByText("app")).toBeTruthy();
  act(() => {
    toast("hello");
  });
  expect(screen.getByText("hello")).toBeTruthy();
});

test("a toast auto-dismisses after its ~2.5s lifetime", () => {
  render(<ToastProvider />);
  act(() => {
    toast("ephemeral");
  });
  expect(screen.getByText("ephemeral")).toBeTruthy();

  act(() => {
    vi.advanceTimersByTime(2400);
  });
  expect(screen.getByText("ephemeral")).toBeTruthy(); // still up before TTL

  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(screen.queryByText("ephemeral")).toBeNull(); // gone at ~2.5s
});
