import { expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueViolation, isNotFound } from "@/server/db/errors";

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

test("recognises a P2002 with string target", () => {
  const e = new Prisma.PrismaClientKnownRequestError("dup", {
    code: "P2002",
    clientVersion: "x",
    meta: { target: "Client_name_key" },
  });
  expect(isUniqueViolation(e, "Client_name_key")).toBe(true);
  expect(isUniqueViolation(e, "other")).toBe(false);
});

test("isNotFound recognises P2025", () => {
  const e = new Prisma.PrismaClientKnownRequestError("not found", {
    code: "P2025",
    clientVersion: "x",
  });
  expect(isNotFound(e)).toBe(true);
});

test("isNotFound rejects non-P2025", () => {
  expect(isNotFound(new Error("x"))).toBe(false);
  expect(
    isNotFound(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "x",
      }),
    ),
  ).toBe(false);
});
