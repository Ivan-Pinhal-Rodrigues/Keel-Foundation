import { redirect } from "next/navigation";
import { listDemandsQuery } from "@/lib/api/schemas/demands";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { listDemands } from "@/server/modules/demand/service";
import { DemandRegister, type DemandRow } from "./DemandRegister";
import { PrioritisationBoard } from "./PrioritisationBoard";

/**
 * `/demands` — the demand register (list view), `plans/plan-01-demand.md` Task 5.
 *
 * `async` server component. It resolves the actor from the session cookie
 * (`getCurrentActor`, the RSC-safe reader — `getActor()` from
 * `@/server/auth/actor` only works inside `withRequest`) and calls the demand
 * service directly: a server component MAY import `src/server/**` (it is not
 * `api/**` and does not import `@prisma/client`), so there is no self-`fetch`.
 * Client components still go through the route handlers.
 *
 * `?view=board` renders the read-only value×effort prioritisation board
 * (Task 8) instead of the register.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Serialized demand (role-aware, from `serializeDemand`) → the register's row. */
function toRow(r: Record<string, unknown>): DemandRow {
  const client = r.client as { name: string } | null | undefined;
  const createdAt = r.createdAt;
  return {
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    source: String(r.source),
    status: String(r.status),
    clientName:
      client?.name ?? (r.clientName as string | null | undefined) ?? null,
    worth: (r.worth as DemandRow["worth"]) ?? null,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
  };
}

export default async function DemandsPage({
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
  const filters = listDemandsQuery.parse({
    status: first(sp.status),
    source: first(sp.source),
    mine: first(sp.mine),
    view: first(sp.view),
  });

  const rows = (await listDemands(actor, filters)).map(toRow);

  if (filters.view === "board") {
    return (
      <PrioritisationBoard
        rows={rows}
        viewer={viewer}
        filters={{
          status: filters.status,
          source: filters.source,
          mine: filters.mine,
        }}
      />
    );
  }

  return (
    <DemandRegister
      initialRows={rows}
      initialFilters={{
        status: filters.status,
        source: filters.source,
        mine: filters.mine,
      }}
      viewer={viewer}
    />
  );
}
