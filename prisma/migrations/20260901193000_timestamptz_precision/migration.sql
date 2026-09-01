-- Migration: timestamptz_precision — set fractional-seconds precision to 3 on
-- every timestamptz column (34 columns across 11 tables).
--
-- WHY. The 20260901190000_timestamptz migration was meant (per its own header:
-- "convert ... to TIMESTAMPTZ(3)") to land millisecond precision, matching the
-- schema's `@db.Timestamptz(3)` on every DateTime field. Its SQL wrote
-- `SET DATA TYPE TIMESTAMPTZ` with no precision, so the columns landed at
-- Postgres' default precision 6 (microseconds). That leaves schema.prisma
-- (`Timestamptz(3)`) permanently drifted from the database, and every
-- `prisma migrate dev` re-proposes these ALTERs. This migration closes that gap
-- so the approvals/support migration that follows is a clean CREATE-only diff.
-- Discovered during Task 6; see task-6-report.md §"timestamptz drift".
--
-- SAFE. timestamptz(6) -> timestamptz(3) is an in-place precision narrowing on
-- the same base type — no `USING` clause needed. Values are rounded to the
-- millisecond. Dev/CI data is written by Prisma (already millisecond precision)
-- or by `now()`/`CURRENT_TIMESTAMP` (sub-millisecond digits are noise), so no
-- meaningful data is lost.
--
-- Fully reversible. Down path (widen back to the Postgres default precision):
--   ALTER TABLE "<t>" ALTER COLUMN "<c>" SET DATA TYPE TIMESTAMPTZ;
-- for each column below. The reverse cannot recover the rounded-off sub-ms
-- digits, but those never carried meaning.

-- AlterTable
ALTER TABLE "Change" ALTER COLUMN "windowStart" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "windowEnd" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "implementedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ChangeIncidentLink" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Demand" ALTER COLUMN "decidedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "GuestInvite" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "redeemedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Incident" ALTER COLUMN "dueAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "overdueNotifiedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "PostImplementationReview" ALTER COLUMN "reviewedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "lastSeenAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "VerificationToken" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "WorthAssessment" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);
