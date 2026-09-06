/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ApprovalsList,
  type ApprovalItem,
} from "@/app/(internal)/approvals/ApprovalsList";

// The repo carries no @testing-library/jest-dom, so assert on truthiness / null.
afterEach(cleanup);

const items: ApprovalItem[] = [
  {
    subjectType: "change",
    subjectId: "c1",
    subjectRef: "CHG-0001",
    subjectTitle: "Upgrade the primary database",
    policyKey: "change.standard",
    currentRequiredHat: "CHANGE_MANAGER",
    needsOverride: false,
  },
  {
    subjectType: "change",
    subjectId: "c2",
    subjectRef: "CHG-0002",
    subjectTitle: "Rotate the edge TLS certificates",
    policyKey: "change.high_risk",
    currentRequiredHat: "CAB",
    needsOverride: true,
  },
];

test("renders a row per item with its ref, title, and the hat pill", () => {
  render(<ApprovalsList items={items} />);

  expect(screen.getByText("CHG-0001")).toBeTruthy();
  expect(screen.getByText("Upgrade the primary database")).toBeTruthy();
  expect(screen.getByText("CHG-0002")).toBeTruthy();
  expect(screen.getByText("Rotate the edge TLS certificates")).toBeTruthy();

  expect(screen.getByText("CHANGE_MANAGER")).toBeTruthy();
  expect(screen.getByText("CAB")).toBeTruthy();
});

test("each row links into the change register with ?open=<subjectId>", () => {
  render(<ApprovalsList items={items} />);

  expect(
    screen.getByRole("link", { name: /CHG-0001/i }).getAttribute("href"),
  ).toBe("/changes?open=c1");
  expect(
    screen.getByRole("link", { name: /CHG-0002/i }).getAttribute("href"),
  ).toBe("/changes?open=c2");
});

test("the override flag shows only on the item the actor submitted", () => {
  render(<ApprovalsList items={items} />);

  const flags = screen.getAllByText(/needs your override/i);
  expect(flags.length).toBe(1);
  expect(screen.getByRole("link", { name: /CHG-0002/i }).textContent).toMatch(
    /needs your override/i,
  );
});

test("shows the empty state when nothing is waiting", () => {
  render(<ApprovalsList items={[]} />);

  expect(screen.getByText("Nothing is waiting on you.")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
