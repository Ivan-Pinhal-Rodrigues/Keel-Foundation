import { expect, test } from "vitest";
import { listIncidentsQuery } from "@/lib/api/schemas/incidents";

test("listIncidentsQuery overdue/mine: true-only semantics", () => {
  // Omitted → not filtered.
  const empty = listIncidentsQuery.parse({});
  expect(empty.overdue).toBeFalsy();
  expect(empty.mine).toBeFalsy();

  // `?overdue=false` must NOT filter (the z.coerce.boolean bug treated it as true).
  expect(listIncidentsQuery.parse({ overdue: "false" }).overdue).toBeFalsy();
  expect(listIncidentsQuery.parse({ mine: "false" }).mine).toBeFalsy();

  // `?overdue=true` filters.
  expect(listIncidentsQuery.parse({ overdue: "true" }).overdue).toBe(true);
  expect(listIncidentsQuery.parse({ mine: "true" }).mine).toBe(true);

  // Any other string is a validation error, not a silent truthy.
  expect(listIncidentsQuery.safeParse({ overdue: "1" }).success).toBe(false);
});
