/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "@/components/NotificationBell";
import { apiFetch } from "@/lib/api/client";
import { stubRadixEnv } from "@/test/dom";

// The bell talks to the route handlers through `apiFetch` (Global Constraint),
// so mock that — not `globalThis.fetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

stubRadixEnv();
afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const now = new Date().toISOString();

function notif(
  over: Partial<{
    id: string;
    summary: string;
    href: string;
    readAt: string | null;
  }> = {},
) {
  return {
    id: over.id ?? "n1",
    kind: "DEMAND_ASSIGNED",
    subjectType: "Demand",
    subjectId: "d1",
    summary: over.summary ?? "You were assigned DMD-0001",
    href: over.href ?? "/demands?open=d1",
    createdAt: now,
    readAt: over.readAt ?? null,
  };
}

/** Wire `apiFetch`: the notifications GET returns `feed`, the read POST resolves. */
function wire(feed: {
  notifications: ReturnType<typeof notif>[];
  unreadCount: number;
}) {
  apiFetchMock.mockImplementation((path, o) => {
    if (path === "/api/notifications?unread=false" && !o)
      return Promise.resolve(feed);
    if (path === "/api/notifications/read" && o?.method === "POST") {
      return Promise.resolve({ updated: feed.unreadCount });
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

const getCount = () =>
  apiFetchMock.mock.calls.filter(
    (c) => c[0] === "/api/notifications?unread=false",
  ).length;

test("renders a bell button and the unread badge, capped at 9+", async () => {
  wire({ notifications: [notif()], unreadCount: 3 });
  const { unmount } = render(<NotificationBell />);

  expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  expect(await screen.findByText("3")).toBeTruthy();
  unmount();

  wire({ notifications: [notif()], unreadCount: 12 });
  render(<NotificationBell />);
  expect(await screen.findByText("9+")).toBeTruthy();
});

test("opening the popover lists the recent notifications as links to their href", async () => {
  const user = userEvent.setup();
  wire({
    notifications: [
      notif({
        id: "n1",
        summary: "You were assigned DMD-0001",
        href: "/demands?open=d1",
      }),
      notif({
        id: "n2",
        summary: "INC-0002 was resolved",
        href: "/incidents?open=i2",
        readAt: now,
      }),
    ],
    unreadCount: 1,
  });
  render(<NotificationBell />);

  await user.click(screen.getByRole("button", { name: "Notifications" }));

  const first = await screen.findByText("You were assigned DMD-0001");
  const second = screen.getByText("INC-0002 was resolved");
  expect(first.closest("a")?.getAttribute("href")).toBe("/demands?open=d1");
  expect(second.closest("a")?.getAttribute("href")).toBe("/incidents?open=i2");
});

test("'Mark all read' POSTs { all: true } then refetches", async () => {
  const user = userEvent.setup();
  wire({ notifications: [notif()], unreadCount: 2 });
  render(<NotificationBell />);

  await user.click(screen.getByRole("button", { name: "Notifications" }));
  await waitFor(() => expect(getCount()).toBeGreaterThanOrEqual(1));
  const before = getCount();

  await user.click(
    await screen.findByRole("button", { name: "Mark all read" }),
  );

  await waitFor(() =>
    expect(
      apiFetchMock.mock.calls.some(
        (c) =>
          c[0] === "/api/notifications/read" &&
          (c[1] as { method?: string; body?: unknown })?.method === "POST" &&
          JSON.stringify((c[1] as { body?: unknown })?.body) ===
            JSON.stringify({ all: true }),
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(getCount()).toBeGreaterThan(before));
});

test("empty notifications show the caught-up message", async () => {
  const user = userEvent.setup();
  wire({ notifications: [], unreadCount: 0 });
  render(<NotificationBell />);

  await user.click(screen.getByRole("button", { name: "Notifications" }));
  expect(await screen.findByText("You're all caught up.")).toBeTruthy();
});

test("clears the interval and focus listener on unmount", () => {
  wire({ notifications: [], unreadCount: 0 });
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const clearSpy = vi.spyOn(globalThis, "clearInterval");
  const { unmount } = render(<NotificationBell />);
  unmount();
  expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(clearSpy).toHaveBeenCalled();
  removeSpy.mockRestore();
  clearSpy.mockRestore();
});
