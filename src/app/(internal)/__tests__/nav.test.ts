import { expect, test } from "vitest";
import { navKeyFor } from "@/app/(internal)/nav";

const NAV = [
  { key: "demands", href: "/demands" },
  { key: "incidents", href: "/incidents" },
];

test("an exact path match → that item's key", () => {
  expect(navKeyFor("/demands", NAV)).toBe("demands");
});

test("a nested path → the parent item's key", () => {
  expect(navKeyFor("/demands/42", NAV)).toBe("demands");
});

test("a sibling that only shares a string prefix → no match", () => {
  expect(navKeyFor("/demands-archive", NAV)).toBe("");
});

test("nothing matches → empty string", () => {
  expect(navKeyFor("/", NAV)).toBe("");
});
