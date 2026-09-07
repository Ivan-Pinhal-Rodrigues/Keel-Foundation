/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsList } from "@/app/notifications/NotificationsList";
import { apiFetch } from "@/lib/api/client";

// The list talks to the route handlers through `apiFetch` (Global Constraint),
// so mock that — not `globalThis.fetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const now = new Date().toISOString();

type Row = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

function notif(over: Partial<Row> = {}): Row {
  return {
    id: "n1",
    kind: "ASSIGNED",
    subjectType: "Demand",
    subjectId: "d1",
    summary: "You were assigned DMD-0001",
    href: "/demands?open=d1",
    createdAt: now,
    readAt: null,
    ...over,
  };
}

function wire(feed: { notifications: Row[]; unreadCount: number }): void {
  apiFetchMock.mockImplementation((path, opts) => {
    if (path.startsWith("/api/notifications?")) return Promise.resolve(feed);
    if (path === "/api/notifications/read" && opts?.method === "POST") {
      return Promise.resolve({ updated: feed.unreadCount });
    }
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

const feedCalls = () =>
  apiFetchMock.mock.calls.filter((c) => c[0].startsWith("/api/notifications?"));

const lastFeedPath = () => feedCalls().at(-1)?.[0];

test("renders a row per notification", async () => {
  wire({
    notifications: [
      notif({ id: "n1", summary: "You were assigned DMD-0001" }),
      notif({ id: "n2", summary: "CHG-0002 moved to Scheduled" }),
    ],
    unreadCount: 2,
  });
  render(<NotificationsList />);

  expect(await screen.findByText("You were assigned DMD-0001")).toBeTruthy();
  expect(screen.getByText("CHG-0002 moved to Scheduled")).toBeTruthy();
  const links = screen.getAllByRole("link");
  expect(links.some((a) => a.getAttribute("href") === "/demands?open=d1")).toBe(
    true,
  );
});

test("choosing a kind re-fetches with ?kind=", async () => {
  wire({ notifications: [notif()], unreadCount: 1 });
  render(<NotificationsList />);
  await waitFor(() => expect(lastFeedPath()).toBeTruthy());

  await userEvent.selectOptions(
    screen.getByLabelText(/kind/i),
    "APPROVAL_NEEDED",
  );

  await waitFor(() => expect(lastFeedPath()).toContain("kind=APPROVAL_NEEDED"));
});

test("the unread toggle re-fetches with ?unread=true", async () => {
  wire({ notifications: [notif()], unreadCount: 1 });
  render(<NotificationsList />);
  await waitFor(() => expect(lastFeedPath()).toBeTruthy());

  await userEvent.click(screen.getByLabelText(/unread only/i));

  await waitFor(() => expect(lastFeedPath()).toContain("unread=true"));
});

test("'Mark all read' POSTs { all: true } then re-fetches", async () => {
  wire({ notifications: [notif()], unreadCount: 2 });
  render(<NotificationsList />);
  await waitFor(() => expect(feedCalls().length).toBeGreaterThan(0));
  const before = feedCalls().length;

  await userEvent.click(screen.getByRole("button", { name: /mark all read/i }));

  await waitFor(() =>
    expect(
      apiFetchMock.mock.calls.some(
        (c) =>
          c[0] === "/api/notifications/read" &&
          c[1]?.method === "POST" &&
          JSON.stringify(c[1]?.body) === JSON.stringify({ all: true }),
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(feedCalls().length).toBeGreaterThan(before));
});

test("shows the empty state when there are no notifications", async () => {
  wire({ notifications: [], unreadCount: 0 });
  render(<NotificationsList />);

  expect(await screen.findByText(/no notifications/i)).toBeTruthy();
});
