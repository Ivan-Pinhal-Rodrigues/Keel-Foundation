import { expect, test } from "vitest";
import { redeemInviteBody } from "@/lib/api/schemas/invites";

test("redeemInviteBody: trims the name and rejects a blank one", () => {
  expect(
    redeemInviteBody.safeParse({ name: "  ", password: "12345678" }).success,
  ).toBe(false);
  expect(
    redeemInviteBody.parse({ name: "  Ada  ", password: "12345678" }).name,
  ).toBe("Ada");
});

test("redeemInviteBody: requires a password of at least 8 characters", () => {
  expect(
    redeemInviteBody.safeParse({ name: "Ada", password: "short" }).success,
  ).toBe(false);
  expect(
    redeemInviteBody.safeParse({ name: "Ada", password: "longenough" }).success,
  ).toBe(true);
});
