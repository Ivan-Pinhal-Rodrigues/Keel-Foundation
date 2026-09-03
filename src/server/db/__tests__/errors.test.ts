import { expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "@/server/db/errors";

test("recognises a P2002 with an optional target", () => {
  const e = new Prisma.PrismaClientKnownRequestError("dup", {
    code: "P2002",
    clientVersion: "x",
    meta: { target: ["email"] },
  });
  expect(isUniqueViolation(e)).toBe(true);
  expect(isUniqueViolation(e, "email")).toBe(true);
  expect(isUniqueViolation(e, "ref")).toBe(false);
});

test("not a P2002", () => {
  expect(isUniqueViolation(new Error("x"))).toBe(false);
  expect(
    isUniqueViolation(
      new Prisma.PrismaClientKnownRequestError("x", {
        code: "P2025",
        clientVersion: "x",
      }),
    ),
  ).toBe(false);
});
