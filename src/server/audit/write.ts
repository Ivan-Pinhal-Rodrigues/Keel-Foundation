import type { PrismaTransaction } from "@/server/db/tx";
import { getRequestId } from "@/server/context";

export type AuditInput = {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
};

// Prisma's generated `InputJsonValue` cannot be named here — the `@prisma/client`
// import is confined to `src/server/db/**` by the eslint boundary — so this local
// JSON shape narrows `payload` (kept as a caller-friendly `Record<string,
// unknown>` on `AuditInput`) at the `create` call.
type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export async function writeAudit(
  tx: PrismaTransaction,
  input: AuditInput,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload: (input.payload ?? undefined) as
        { [k: string]: Json } | undefined,
      requestId: getRequestId(),
    },
  });
}
