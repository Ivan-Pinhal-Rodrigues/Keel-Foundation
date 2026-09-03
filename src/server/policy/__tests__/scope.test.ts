import { describe, expect, test } from "vitest";
import { scopeToClient, assertVisibleToGuest } from "../scope";
import { NotFoundError } from "../errors";

describe("scopeToClient", () => {
  test("returns a where fragment for guests, empty for internal", () => {
    expect(
      scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: "c1" }),
    ).toEqual({
      clientId: "c1",
    });
    expect(
      scopeToClient({
        id: "i",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
        clientId: null,
      }),
    ).toEqual({});
  });

  test("a guest with a null clientId gets an impossible-match scope, never {}", () => {
    const scoped = scopeToClient({
      id: "g",
      kind: "GUEST",
      hats: [],
      clientId: null,
    });
    // the exact shape is an implementation detail; the invariant is: it must not
    // be an empty object, and spreading it into a `where` must match zero rows.
    expect(scoped).not.toEqual({});
    expect(Object.keys(scoped)).toContain("clientId");
  });

  test("an internal actor gets {}", () => {
    expect(
      scopeToClient({ id: "u", kind: "INTERNAL", hats: [], clientId: null }),
    ).toEqual({});
  });

  test("a guest with a clientId gets that clientId", () => {
    expect(
      scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: "c1" }),
    ).toEqual({ clientId: "c1" });
  });
});

describe("assertVisibleToGuest", () => {
  test("throws NotFoundError for another client's row or a missing row", () => {
    const g = { id: "g", kind: "GUEST" as const, hats: [], clientId: "c1" };
    expect(() => assertVisibleToGuest(g, null)).toThrow(NotFoundError);
    expect(() => assertVisibleToGuest(g, { clientId: "c2" })).toThrow(
      NotFoundError,
    );
    expect(() => assertVisibleToGuest(g, { clientId: "c1" })).not.toThrow();
    expect(() =>
      assertVisibleToGuest(
        { ...g, kind: "INTERNAL" as const, clientId: null },
        { clientId: "c2" },
      ),
    ).not.toThrow();
  });

  test("throws NotFoundError for a guest against a row with null clientId (internal-only)", () => {
    const g = { id: "g", kind: "GUEST" as const, hats: [], clientId: "c1" };
    expect(() => assertVisibleToGuest(g, { clientId: null })).toThrow(
      NotFoundError,
    );
  });
});
