import { expect, test } from "vitest";
import { renderTemplate } from "@/server/modules/notify/templates";

test("guest_invite renders a subject, plain text, and HTML with the redeem URL", () => {
  const r = renderTemplate("guest_invite", {
    clientName: "Northwind",
    url: "http://localhost:3000/portal/invite/abc",
  });
  expect(r.subject).toMatch(/Keel/);
  expect(r.text).toContain("http://localhost:3000/portal/invite/abc");
  expect(r.html).toContain("abc");
});

test("renderTemplate throws for an unknown template", () => {
  expect(() => renderTemplate("nope", {})).toThrow(/unknown template/i);
});

test("demand_decided renders a guest-safe update carrying the ref and the plain-word status", () => {
  const r = renderTemplate("demand_decided", {
    ref: "DEM-0007",
    status: "Approved",
  });
  expect(r.subject).toContain("DEM-0007");
  expect(r.text).toContain("Approved");
  expect(r.html).toContain("DEM-0007");
  // no internal vocabulary leaks into the rendered copy
  expect(`${r.subject} ${r.text} ${r.html}`).not.toMatch(
    /triaging|worth_assessed|RFC\b|CAB\b|ChangeStatus/i,
  );
});

test("demand_decided tolerates missing payload fields", () => {
  const r = renderTemplate("demand_decided", {});
  expect(r.subject).toBeTruthy();
  expect(r.text).toBeTruthy();
  expect(r.html).toBeTruthy();
});

test("guest_invite puts the client name in the copy and the url in the CTA href", () => {
  const r = renderTemplate("guest_invite", {
    clientName: "Northwind",
    url: "http://localhost:3000/portal/invite/tok123",
  });
  expect(r.text).toContain("Northwind");
  expect(r.html).toContain('href="http://localhost:3000/portal/invite/tok123"');
  // Guest-safe: no internal vocabulary leaks into the rendered copy.
  expect(`${r.subject} ${r.text}`).not.toMatch(
    /triaging|RFC\b|CAB\b|ChangeStatus/i,
  );
});

test("guest_invite tolerates a missing clientName without throwing", () => {
  const r = renderTemplate("guest_invite", {
    url: "http://localhost:3000/portal/invite/x",
  });
  expect(r.subject).toMatch(/Keel/);
  expect(r.text).toContain("http://localhost:3000/portal/invite/x");
});
