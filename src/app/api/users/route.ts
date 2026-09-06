import { NextResponse } from "next/server";
import { listUsersQuery } from "@/lib/api/schemas/users";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { listInternalUsers } from "@/server/modules/user";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * `GET /api/users?kind=INTERNAL` — the incident drawer's assignee picker needs
 * the list of internal users, which no other endpoint exposes
 * (`plans/plan-02-incident.md` Task 9). Internal-only (`requireInternal`); no new
 * policy action. Returns `{ users: [{ id, displayName }] }` for active internal
 * users. The Prisma read goes through `src/server/modules/user` so the route
 * never touches `@/server/db/client` (DESIGN.md §3.2).
 */
export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  requireInternal(actor);
  const { kind } = listUsersQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const users = kind === "INTERNAL" ? await listInternalUsers() : [];
  return NextResponse.json({ users });
});
