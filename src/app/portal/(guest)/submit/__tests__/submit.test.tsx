/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitTabs } from "@/app/portal/(guest)/submit/SubmitTabs";
import { apiFetch } from "@/lib/api/client";

// Both forms route with `useRouter().push` on success.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Both forms talk to the API through `apiFetch` (Global Constraint).
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
  push.mockReset();
});

test("both tabs render, with the demand tab selected first", () => {
  render(<SubmitTabs />);

  const demandTab = screen.getByRole("tab", {
    name: /request software or a feature/i,
  });
  const incidentTab = screen.getByRole("tab", {
    name: /report a problem with delivered software/i,
  });

  expect(demandTab.getAttribute("aria-selected")).toBe("true");
  expect(incidentTab.getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    demandTab.id,
  );
});

test("clicking the incident tab switches the visible panel", async () => {
  render(<SubmitTabs />);

  // Demand-only control is present first.
  expect(screen.getByLabelText(/what do you need and why/i)).toBeTruthy();

  await userEvent.click(
    screen.getByRole("tab", {
      name: /report a problem with delivered software/i,
    }),
  );

  const incidentTab = screen.getByRole("tab", {
    name: /report a problem with delivered software/i,
  });
  expect(incidentTab.getAttribute("aria-selected")).toBe("true");
  expect(
    screen
      .getByRole("tab", { name: /request software or a feature/i })
      .getAttribute("aria-selected"),
  ).toBe("false");

  // The demand panel's content is gone; the incident panel's is shown.
  expect(screen.queryByLabelText(/what do you need and why/i)).toBeNull();
  expect(screen.getByLabelText(/how much is it affecting you/i)).toBeTruthy();
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    incidentTab.id,
  );
});

test("the demand form posts to /api/demands with source CLIENT and routes to the request list", async () => {
  apiFetchMock.mockResolvedValue({ id: "d9", ref: "DEM-0009" });

  render(<SubmitTabs />);

  await userEvent.type(
    screen.getByLabelText(/what do you need$/i),
    "Faster CSV exports",
  );
  await userEvent.type(
    screen.getByLabelText(/what do you need and why/i),
    "The month-end export takes 20 minutes",
  );
  await userEvent.type(screen.getByLabelText(/which product/i), "Analytics");
  await userEvent.click(
    screen.getByRole("button", { name: /send the request/i }),
  );

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(([p]) => p === "/api/demands");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      method: "POST",
      body: {
        title: "Faster CSV exports",
        problem: "The month-end export takes 20 minutes",
        affectedService: "Analytics",
        source: "CLIENT",
      },
    });
  });

  await waitFor(() => expect(push).toHaveBeenCalledWith("/portal/demands"));
});

test("the incident form posts to /api/incidents and routes to the incident list", async () => {
  apiFetchMock.mockResolvedValue({ id: "i9", ref: "INC-0009" });

  render(<SubmitTabs />);

  await userEvent.click(
    screen.getByRole("tab", {
      name: /report a problem with delivered software/i,
    }),
  );

  await userEvent.type(
    screen.getByLabelText(/what went wrong/i),
    "Checkout is down",
  );
  await userEvent.type(
    screen.getByLabelText(/more detail/i),
    "Customers cannot pay at the till",
  );
  await userEvent.type(screen.getByLabelText(/which software/i), "Storefront");
  await userEvent.type(
    screen.getByLabelText(/how much is it affecting you/i),
    "We cannot take any orders",
  );
  await userEvent.click(
    screen.getByRole("button", { name: /report the problem/i }),
  );

  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(([p]) => p === "/api/incidents");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ method: "POST" });
  });

  await waitFor(() => expect(push).toHaveBeenCalledWith("/portal/incidents"));
});

test("a blank required field blocks submit (no apiFetch call)", async () => {
  render(<SubmitTabs />);

  await userEvent.type(
    screen.getByLabelText(/what do you need$/i),
    "Only a title",
  );
  await userEvent.click(
    screen.getByRole("button", { name: /send the request/i }),
  );

  expect(apiFetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});
