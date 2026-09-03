/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { z, ZodError } from "zod";
import { apiFetch, ApiError } from "@/lib/api/client";

afterEach(() => vi.restoreAllMocks());

test("GET parses the 2xx body with the schema", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ demands: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const out = await apiFetch("/api/demands", {
    schema: z.object({ demands: z.array(z.unknown()) }),
  });
  expect(out).toEqual({ demands: [] });
});

test("POST sends JSON + throws ApiError with the parsed body on 409", async () => {
  const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        error: "segregation",
        overrideAction: "demand.decide.override",
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    ),
  );
  await expect(
    apiFetch("/api/demands/d1/decision", {
      method: "POST",
      body: { decision: "PURSUE" },
    }),
  ).rejects.toMatchObject({
    status: 409,
    body: { overrideAction: "demand.decide.override" },
  });
  expect(f).toHaveBeenCalledWith(
    "/api/demands/d1/decision",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ decision: "PURSUE" }),
    }),
  );
});

test("a non-2xx with a non-JSON body → ApiError, status kept, body null", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<html>502 Bad Gateway</html>", { status: 502 }),
  );
  const err = await apiFetch("/api/demands").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 502, body: null });
});

test("a 204 resolves to undefined", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  expect(
    await apiFetch("/api/demands/d1/triage", { method: "POST" }),
  ).toBeUndefined();
});

test("an empty 2xx body resolves to undefined, not a JSON parse error", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", { status: 200 }),
  );
  expect(
    await apiFetch("/api/demands/d1/triage", { method: "POST" }),
  ).toBeUndefined();
});

test("a network failure propagates as-is — not wrapped in ApiError", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("Failed to fetch"),
  );
  const err = await apiFetch("/api/demands").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TypeError);
  expect(err).not.toBeInstanceOf(ApiError);
});

test("a 2xx body that fails schema.parse throws a ZodError, not an ApiError", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ wrong: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const err = await apiFetch("/api/demands", {
    schema: z.object({ demands: z.array(z.unknown()) }),
  }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ZodError);
  expect(err).not.toBeInstanceOf(ApiError);
});
