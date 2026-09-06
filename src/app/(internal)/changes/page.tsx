import { redirect } from "next/navigation";
import { listChangesQuery } from "@/lib/api/schemas/changes";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { listChanges } from "@/server/modules/change/service";
import type { RiskLevel } from "@/components/Pill";
import { ChangeRegister, type ChangeRow } from "./ChangeRegister";
import { ScheduledWindows, type ScheduledWindowRow } from "./ScheduledWindows";
import styles from "./changes.module.css";

/**
 * `/changes` — the internal change register (`plans/plan-03-change-approvals`
 * Task 12, spec 03 §8.1). A `DataTable` register plus a `ScheduledWindows` side
 * list.
 *
 * `async` server component, mirroring `incidents/page.tsx`: it resolves the
 * actor from the session cookie (`getCurrentActor`, the RSC-safe reader),
 * redirects to `/login` when there is none, parses the `?status/?mine/?scheduled`
 * query with `listChangesQuery`, and calls the change service directly (a
 * server component MAY import `src/server/**`). Client components still go
 * through the route handlers.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") return value;
  return null;
}

/** List-serialized change (`serializeChangeListItem`) → the register's row. */
function toRow(r: Record<string, unknown>): ChangeRow {
  return {
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    riskLevel: (r.riskLevel as RiskLevel | null | undefined) ?? null,
    status: String(r.status),
    stage: (r.stage as string | null | undefined) ?? null,
    originatingDemandRef:
      (r.originatingDemandRef as string | null | undefined) ?? null,
    windowStart: toIso(r.windowStart),
    windowEnd: toIso(r.windowEnd),
    ownerId: String(r.ownerId),
    ownerName: (r.ownerName as string | null | undefined) ?? null,
  };
}

function toWindowRow(r: Record<string, unknown>): ScheduledWindowRow {
  return {
    ref: String(r.ref),
    title: String(r.title),
    windowStart: toIso(r.windowStart),
    windowEnd: toIso(r.windowEnd),
  };
}

export default async function ChangesPage({
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
  const filters = listChangesQuery.parse({
    status: first(sp.status),
    mine: first(sp.mine),
    scheduled: first(sp.scheduled),
  });

  const [rows, scheduledRows] = await Promise.all([
    listChanges(actor, filters).then((list) => list.map(toRow)),
    listChanges(actor, { scheduled: true }).then((list) =>
      list.map(toWindowRow),
    ),
  ]);

  return (
    <div className={styles.layout}>
      <ChangeRegister
        initialRows={rows}
        initialFilters={{
          status: filters.status,
          mine: filters.mine,
          scheduled: filters.scheduled,
        }}
        viewer={viewer}
      />
      <ScheduledWindows rows={scheduledRows} />
    </div>
  );
}
