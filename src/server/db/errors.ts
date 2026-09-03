import { Prisma } from "@prisma/client"; // value import — this file lives under src/server/db/**, allowed

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (
    !(e instanceof Prisma.PrismaClientKnownRequestError) ||
    e.code !== "P2002"
  )
    return false;
  if (target == null) return true;
  const t = (e.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(t) ? t.includes(target) : t === target;
}

export function isNotFound(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025"
  );
}
