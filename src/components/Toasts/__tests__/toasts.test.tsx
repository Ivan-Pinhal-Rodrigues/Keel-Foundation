/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ToastProvider, toast } from "@/components/Toasts";

afterEach(cleanup);

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

test("a toast auto-dismisses after ~4s", () => {
  vi.useFakeTimers();
  try {
    render(<ToastProvider />);
    act(() => {
      toast("ephemeral");
    });
    expect(screen.getByText("ephemeral")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByText("ephemeral")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
