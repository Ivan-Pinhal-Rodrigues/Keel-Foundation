import { PrismaClient } from "@prisma/client";

// The one PrismaClient for the running app. Connects with DATABASE_URL (the
// restricted `keel_app` role). Cached on globalThis in dev so Next's hot reload
// does not open a new pool on every edit. Import this — never `@prisma/client`
// directly (enforced by eslint `no-restricted-imports`).

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
