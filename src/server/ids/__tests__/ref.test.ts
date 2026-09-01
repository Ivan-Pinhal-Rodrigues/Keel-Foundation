import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { nextRef } from "@/server/ids/ref";

const db = withTestDb();

test("nextRef increments per prefix and formats to 4 digits", async () => {
  const a = await nextRef(db(), "DEM");
  const b = await nextRef(db(), "DEM");
  const c = await nextRef(db(), "INC");
  expect(a).toBe("DEM-0001");
  expect(b).toBe("DEM-0002");
  expect(c).toBe("INC-0001");
});

test("nextRef is gap-free under parallel calls", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => nextRef(db(), "CHG")),
  );
  const nums = results
    .map((r) => Number(r.split("-")[1]))
    .sort((x, y) => x - y);
  expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});
