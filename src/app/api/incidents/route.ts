import { NextResponse } from "next/server";
import {
  createIncidentInternalBody,
  listIncidentsQuery,
  reportIncidentGuestBody,
} from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import {
  createIncident,
  listIncidents,
} from "@/server/modules/incident/service";
import { isInternal } from "@/server/policy/actor";

/**
 * `POST /api/incidents` — report an incident. The body schema is chosen by actor
 * kind: an internal reporter supplies impact/urgency; a guest does not (extra
 * keys in a guest body are stripped by Zod). `GET /api/incidents` — list, scoped
 * to the actor (`?status` / `?priority` / `?overdue` / `?mine` filter).
 * `plans/plan-02-incident.md` Task 4.
 */

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const raw = await req.json().catch(() => null);
  const input = isInternal(actor)
    ? { kind: "INTERNAL" as const, ...createIncidentInternalBody.parse(raw) }
    : { kind: "GUEST" as const, ...reportIncidentGuestBody.parse(raw) };
  const out = await runInTransaction((tx) => createIncident(actor, tx, input));
  return NextResponse.json(out, { status: 201 });
});

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const filters = listIncidentsQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json({ incidents: await listIncidents(actor, filters) });
});
