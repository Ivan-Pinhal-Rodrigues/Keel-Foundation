import type { PrismaTransaction } from "@/server/db/tx";

export async function nextRef(
  tx: PrismaTransaction,
  prefix: "DEM" | "INC" | "CHG",
): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ value: number }[]>(
    `INSERT INTO "Counter" (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = "Counter".value + 1
     RETURNING value`,
    prefix,
  );
  const n = rows[0]!.value;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
