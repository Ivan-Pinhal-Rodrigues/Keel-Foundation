import { redirect } from "next/navigation";
import { listIncidentsQuery } from "@/lib/api/schemas/incidents";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { listIncidents } from "@/server/modules/incident/service";
import type { Priority } from "@/components/Pill";
import type { IncidentRow } from "./IncidentCard";
import { IncidentRegister } from "./IncidentRegister";

/**
 * `/incidents` — the internal incident register (`plans/plan-02-incident.md`
 * Task 8, spec 02 §9.1). A card list, not a `DataTable`.
 *
 * `async` server component, mirroring `demands/page.tsx`: it resolves the actor
 * from the session cookie (`getCurrentActor`, the RSC-safe reader), redirects to
 * `/login` when there is none, parses the `?status/?priority/?overdue/?mine`
 * query with `listIncidentsQuery`, and calls the incident service directly (a
 * server component MAY import `src/server/**`). Client components still go
 * through the route handlers.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Serialized incident (internal) → the register's row. */
function toRow(r: Record<string, unknown>): IncidentRow {
  const assignee = r.assignee as { displayName: string } | null | undefined;
  const dueAt = r.dueAt;
  const createdAt = r.createdAt;
  return {
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    affectedService: String(r.affectedService),
    priority: r.priority as Priority,
    status: String(r.status),
    assigneeId: (r.assigneeId as string | null | undefined) ?? null,
    assigneeName: assignee?.displayName ?? null,
    dueAt: dueAt instanceof Date ? dueAt.toISOString() : String(dueAt),
    overdue: Boolean(r.overdue),
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
  };
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const me = await whoami();
  if (!me) redirect("/login");
  const viewer = { id: me.id, kind: me.kind, hats: me.hats };

  const sp = await searchParams;
  const filters = listIncidentsQuery.parse({
    status: first(sp.status),
    priority: first(sp.priority),
    overdue: first(sp.overdue),
    mine: first(sp.mine),
  });

  const rows = (await listIncidents(actor, filters)).map(toRow);

  return (
    <IncidentRegister
      initialRows={rows}
      initialFilters={{
        status: filters.status,
        priority: filters.priority,
        overdue: filters.overdue,
        mine: filters.mine,
      }}
      viewer={viewer}
    />
  );
}
