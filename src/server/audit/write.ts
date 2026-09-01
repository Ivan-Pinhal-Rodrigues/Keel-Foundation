import type { Prisma } from "@prisma/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { getRequestId } from "@/server/context";

export type AuditInput = {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
};

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
      // `AuditInput.payload` stays a caller-friendly `Record<string, unknown>`;
      // the write narrows it to Prisma's JSON input type. Type-only import —
      // erased at compile, so the `@prisma/client` value boundary is untouched.
      payload: input.payload as Prisma.InputJsonObject | undefined,
      requestId: getRequestId(),
    },
  });
}
