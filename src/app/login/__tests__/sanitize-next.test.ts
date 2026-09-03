import { expect, test } from "vitest";
import { sanitizeNext } from "@/app/login/sanitize-next";

test("a same-origin path passes through unchanged", () => {
  expect(sanitizeNext("/demands/42")).toBe("/demands/42");
  expect(sanitizeNext("/incidents?tab=open#row")).toBe(
    "/incidents?tab=open#row",
  );
});

test("a protocol-relative value is rejected", () => {
  expect(sanitizeNext("//evil.com")).toBe("/demands");
});

test("an absolute off-origin URL is rejected", () => {
  expect(sanitizeNext("https://evil.com")).toBe("/demands");
});

test("the control-character bypass is rejected (parser strips the tab → off-origin)", () => {
  // `?next=/%09//evil.com` decodes to this; a `startsWith("//")` guard misses it
  // but `new URL` resolves it to https://evil.com/.
  expect(sanitizeNext("/\t//evil.com")).toBe("/demands");
  expect(sanitizeNext("/\n//evil.com")).toBe("/demands");
  expect(sanitizeNext("/\\evil.com")).toBe("/demands");
});

test("a non-path scheme is rejected", () => {
  expect(sanitizeNext("javascript:alert(1)")).toBe("/demands");
});

test("missing / empty / array input falls back", () => {
  expect(sanitizeNext(undefined)).toBe("/demands");
  expect(sanitizeNext("")).toBe("/demands");
  expect(sanitizeNext(["/a", "/b"])).toBe("/a");
});
