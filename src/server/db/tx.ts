import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

// The transaction-scoped client every module service takes: the domain write,
// the AuditEvent insert, and any Notification / EmailOutbox enqueue all run
// through one `PrismaTransaction` so they commit or roll back together.
export type PrismaTransaction = Prisma.TransactionClient;

export const runInTransaction = <T>(
  fn: (tx: PrismaTransaction) => Promise<T>,
): Promise<T> => prisma.$transaction(fn);
