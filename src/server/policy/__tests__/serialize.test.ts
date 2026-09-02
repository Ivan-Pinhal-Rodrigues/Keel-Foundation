import { describe, expect, test } from "vitest";
import {
  serializeFor,
  assertNoInternalKeys,
  SerializerConfig,
} from "../serialize";

describe("serializeFor", () => {
  test("guest serialization drops internal-only keys and applies the transform", () => {
    const row = {
      id: "1",
      title: "x",
      assigneeId: "u9",
      internalNote: "secret",
      clientId: "c1",
    };
    const out = serializeFor(
      { id: "g", kind: "GUEST", hats: [], clientId: "c1" },
      row,
      {
        internalOnlyKeys: ["assigneeId", "internalNote"],
        guestTransform: () => ({ assignee: "Keel team" }),
      },
    );
    expect(out).not.toHaveProperty("assigneeId");
    expect(out).not.toHaveProperty("internalNote");
    expect(out.assignee).toBe("Keel team");
  });

  test("internal serialization is a passthrough", () => {
    const row = { id: "1", assigneeId: "u9" };
    const out = serializeFor(
      { id: "i", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null },
      row,
      { internalOnlyKeys: ["assigneeId"] },
    );
    expect(out).toEqual(row);
  });

  test("serializeFor returns a copy, not the same reference", () => {
    const row = { id: "1", title: "x" };
    const out = serializeFor(
      { id: "i", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null },
      row,
      { internalOnlyKeys: [] },
    );
    expect(out).not.toBe(row);
    expect(out).toEqual(row);
  });

  test("guest serialization returns a copy", () => {
    const row = { id: "1", title: "x", secret: "hidden" };
    const out = serializeFor(
      { id: "g", kind: "GUEST", hats: [], clientId: "c1" },
      row,
      { internalOnlyKeys: ["secret"] },
    );
    expect(out).not.toBe(row);
  });

  test("mutating guest-serialized output does not touch original row", () => {
    const row = { id: "1", title: "x", secret: "hidden" };
    const out = serializeFor(
      { id: "g", kind: "GUEST", hats: [], clientId: "c1" },
      row,
      { internalOnlyKeys: ["secret"] },
    );
    out.title = "modified";
    expect(row.title).toBe("x");
  });

  test("guestTransform can also add a key", () => {
    const row = { id: "1", title: "x", assigneeId: "u9" };
    const out = serializeFor(
      { id: "g", kind: "GUEST", hats: [], clientId: "c1" },
      row,
      {
        internalOnlyKeys: ["assigneeId"],
        guestTransform: () => ({ assignee: "Keel team", newProp: "added" }),
      },
    );
    expect(out.assignee).toBe("Keel team");
    expect(out.newProp).toBe("added");
    expect(out).not.toHaveProperty("assigneeId");
  });
});

describe("assertNoInternalKeys", () => {
  test("passes when clean", () => {
    expect(() =>
      assertNoInternalKeys({ id: "1", title: "x" }, ["secret", "assigneeId"]),
    ).not.toThrow();
  });

  test("throws naming the first leaked key", () => {
    expect(() =>
      assertNoInternalKeys({ id: "1", title: "x", secret: "hidden" }, [
        "secret",
        "assigneeId",
      ]),
    ).toThrow("internal-only key leaked to guest: secret");
  });

  test("throws on multiple leaked keys, naming the first", () => {
    expect(() =>
      assertNoInternalKeys({ id: "1", secret: "hidden", assigneeId: "u9" }, [
        "secret",
        "assigneeId",
      ]),
    ).toThrow("internal-only key leaked to guest: secret");
  });

  test("handles empty keys array", () => {
    expect(() =>
      assertNoInternalKeys({ id: "1", title: "x" }, []),
    ).not.toThrow();
  });
});
