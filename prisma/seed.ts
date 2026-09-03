import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Keel-admin-2026");
  await prisma.user.upsert({
    where: { email: "admin@keel.local" },
    update: {},
    create: {
      email: "admin@keel.local",
      passwordHash,
      displayName: "Keel Admin",
      kind: "INTERNAL",
      hats: [
        "DEVELOPER",
        "REVIEWER",
        "BUSINESS_APPROVER",
        "TECHNICAL_APPROVER",
      ],
    },
  });
  await prisma.client.upsert({
    where: { name: "Northwind Traders" },
    update: {},
    create: { name: "Northwind Traders", isActive: true },
  });
  console.log(
    "seeded: admin@keel.local (Keel-admin-2026), client Northwind Traders",
  );
}

main().finally(() => prisma.$disconnect());
