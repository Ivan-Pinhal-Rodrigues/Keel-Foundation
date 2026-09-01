import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

test("hash round-trips and rejects the wrong password", async () => {
  const h = await hashPassword("correct horse battery staple");
  expect(h).not.toContain("correct horse");
  expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
  expect(await verifyPassword(h, "Tr0ub4dour")).toBe(false);
});
