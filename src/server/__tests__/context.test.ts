import { expect, test } from "vitest";
import {
  getActorId,
  getRequestId,
  runWithContext,
  setActorId,
} from "@/server/context";

test("request context propagates through async boundaries", async () => {
  await runWithContext({ requestId: "req-123" }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    expect(getRequestId()).toBe("req-123");
  });
});

test("getRequestId throws outside a context", () => {
  expect(() => getRequestId()).toThrow(/no request context/i);
});

test("actorId: null outside any context, set within one and read in a nested async callback", async () => {
  expect(getActorId()).toBeNull();

  await runWithContext({ requestId: "req-actor" }, async () => {
    setActorId("user-7");
    await Promise.resolve().then(async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getActorId()).toBe("user-7");
    });
  });

  expect(getActorId()).toBeNull();
});
