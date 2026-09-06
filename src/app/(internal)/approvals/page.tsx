import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { listApprovalsForActor } from "@/server/modules/approval/service";
import { ApprovalsList } from "./ApprovalsList";

/**
 * `/approvals` — "approvals waiting on me" (spec 04 §7).
 *
 * `async` server component, mirroring `incidents/page.tsx`: it resolves the
 * actor from the session cookie (`getCurrentActor`, the RSC-safe reader),
 * redirects to `/login` when there is none, and calls the approval service
 * directly (a server component MAY import `src/server/**` — it is not `api/**`
 * and imports no Prisma). `listApprovalsForActor` already returns only the
 * PENDING requests whose current step's `requiredHat` this actor holds.
 */
export default async function ApprovalsPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const items = await listApprovalsForActor(actor);

  return <ApprovalsList items={items} />;
}
