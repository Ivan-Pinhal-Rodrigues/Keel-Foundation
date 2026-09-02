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

  test("returns empty object for guest with null clientId (defensive)", () => {
    expect(
      scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: null }),
    ).toEqual({});
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
