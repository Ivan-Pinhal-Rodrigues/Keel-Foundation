/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "@/app/portal/(guest)/demands/CommentThread";
import { PortalDemandDetail } from "@/app/portal/(guest)/demands/PortalDemandDetail";
import { PortalDemandList } from "@/app/portal/(guest)/demands/PortalDemandList";
import { apiFetch } from "@/lib/api/client";

// The comment thread is the only interactive island; it talks to the route
// handler through `apiFetch` (Global Constraint), so mock that — not
// `globalThis.fetch`.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

// The rows the guest list receives are ALREADY guest-serialized by
// `listDemands` — plain-word `status`, no `worth` / `submittedById` / enum.
const rows = [
  {
    id: "d1",
    ref: "DEM-0001",
    title: "Faster exports",
    status: "In review",
    clientName: "Northwind",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "d2",
    ref: "DEM-0002",
    title: "SSO for the finance team",
    status: "Approved",
    clientName: "Northwind",
    createdAt: "2026-08-20T09:00:00.000Z",
  },
];

test("the list shows plain-word statuses and never a raw enum, and links each row to its detail page", () => {
  render(<PortalDemandList rows={rows} />);

  expect(screen.getByText("In review")).toBeTruthy();
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.queryByText(/TRIAGING|SUBMITTED|WORTH_ASSESSED/)).toBeNull();

  const link = screen.getByRole("link", { name: /Faster exports/i });
  expect(link.getAttribute("href")).toBe("/portal/demands/d1");
});

test("the list renders an empty state when the guest has no requests", () => {
  render(<PortalDemandList rows={[]} />);
  expect(screen.getByText(/no requests yet/i)).toBeTruthy();
});

test("detail shows the problem, the plain-word status, the guest activity, and a message box", async () => {
  apiFetchMock.mockResolvedValue({ comments: [] });

  const demand = {
    id: "d1",
    ref: "DEM-0001",
    title: "Faster exports",
    problem: "Reports take twenty minutes to generate.",
    status: "In review",
    activity: [{ time: "2026-09-01 09:00", text: "Request raised" }],
  };

  render(<PortalDemandDetail demand={demand} />);

  expect(
    screen.getByText("Reports take twenty minutes to generate."),
  ).toBeTruthy();
  expect(screen.getByText("In review")).toBeTruthy();
  expect(screen.getByText("Request raised")).toBeTruthy();
  expect(await screen.findByLabelText("Add a message")).toBeTruthy();
});

test("a guest comment posts with no visible-to-client toggle and a body-only payload", async () => {
  apiFetchMock.mockImplementation((path, opts) => {
    if (opts?.method === "POST") {
      return Promise.resolve({
        comments: [
          {
            id: "c1",
            body: (opts.body as { body: string }).body,
            author: "Dana Guest",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }
    return Promise.resolve({ comments: [] });
  });

  render(<CommentThread subjectPath="/api/demands/d1" />);

  // No "visible to client" control anywhere in a guest's comment box.
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(/visible to client/i)).toBeNull();

  const box = await screen.findByLabelText("Add a message");
  await userEvent.type(box, "Any update on this?");
  await userEvent.click(screen.getByRole("button", { name: /send message/i }));

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(
      ([p, o]) => p === "/api/demands/d1/comments" && o?.method === "POST",
    );
    expect(call).toBeTruthy();
    expect(call![1]!.body).toEqual({ body: "Any update on this?" });
  });

  expect(await screen.findByText("Any update on this?")).toBeTruthy();
});
