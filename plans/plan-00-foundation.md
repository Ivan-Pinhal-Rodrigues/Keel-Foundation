# Keel Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Keel application shell — schema, auth, authorization, audit log, notification plumbing, the shared Comment module, and the ported design system — so the four Phase 1 module teams can build in parallel against frozen interfaces.

**Architecture:** One Next.js 15 App Router application (single deployable). Route handlers are thin (validate → `authorize()` → module service → serialize). Module services own their tables and write domain rows, the audit event, and notifications in one transaction. Authorization is a deny-by-default policy layer keyed on `User.kind` + `User.hats`. The audit log is append-only, enforced by a restricted Postgres runtime role. The design system is ported from `prototypes/flightdeck.html` into React + CSS Modules.

**Tech Stack:** Node 22 LTS · Next.js 15 · React 19 · TypeScript strict · PostgreSQL 16 · Prisma 6 · Auth.js v5 (`next-auth@5`) + `@auth/prisma-adapter` · `@node-rs/argon2` · Zod · CSS Modules + Radix UI unstyled primitives · nodemailer · pino · Vitest · Playwright · pnpm.

**Spec:** [`specs/00-foundation.md`](specs/00-foundation.md) and [`specs/data-model.md`](specs/data-model.md). Cross-cutting design: [`DESIGN.md`](DESIGN.md) (esp. §3 architecture, §8 interface contracts).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Runtime / framework:** Node 22 LTS. Next.js 15 (App Router). React 19. TypeScript `strict: true`. pnpm, single package (not a monorepo).
- **Database:** PostgreSQL 16. Prisma 6 + Prisma Migrate. Two DB roles: `keel_app` (runtime — `INSERT, SELECT` only on `audit_event`), `keel_migrate` (DDL, used by the migration job/CLI). Wired as `DATABASE_URL` and `MIGRATE_DATABASE_URL`.
- **Auth:** Auth.js v5 (`next-auth@5`) + `@auth/prisma-adapter`, `session.strategy = "database"`. Credentials provider verifies email + password only; the sign-in flow **explicitly creates the `Session` row and sets the cookie** (mitigation for the credentials/DB-session gap). All auth resolution is by `Session` row lookup — no JWT is trusted. Cookie: httpOnly, `SameSite=Lax`, `Secure` in production, 30-day sliding expiry.
- **Passwords:** argon2id via `@node-rs/argon2`. Never log or serialize `passwordHash`.
- **Validation:** Zod schemas for every request and response, in `src/lib/api/schemas/`. No code generation (no OpenAPI doc).
- **Enum values:** `SCREAMING_SNAKE_CASE` Prisma enums exactly as listed in `specs/data-model.md`.
- **Layering:** Route handlers contain no business logic and never call Prisma directly for domain rules. Business rules and state transitions live in `src/server/modules/<module>/`. Every mutating service function performs the domain write + the `AuditEvent` insert + any notification enqueue in **one transaction**.
- **Authorization:** `authorize()` denies by default. A guest requesting a row that is not theirs gets **404, not 403** (existence is not revealed).
- **Styling:** Ported Flightdeck tokens (`src/styles/tokens.css`) + CSS Modules. Radix UI unstyled primitives for dialog / dropdown / tabs / tooltip. **No Tailwind. No component library.** Fonts self-hosted (no `fonts.googleapis.com` at runtime).
- **Notifications:** nodemailer, single SMTP transport from `SMTP_URL`. Mailpit locally (`localhost:1025`). The outbox worker holds a Postgres advisory lock so exactly one sender runs across replicas.
- **Logging:** pino, structured JSON. A `requestId` (UUID, minted in `middleware.ts`) ties audit events and log lines from one request together.
- **Testing:** TDD — RED / GREEN / REFACTOR, no implementation before a failing test. Vitest for unit + integration (against a real PostgreSQL). Playwright for E2E (Phase 2). Commit after every green step.
- **Naming:** Product name **Keel**. Package scope `@keel`. Kubernetes release name `keel`.
- **Commit trailer:** end every commit message with
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## File Structure

Created or established in Phase 0. Each file has one responsibility.

```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts
.eslintrc.cjs                      import-boundary rules (no Prisma in app/**, no cross-module imports)
vitest.config.ts, vitest.setup.ts  test env, per-file disposable schema
playwright.config.ts               E2E config (used from Phase 2)
docker-compose.yml                 postgres (2 roles via init) + mailpit
docker/postgres-init.sql           creates keel_app + keel_migrate roles
.env.example                       every variable documented
instrumentation.ts                 Next register() → starts the outbox worker once

prisma/
  schema.prisma                    ALL tables for ALL modules (created here, once)
  migrations/                      Prisma Migrate + the raw-SQL grant migration
  seed.ts                          stub in Phase 0; filled in Phase 2 (spec 08)

src/
  middleware.ts                    session resolution, requestId minting, route guarding
  instrumentation.ts               (re-exported)
  app/
    (internal)/layout.tsx          internal shell (uses AppShell) — screens are Phase 1
    portal/layout.tsx              guest shell — screens are Phase 1
    portal/invite/[token]/page.tsx invite redemption page (Phase 0)
    dev/components/page.tsx        component gallery (dev-only)
    api/
      auth/login/route.ts
      auth/logout/route.ts
      sessions/route.ts            GET list (own) / (TECHNICAL_APPROVER) all
      sessions/[id]/route.ts       DELETE revoke
      guest-invites/route.ts       POST create
      guest-invites/[token]/redeem/route.ts
      healthz/route.ts
      readyz/route.ts
  server/
    db/client.ts                   PrismaClient singleton
    db/tx.ts                       `PrismaTransaction` type alias + `runInTransaction`
    log.ts                         pino logger
    context.ts                     AsyncLocalStorage request context (requestId, actorId)
    ids/ref.ts                     nextRef(tx, prefix) → "DEM-0001"
    auth/
      password.ts                  hashPassword / verifyPassword (argon2id)
      config.ts                    Auth.js config (adapter, credentials provider)
      session.ts                   createSession / getSessionAndUser / destroySession / touchSession
      actor.ts                     loadActor(userId) → Actor ; getActor() (throws if none)
      invites.ts                   createInvite / redeemInvite
    policy/
      errors.ts                    ForbiddenError, NotFoundError, SegregationError
      actor.ts                     Actor type, isInternal, hasHat  (re-exported from auth/actor)
      actions.ts                   the action catalogue (string literal union)
      authorize.ts                 authorize(actor, action, subject)
      scope.ts                     scopeToClient(actor)
      subjects/                    demand.rule.ts, incident.rule.ts, change.rule.ts, approval.rule.ts, audit.rule.ts
      serialize.ts                 serializeFor(actor, entity, opts) + INTERNAL_ONLY_KEYS harness
    audit/
      write.ts                     writeAudit(tx, input)
    modules/
      notify/
        emit.ts                    emitNotification(tx, spec)
        worker.ts                  outbox loop (advisory lock, backoff)
        transport.ts               nodemailer transport factory
        templates/
          index.ts                 registry: name → (payload) => { subject, text, html }
          layout.ts                shared minimal HTML wrapper
          guest-invite.ts
      comment/
        index.ts                   addComment / listComments  (+ visibleToClient rule)
  lib/
    api/
      client.ts                    typed fetch wrapper
      schemas/                     Zod request/response schemas (per endpoint)
      errors.ts                    mapErrorToResponse(e) → { status, body }
  components/                      ported Flightdeck components (CSS Modules)
    AppShell/  Drawer/  Tile/  Panel/  DataTable/  Pill/  ActivityFeed/
    LifecycleStepper/  Toasts/  Timeline/  ThemeProvider/
  styles/
    tokens.css                     ported :root token blocks (light + dark)
    globals.css                    reset + base element styles (ported)
  app/fonts/                       Archivo, IBM Plex Sans, IBM Plex Mono (self-hosted)

CONTRACTS.md                       the frozen Phase 0 → Phase 1 interface contracts
```

---

## Task 1: Repo scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm dev|build|start|lint|typecheck|test|test:watch` scripts; path alias `@/*` → `src/*`.

- [ ] **Step 1: Scaffold the Next app**

Run:
```bash
pnpm dlx create-next-app@latest . --typescript --app --eslint --no-tailwind --src-dir --import-alias "@/*" --use-pnpm --no-turbopack
```
Accept the defaults it does not ask about. If it refuses to run in a non-empty directory, scaffold in a temp dir and copy `src/`, `package.json`, `tsconfig.json`, `next.config.*`, `next-env.d.ts` over, keeping the existing `plans/`, `prototypes/`, `.git/`.

- [ ] **Step 2: Set TypeScript to strict and add scripts**

In `tsconfig.json` ensure `"strict": true`, `"noUncheckedIndexedAccess": true`, `"paths": { "@/*": ["./src/*"] }`.

In `package.json` `scripts`:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint . --max-warnings 0",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:migrate": "dotenv -e .env -- prisma migrate dev",
  "db:deploy": "dotenv -e .env -- prisma migrate deploy",
  "db:reset": "dotenv -e .env -- prisma migrate reset --force",
  "seed": "dotenv -e .env -- tsx prisma/seed.ts"
}
```
Add dev deps: `vitest @vitest/coverage-v8 vite-tsconfig-paths @testing-library/react @testing-library/user-event jsdom dotenv-cli tsx prettier`.

- [ ] **Step 3: Configure eslint import boundaries**

`.eslintrc.cjs` — extend `next/core-web-vitals` and add:
```js
rules: {
  "no-restricted-imports": ["error", {
    paths: [{ name: "@prisma/client", message: "Import PrismaClient only via @/server/db/client" }],
    patterns: [
      { group: ["@/server/db/client"], message: "Route handlers and components must not import the Prisma client directly — go through a module service.", allowTypeImports: false },
    ],
  }],
}
```
Add an `overrides` block that RE-ALLOWS `@/server/db/client` for `src/server/**` (services legitimately use it). The net effect: `src/app/**` and `src/components/**` cannot import Prisma.

- [ ] **Step 4: Configure Vitest**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    coverage: { provider: "v8", reportsDirectory: "./coverage" },
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
  },
});
```
`vitest.setup.ts` — leave a comment placeholder for the per-file DB schema helper added in Task 3; for now export nothing.

- [ ] **Step 5: Write the smoke test**

`src/lib/__tests__/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("toolchain runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Verify lint, typecheck, test, build all pass**

Run each and confirm exit 0:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all green. `pnpm build` produces `.next/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with strict TS, eslint boundaries, vitest

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Local infrastructure (docker-compose + env)

**Files:**
- Create: `docker-compose.yml`, `docker/postgres-init.sql`, `.env.example`, `.env` (git-ignored)

**Interfaces:**
- Consumes: nothing.
- Produces: `postgres` on `localhost:5432` with roles `keel_app` / `keel_migrate`; `mailpit` SMTP on `localhost:1025`, UI on `localhost:8025`. Env vars `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SMTP_URL`, `APP_URL`, `NOTIFY_POLL_MS`, `LOG_LEVEL`.

- [ ] **Step 1: Write the Postgres init script**

`docker/postgres-init.sql`:
```sql
-- runs once on first cluster init (mounted into /docker-entrypoint-initdb.d)
CREATE ROLE keel_app  WITH LOGIN PASSWORD 'keel_app';
CREATE ROLE keel_migrate WITH LOGIN PASSWORD 'keel_migrate';
GRANT ALL PRIVILEGES ON DATABASE keel TO keel_migrate;
-- keel_app gets table grants from the grant migration (Task 7); default: connect + usage
GRANT CONNECT ON DATABASE keel TO keel_app;
```

- [ ] **Step 2: Write docker-compose.yml**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: keel
      POSTGRES_USER: keel_migrate
      POSTGRES_PASSWORD: keel_migrate
    ports: ["5432:5432"]
    volumes:
      - keel-db:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/00-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keel_migrate -d keel"]
      interval: 3s
      timeout: 3s
      retries: 20
  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]
volumes:
  keel-db:
```
Note: `POSTGRES_USER` is set to `keel_migrate` so the init script's `CREATE ROLE keel_migrate` would collide — instead, in the init script guard both with `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='keel_migrate') THEN CREATE ROLE ...; END IF; END $$;` OR set `POSTGRES_USER: postgres` and grant from there. Use `POSTGRES_USER: postgres`, `POSTGRES_PASSWORD: postgres`, `POSTGRES_DB: keel`, and have the init script create BOTH roles.

- [ ] **Step 3: Write .env.example and .env**

`.env.example` (copy to `.env`):
```
DATABASE_URL="postgresql://keel_app:keel_app@localhost:5432/keel?schema=public"
MIGRATE_DATABASE_URL="postgresql://keel_migrate:keel_migrate@localhost:5432/keel?schema=public"
SMTP_URL="smtp://localhost:1025"
APP_URL="http://localhost:3000"
NOTIFY_POLL_MS="5000"
LOG_LEVEL="debug"
```

- [ ] **Step 4: Verify the stack comes up**

Run:
```bash
docker compose up -d
docker compose exec db pg_isready -U postgres -d keel
docker compose exec db psql -U postgres -d keel -c "\du"
```
Expected: `pg_isready` → "accepting connections"; `\du` lists `keel_app` and `keel_migrate`. Mailpit UI loads at `http://localhost:8025`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker/ .env.example .gitignore
git commit -m "chore: docker-compose for local postgres (two roles) and mailpit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Prisma client singleton + test database harness

**Files:**
- Create: `prisma/schema.prisma` (datasource + generator only), `src/server/db/client.ts`, `src/server/db/tx.ts`, `src/test/db.ts`
- Modify: `vitest.setup.ts`
- Test: `src/server/db/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`, `MIGRATE_DATABASE_URL`.
- Produces: `prisma` (singleton `PrismaClient`), `PrismaTransaction` type (`Prisma.TransactionClient`), `runInTransaction(fn)`, and `withTestDb(fn)` for integration tests.

- [ ] **Step 1: Write the failing test**

`src/server/db/__tests__/client.test.ts`:
```ts
import { expect, test } from "vitest";
import { prisma } from "@/server/db/client";

test("prisma client connects and runs a trivial query", async () => {
  const rows = await prisma.$queryRawUnsafe<{ one: number }[]>("SELECT 1 as one");
  expect(rows[0]?.one).toBe(1);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test src/server/db`
Expected: FAIL — `@/server/db/client` not found.

- [ ] **Step 3: Write schema.prisma header and the client singleton**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
`src/server/db/client.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: ["warn", "error"] });
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
```
`src/server/db/tx.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

export type PrismaTransaction = Prisma.TransactionClient;
export const runInTransaction = <T>(fn: (tx: PrismaTransaction) => Promise<T>) =>
  prisma.$transaction(fn);
```

- [ ] **Step 4: Add the migrate+generate and test-db harness**

`src/test/db.ts`: create a helper that, per test file, creates a uniquely-named Postgres schema, runs `prisma migrate deploy` against it using `MIGRATE_DATABASE_URL` with `?schema=<name>`, returns a `PrismaClient` bound to it, and drops the schema on teardown. Wire `beforeAll`/`afterAll` via an exported `withTestDb()`.

`vitest.setup.ts`: load `.env` via `dotenv/config`.

Run once to generate the client:
```bash
docker compose up -d
pnpm dlx prisma generate
pnpm db:migrate --name init_datasource   # no models yet — creates the _prisma_migrations table
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm test src/server/db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/server/db/ src/test/ vitest.setup.ts package.json
git commit -m "feat: prisma client singleton and integration-test db harness

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Schema — enums, Counter, identity tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_identity/migration.sql` (generated)
- Test: `src/server/db/__tests__/identity-schema.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: models `User`, `Client`, `Session`, `Account`, `GuestInvite`, `Counter`; enums `UserKind`, `Hat`, and all other enums from `specs/data-model.md` (defined now so later tasks don't re-touch enum blocks).

- [ ] **Step 1: Write the failing test**

`src/server/db/__tests__/identity-schema.test.ts`:
```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("can create a Client and an INTERNAL user with hats", async () => {
  const client = await db().client.create({ data: { name: "Northwind", isActive: true } });
  const user = await db().user.create({
    data: {
      email: "cto@keel.local", passwordHash: "x", displayName: "CTO",
      kind: "INTERNAL", hats: ["DEVELOPER", "TECHNICAL_APPROVER"], isActive: true,
    },
  });
  expect(user.hats).toContain("TECHNICAL_APPROVER");
  expect(client.id).toBeTruthy();
});

test("a GUEST user carries a clientId", async () => {
  const client = await db().client.create({ data: { name: "Acme", isActive: true } });
  const guest = await db().user.create({
    data: { email: "g@acme.example", passwordHash: "x", displayName: "Guest",
            kind: "GUEST", hats: [], isActive: true, clientId: client.id },
  });
  expect(guest.clientId).toBe(client.id);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test identity-schema`
Expected: FAIL — `db().client` / `db().user` undefined (models don't exist).

- [ ] **Step 3: Add the enums and identity models**

Append to `prisma/schema.prisma` — every enum from `specs/data-model.md` §"Identity", §"Work items", §"Approvals", §"Support" (`UserKind`, `Hat`, `DemandSource`, `DemandStatus`, `WorthDecision`, `Effort`, `Level`, `Priority`, `IncidentStatus`, `ChangeType`, `ChangeStatus`, `ValueRealized`, `ApprovalStatus`, `StepStatus`, `DecisionKind`, `LinkKind`, `NotificationKind`, `OutboxStatus`), then:
```prisma
model Client {
  id        String   @id @default(cuid())
  name      String
  domain    String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]
  invites   GuestInvite[]
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  kind         UserKind
  hats         Hat[]
  displayName  String
  isActive     Boolean  @default(true)
  clientId     String?
  client       Client?  @relation(fields: [clientId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  userAgent    String?
  ip           String?
}

model Account {
  // Auth.js adapter table — unused in v1 (no OAuth), present for adapter completeness
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  @@unique([provider, providerAccountId])
}

model GuestInvite {
  id          String    @id @default(cuid())
  token       String    @unique          // stored hashed
  clientId    String
  client      Client    @relation(fields: [clientId], references: [id])
  email       String
  createdById String
  expiresAt   DateTime
  redeemedAt  DateTime?
  createdAt   DateTime  @default(now())
}

model Counter {
  name  String @id      // "DEM" | "INC" | "CHG"
  value Int    @default(0)
}
```

- [ ] **Step 4: Generate the migration**

Run:
```bash
pnpm db:migrate --name identity
```
Open the generated `migration.sql`, confirm it only `CREATE`s (no `DROP`). This is inherently reversible (drop the new tables/types); note that in the migration file as a leading comment.

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm test identity-schema`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat: schema — enums, Counter, identity tables (User, Client, Session, GuestInvite)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Schema — work-item tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_work_items/migration.sql`
- Test: `src/server/db/__tests__/work-item-schema.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: models `Demand`, `WorthAssessment`, `Incident`, `Change`, `ChangeIncidentLink`, `PostImplementationReview` — fields exactly per `specs/data-model.md`.

- [ ] **Step 1: Write the failing test**

`src/server/db/__tests__/work-item-schema.test.ts`:
```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("Demand with a 1:1 WorthAssessment", async () => {
  const u = await db().user.create({ data: { email: "a@k.local", passwordHash: "x", displayName: "A", kind: "INTERNAL", hats: ["DEVELOPER"] } });
  const d = await db().demand.create({
    data: { ref: "DEM-0001", title: "SSO", problem: "need it", source: "CLIENT", status: "SUBMITTED", submittedById: u.id,
            worth: { create: { costOfDelay: "high" } } },
    include: { worth: true },
  });
  expect(d.worth?.demandId).toBe(d.id);
});

test("Change links to an Incident via ChangeIncidentLink kinds", async () => {
  const u = await db().user.create({ data: { email: "b@k.local", passwordHash: "x", displayName: "B", kind: "INTERNAL", hats: ["DEVELOPER"] } });
  const inc = await db().incident.create({ data: { ref: "INC-0001", title: "down", description: "d", affectedService: "API",
    impact: "HIGH", urgency: "HIGH", priority: "P1", status: "NEW", reportedById: u.id, dueAt: new Date(), overdue: false } });
  const chg = await db().change.create({ data: { ref: "CHG-0001", title: "fix", changeType: "EMERGENCY", status: "DRAFT", ownerId: u.id } });
  const link = await db().changeIncidentLink.create({ data: { changeId: chg.id, incidentId: inc.id, kind: "FIXES" } });
  expect(link.kind).toBe("FIXES");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test work-item-schema` → FAIL (models undefined).

- [ ] **Step 3: Add the models**

Append to `prisma/schema.prisma` — `Demand`, `WorthAssessment` (incl. `isSingleApproverOverride Boolean @default(false)` and `overrideJustification String?`), `Incident` (incl. `overdue Boolean` and `overdueNotifiedAt DateTime?`), `Change` (incl. `changeType ChangeType`, `testPlan String?`), `PostImplementationReview`, `ChangeIncidentLink` with `@@unique([changeId, incidentId, kind])`. All FK names per `specs/data-model.md` (`submittedById`, `reportedById`, `ownerId`, `originatingDemandId @unique`, `convertedToChangeId @unique`). Add `createdAt`/`updatedAt` to every model. Add indexes on `status`, `clientId`, `assigneeId`, `ownerId` where the module specs filter.

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:migrate --name work_items`. Confirm `CREATE`-only. Add the reversibility comment.

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm test work-item-schema` → PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat: schema — Demand, Incident, Change, links, PIR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Schema — approvals and support tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_approvals_support/migration.sql`
- Test: `src/server/db/__tests__/approvals-support-schema.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces: models `ApprovalRequest`, `ApprovalStep`, `ApprovalDecision`, `Comment`, `AuditEvent`, `Notification`, `EmailOutbox` — fields exactly per `specs/data-model.md`. `EmailOutbox` includes `nextAttemptAt DateTime @default(now())`.

- [ ] **Step 1: Write the failing test**

`src/server/db/__tests__/approvals-support-schema.test.ts`:
```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("ApprovalRequest with ordered steps", async () => {
  const req = await db().approvalRequest.create({
    data: {
      subjectType: "Change", subjectId: "chg_x", policyKey: "change.highRisk",
      status: "PENDING", createdById: "u_x",
      steps: { create: [
        { order: 1, requiredHat: "TECHNICAL_APPROVER", status: "PENDING" },
        { order: 2, requiredHat: "BUSINESS_APPROVER", status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  expect(req.steps.map((s) => s.requiredHat)).toEqual(["TECHNICAL_APPROVER", "BUSINESS_APPROVER"]);
});

test("AuditEvent and EmailOutbox with defaults", async () => {
  const ev = await db().auditEvent.create({ data: { action: "x.y", subjectType: "Demand", subjectId: "d1", requestId: "r1" } });
  const out = await db().emailOutbox.create({ data: { toEmail: "a@b.c", template: "guest_invite", payload: {}, status: "PENDING" } });
  expect(ev.at).toBeInstanceOf(Date);
  expect(out.nextAttemptAt).toBeInstanceOf(Date);
  expect(out.attempts).toBe(0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test approvals-support-schema` → FAIL.

- [ ] **Step 3: Add the models**

Append `ApprovalRequest`, `ApprovalStep`, `ApprovalDecision`, `Comment` (`visibleToClient Boolean @default(false)`), `AuditEvent` (`payload Json?`, `requestId String`, `at DateTime @default(now())`, `actorId String?`), `Notification` (`payload Json`, `readAt DateTime?`), `EmailOutbox` (`attempts Int @default(0)`, `status OutboxStatus @default(PENDING)`, `nextAttemptAt DateTime @default(now())`, `payload Json`). Index `Comment(subjectType, subjectId)`, `AuditEvent(subjectType, subjectId)`, `AuditEvent(actorId)`, `Notification(userId, readAt)`, `EmailOutbox(status, nextAttemptAt)`.

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:migrate --name approvals_support`. Confirm `CREATE`-only + reversibility comment.

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm test approvals-support-schema` → PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat: schema — approvals engine and support tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Audit-log immutability — restricted grant migration

**Files:**
- Create: `prisma/migrations/<ts>_audit_grants/migration.sql` (hand-written, via `--create-only`)
- Test: `src/server/audit/__tests__/append-only.test.ts`

**Interfaces:**
- Consumes: Task 6 (the `AuditEvent` table exists), Task 3 (a `keel_app`-bound client).
- Produces: DB-enforced append-only `audit_event` for the `keel_app` role.

- [ ] **Step 1: Write the failing test**

`src/server/audit/__tests__/append-only.test.ts` — connect as `keel_app` (build a `PrismaClient` from `DATABASE_URL`, not the migrate URL) against a schema that has the grant migration applied:
```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

let appDb: PrismaClient;
let schema: string;

beforeAll(async () => {
  schema = await applyMigrationsToNewSchema();               // uses MIGRATE_DATABASE_URL
  appDb = new PrismaClient({ datasources: { db: { url: appUrlForSchema(schema) } } }); // keel_app creds
});
afterAll(async () => { await appDb.$disconnect(); await dropSchema(schema); });

test("keel_app can INSERT and SELECT audit_event", async () => {
  await appDb.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (id, action, "subjectType", "subjectId", "requestId") VALUES ('a1','x.y','Demand','d1','r1')`,
  );
  const rows = await appDb.$queryRawUnsafe(`SELECT id FROM "AuditEvent"`);
  expect(rows).toHaveLength(1);
});

test("keel_app cannot UPDATE or DELETE audit_event", async () => {
  await expect(appDb.$executeRawUnsafe(`UPDATE "AuditEvent" SET action='z' WHERE id='a1'`)).rejects.toThrow(/permission denied/i);
  await expect(appDb.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id='a1'`)).rejects.toThrow(/permission denied/i);
});
```
Add `applyMigrationsToNewSchema`, `dropSchema`, `appUrlForSchema` to `src/test/db.ts`.

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test append-only`
Expected: FAIL — `keel_app` currently has no table grants at all (INSERT fails), or (if a broad grant exists) the UPDATE/DELETE assertions fail.

- [ ] **Step 3: Write the grant migration**

Run: `pnpm dlx prisma migrate dev --create-only --name audit_grants`. Edit the generated `migration.sql`:
```sql
-- Baseline: keel_app gets normal DML on every current and future table…
GRANT USAGE ON SCHEMA public TO keel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO keel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO keel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO keel_app;

-- …except audit_event, which is append-only for the runtime role.
REVOKE UPDATE, DELETE ON "AuditEvent" FROM keel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO keel_app;  -- no-op safety for audit-like future tables
```
Add a `down` note in a comment: `GRANT UPDATE, DELETE ON "AuditEvent" TO keel_app;`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test append-only`
Expected: PASS — INSERT/SELECT succeed, UPDATE/DELETE rejected with "permission denied".

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/
git commit -m "feat: append-only audit_event enforced by restricted keel_app grants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Reference-number helper (`nextRef`)

**Files:**
- Create: `src/server/ids/ref.ts`
- Test: `src/server/ids/__tests__/ref.test.ts`

**Interfaces:**
- Consumes: `Counter` model (Task 4), `PrismaTransaction` (Task 3).
- Produces: `nextRef(tx: PrismaTransaction, prefix: "DEM" | "INC" | "CHG"): Promise<string>` → `"DEM-0001"`, monotonic, gap-free, safe under concurrency (atomic `UPDATE ... RETURNING`).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { nextRef } from "@/server/ids/ref";

const db = withTestDb();

test("nextRef increments per prefix and formats to 4 digits", async () => {
  const a = await nextRef(db(), "DEM");
  const b = await nextRef(db(), "DEM");
  const c = await nextRef(db(), "INC");
  expect(a).toBe("DEM-0001");
  expect(b).toBe("DEM-0002");
  expect(c).toBe("INC-0001");
});

test("nextRef is gap-free under parallel calls", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => nextRef(db(), "CHG")));
  const nums = results.map((r) => Number(r.split("-")[1])).sort((x, y) => x - y);
  expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test ids/__tests__/ref` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { PrismaTransaction } from "@/server/db/tx";

export async function nextRef(tx: PrismaTransaction, prefix: "DEM" | "INC" | "CHG"): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ value: number }[]>(
    `INSERT INTO "Counter" (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = "Counter".value + 1
     RETURNING value`,
    prefix,
  );
  const n = rows[0]!.value;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
```

- [ ] **Step 4: Run the test, verify it passes** — `pnpm test ids/__tests__/ref` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ids/
git commit -m "feat: gap-free per-type reference numbers (nextRef)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Password hashing (argon2id)

**Files:**
- Create: `src/server/auth/password.ts`
- Test: `src/server/auth/__tests__/password.test.ts`

**Interfaces:**
- Consumes: `@node-rs/argon2`.
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

test("hash round-trips and rejects the wrong password", async () => {
  const h = await hashPassword("correct horse battery staple");
  expect(h).not.toContain("correct horse");
  expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
  expect(await verifyPassword(h, "Tr0ub4dour")).toBe(false);
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test auth/__tests__/password` → FAIL.

- [ ] **Step 3: Implement**

```bash
pnpm add @node-rs/argon2
```
```ts
import { hash, verify } from "@node-rs/argon2";

const opts = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // argon2id defaults, OWASP-aligned

export const hashPassword = (plain: string) => hash(plain, opts);
export const verifyPassword = async (h: string, plain: string) => {
  try { return await verify(h, plain, opts); } catch { return false; }
};
```

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/password.ts src/server/auth/__tests__/ package.json
git commit -m "feat: argon2id password hashing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Logger and request context

**Files:**
- Create: `src/server/log.ts`, `src/server/context.ts`
- Test: `src/server/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `LOG_LEVEL`.
- Produces: `logger` (pino); `runWithContext(ctx, fn)`, `getRequestId(): string`, `getActorId(): string | null`, `setActorId(id)`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { getRequestId, runWithContext } from "@/server/context";

test("request context propagates through async boundaries", async () => {
  await runWithContext({ requestId: "req-123" }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    expect(getRequestId()).toBe("req-123");
  });
});

test("getRequestId throws outside a context", () => {
  expect(() => getRequestId()).toThrow(/no request context/i);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/server/log.ts
import pino from "pino";
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
```
```ts
// src/server/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { requestId: string; actorId?: string | null };
const als = new AsyncLocalStorage<Ctx>();

export const runWithContext = <T>(ctx: Ctx, fn: () => Promise<T>) => als.run(ctx, fn);
export function getRequestId(): string {
  const c = als.getStore();
  if (!c) throw new Error("no request context");
  return c.requestId;
}
export const getActorId = (): string | null => als.getStore()?.actorId ?? null;
export function setActorId(id: string) {
  const c = als.getStore();
  if (c) c.actorId = id;
}
```

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/log.ts src/server/context.ts src/server/__tests__/
git commit -m "feat: pino logger and AsyncLocalStorage request context

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `writeAudit`

**Files:**
- Create: `src/server/audit/write.ts`
- Test: `src/server/audit/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `PrismaTransaction` (Task 3), `getRequestId` (Task 10).
- Produces:
  ```ts
  type AuditInput = { actorId: string | null; action: string; subjectType: string; subjectId: string; payload?: Record<string, unknown> };
  writeAudit(tx: PrismaTransaction, input: AuditInput): Promise<void>
  ```
  `requestId` is read from the request context, not passed in.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { writeAudit } from "@/server/audit/write";

const db = withTestDb();

test("writeAudit inserts one row with the context requestId", async () => {
  await runWithContext({ requestId: "req-9" }, async () => {
    await writeAudit(db(), { actorId: "u1", action: "demand.create", subjectType: "Demand", subjectId: "d1", payload: { title: "x" } });
  });
  const rows = await db().auditEvent.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: "demand.create", requestId: "req-9", actorId: "u1" });
});

test("writeAudit throws when called outside a request context", async () => {
  await expect(writeAudit(db(), { actorId: null, action: "x", subjectType: "y", subjectId: "z" })).rejects.toThrow(/request context/i);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
import type { PrismaTransaction } from "@/server/db/tx";
import { getRequestId } from "@/server/context";

export type AuditInput = {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
};

export async function writeAudit(tx: PrismaTransaction, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload: input.payload ?? undefined,
      requestId: getRequestId(),
    },
  });
}
```

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/audit/write.ts src/server/audit/__tests__/write.test.ts
git commit -m "feat: writeAudit — the single append-only audit writer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Auth.js configuration

> Historical. Auth.js v5 was abandoned during Phase 0 — it cannot issue a
> database session for a credentials sign-in. Purpose-built auth
> (`verifyCredentials` / `createSession` / `login`) replaced it; there is no
> `AUTH_SECRET` (session tokens are random + sha256-hashed at rest). See
> `specs/00-foundation.md` §3.2.

**Files:**
- Create: `src/server/auth/config.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`
- Modify: `.env` (`AUTH_SECRET` — removed, see specs/00-foundation.md §3.2), `prisma/schema.prisma` if the adapter needs `VerificationToken` (add it)
- Test: `src/server/auth/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3), `verifyPassword` (Task 9).
- Produces: `authConfig` object; `handlers`, `auth`, `signIn`, `signOut` from `NextAuth(authConfig)`. Credentials provider `authorize` returns `{ id }` on success, `null` on failure — **it does not create a session** (Task 13 does).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, vi } from "vitest";
import { authConfig } from "@/server/auth/config";

test("credentials authorize returns the user id for a valid password", async () => {
  // arrange: seed a user via the test db, then:
  const provider = authConfig.providers[0] as any;
  const res = await provider.authorize({ email: "cto@keel.local", password: "secret12" });
  expect(res).toEqual({ id: expect.any(String) });
});

test("credentials authorize returns null for a bad password", async () => {
  const provider = authConfig.providers[0] as any;
  expect(await provider.authorize({ email: "cto@keel.local", password: "wrong" })).toBeNull();
});
```
(Use the `withTestDb` harness to seed the user; point `authConfig`'s Prisma usage at the test client via a small injectable or an env override.)

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```bash
pnpm add next-auth@beta @auth/prisma-adapter
```
```ts
// src/server/auth/config.ts
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "./password";

const creds = z.object({ email: z.string().email(), password: z.string().min(1) });

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = creds.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.isActive) return null;
        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;
        return { id: user.id };
      },
    }),
  ],
  callbacks: {
    session: ({ session, user }) => { if (session.user) session.user.id = user.id; return session; },
  },
} satisfies NextAuthConfig;
```
```ts
// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/config";
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
export const { GET, POST } = handlers;
```
Add `VerificationToken` model to the schema if `pnpm dlx prisma validate` / the adapter demands it; migrate `--name auth_verification_token`.

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/config.ts src/app/api/auth/ src/types/ prisma/ package.json
git commit -m "feat: Auth.js v5 config — Prisma adapter, database sessions, credentials provider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Login route with explicit session creation  ·  CONTINGENCY CHECKPOINT

**Files:**
- Create: `src/server/auth/session.ts`, `src/app/api/auth/login/route.ts`, `src/lib/api/schemas/auth.ts`
- Test: `src/server/auth/__tests__/session.test.ts`, `src/app/api/auth/__tests__/login.route.test.ts`

**Interfaces:**
- Consumes: `authConfig` (Task 12), `verifyPassword` (Task 9), `prisma`.
- Produces:
  ```ts
  createSession(userId: string, meta?: { userAgent?: string; ip?: string }): Promise<{ token: string; expires: Date }>
  getSessionAndUser(token: string): Promise<{ session: Session; user: User } | null>
  destroySession(token: string): Promise<void>
  touchSession(token: string): Promise<void>          // sliding expiry + lastSeenAt
  ```
  `POST /api/auth/login` — body `{ email, password }` → 200 + `Set-Cookie: authjs.session-token` on success, 401 otherwise. Rate-limited per IP.

- [ ] **Step 1: Write the failing test (session helpers)**

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { createSession, destroySession, getSessionAndUser } from "@/server/auth/session";

const db = withTestDb();

test("createSession writes exactly one row and getSessionAndUser resolves it", async () => {
  const u = await db().user.create({ data: { email: "x@k.local", passwordHash: "x", displayName: "X", kind: "INTERNAL", hats: ["DEVELOPER"] } });
  const { token } = await createSession(u.id);
  const rows = await db().session.findMany({ where: { userId: u.id } });
  expect(rows).toHaveLength(1);
  const resolved = await getSessionAndUser(token);
  expect(resolved?.user.id).toBe(u.id);
});

test("destroySession removes the row", async () => {
  const u = await db().user.create({ data: { email: "y@k.local", passwordHash: "x", displayName: "Y", kind: "INTERNAL", hats: [] } });
  const { token } = await createSession(u.id);
  await destroySession(token);
  expect(await getSessionAndUser(token)).toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement the session helpers**

```ts
// src/server/auth/session.ts
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db/client";

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string, meta?: { userAgent?: string; ip?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + THIRTY_DAYS);
  await prisma.session.create({ data: { sessionToken: token, userId, expires, userAgent: meta?.userAgent, ip: meta?.ip } });
  return { token, expires };
}
export async function getSessionAndUser(token: string) {
  const session = await prisma.session.findUnique({ where: { sessionToken: token }, include: { user: true } });
  if (!session || session.expires < new Date() || !session.user.isActive) return null;
  return { session, user: session.user };
}
export const destroySession = (token: string) =>
  prisma.session.deleteMany({ where: { sessionToken: token } }).then(() => undefined);
export async function touchSession(token: string) {
  await prisma.session.updateMany({
    where: { sessionToken: token },
    data: { lastSeenAt: new Date(), expires: new Date(Date.now() + THIRTY_DAYS) },
  });
}
```

- [ ] **Step 4: Write the failing test (login route)**

```ts
import { expect, test } from "vitest";
import { POST } from "@/app/api/auth/login/route";

test("valid credentials → 200 and a session cookie", async () => {
  // seed cto@keel.local / secret12 via the harness
  const res = await POST(new Request("http://x/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "cto@keel.local", password: "secret12" }),
  }));
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toMatch(/authjs\.session-token=/);
});

test("bad credentials → 401, no cookie", async () => {
  const res = await POST(new Request("http://x/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "cto@keel.local", password: "nope" }),
  }));
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
});
```

- [ ] **Step 5: Run it, verify it fails** — FAIL.

- [ ] **Step 6: Implement the login route**

`src/lib/api/schemas/auth.ts`: `export const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });`

`src/app/api/auth/login/route.ts`:
```ts
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { loginBody } from "@/lib/api/schemas/auth";
import { rateLimit } from "@/lib/api/rate-limit";

export async function POST(req: Request) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = loginBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const ua = (await headers()).get("user-agent") ?? undefined;
  const { token, expires } = await createSession(user.id, { userAgent: ua, ip });
  (await cookies()).set("authjs.session-token", token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires, path: "/",
  });
  return NextResponse.json({ ok: true });
}
```
Add `src/lib/api/rate-limit.ts` — a tiny in-memory token bucket keyed by string (documented as per-instance only; acceptable for v1).

- [ ] **Step 7: Run both test files, verify they pass** — PASS.

- [ ] **Step 8: CONTINGENCY DECISION — record it**

Confirm, by test, that:
- `POST /api/auth/login` creates exactly one `Session` row and the cookie resolves via `getSessionAndUser`.
- `signOut` / logout (Task 15) removes it.
- The Auth.js `auth()` helper, if used anywhere, agrees with `getSessionAndUser` (or is not used for authorization at all).

If any of these needed hacks against Auth.js internals or proved flaky across two runs, **switch to the purpose-built path**: keep `session.ts` exactly as written, drop `@auth/prisma-adapter` and the `[...nextauth]` route, and resolve auth only through `session.ts` + `middleware.ts`. Either way, **write the decision and its reasoning at the top of `specs/00-foundation.md` §3.2** and commit that edit with this task.

- [ ] **Step 9: Commit**

```bash
git add src/server/auth/session.ts src/app/api/auth/login/ src/lib/api/ specs/00-foundation.md
git commit -m "feat: login route with explicit DB session creation; record auth path decision

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: Middleware, actor loading, and the server-side actor helper

**Files:**
- Create: `src/middleware.ts`, `src/server/auth/actor.ts`, `src/server/policy/actor.ts`
- Test: `src/server/auth/__tests__/actor.test.ts`, `src/middleware.test.ts`

**Interfaces:**
- Consumes: `getSessionAndUser`, `touchSession` (Task 13), `runWithContext`, `setActorId` (Task 10).
- Produces:
  ```ts
  // src/server/policy/actor.ts
  export type Hat = "DEVELOPER" | "REVIEWER" | "BUSINESS_APPROVER" | "TECHNICAL_APPROVER";
  export type Actor = { id: string; kind: "INTERNAL" | "GUEST"; hats: Hat[]; clientId: string | null };
  export const isInternal = (a: Actor) => a.kind === "INTERNAL";
  export const hasHat = (a: Actor, h: Hat) => a.hats.includes(h);
  // src/server/auth/actor.ts
  loadActor(userId: string): Promise<Actor>            // throws if the user is gone/inactive
  getActor(): Promise<Actor>                            // from the request context; throws UnauthenticatedError
  getActorOrNull(): Promise<Actor | null>
  ```
  `middleware.ts` mints `requestId`, resolves the session, calls `touchSession`, and (for `(internal)` / `portal` / most `api` routes) redirects/401s when there is no actor.

- [ ] **Step 1: Write the failing test (loadActor)**

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { loadActor } from "@/server/auth/actor";

const db = withTestDb();

test("loadActor returns the INTERNAL shape", async () => {
  const u = await db().user.create({ data: { email: "i@k.local", passwordHash: "x", displayName: "I", kind: "INTERNAL", hats: ["DEVELOPER", "BUSINESS_APPROVER"] } });
  expect(await loadActor(u.id)).toEqual({ id: u.id, kind: "INTERNAL", hats: ["DEVELOPER", "BUSINESS_APPROVER"], clientId: null });
});

test("loadActor returns the GUEST shape with clientId", async () => {
  const c = await db().client.create({ data: { name: "N", isActive: true } });
  const u = await db().user.create({ data: { email: "g@n.example", passwordHash: "x", displayName: "G", kind: "GUEST", hats: [], clientId: c.id } });
  const a = await loadActor(u.id);
  expect(a).toEqual({ id: u.id, kind: "GUEST", hats: [], clientId: c.id });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement actor loading**

```ts
// src/server/policy/actor.ts  — types only (see Interfaces block)
// src/server/auth/actor.ts
import { prisma } from "@/server/db/client";
import { getActorId } from "@/server/context";
import type { Actor } from "@/server/policy/actor";

export class UnauthenticatedError extends Error {}

export async function loadActor(userId: string): Promise<Actor> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) throw new UnauthenticatedError("user not found or inactive");
  return { id: u.id, kind: u.kind, hats: u.hats, clientId: u.clientId };
}
export async function getActor(): Promise<Actor> {
  const id = getActorId();
  if (!id) throw new UnauthenticatedError("no actor in context");
  return loadActor(id);
}
export async function getActorOrNull(): Promise<Actor | null> {
  try { return await getActor(); } catch { return null; }
}
```

- [ ] **Step 4: Write the failing test (middleware)**

```ts
import { expect, test } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

test("no session cookie on a protected route → redirect to /login", async () => {
  const res = await middleware(new NextRequest("http://localhost:3000/overview"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/login");
});

test("no session cookie on an API route → 401 JSON", async () => {
  const res = await middleware(new NextRequest("http://localhost:3000/api/demands"));
  expect(res.status).toBe(401);
});

test("healthz is public", async () => {
  const res = await middleware(new NextRequest("http://localhost:3000/api/healthz"));
  expect(res.status).toBe(200); // NextResponse.next()
});
```

- [ ] **Step 5: Run it, verify it fails** — FAIL.

- [ ] **Step 6: Implement middleware**

```ts
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const PUBLIC = [/^\/api\/healthz$/, /^\/api\/readyz$/, /^\/api\/auth\/login$/, /^\/login$/, /^\/portal\/invite\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = randomUUID();
  const token = req.cookies.get("authjs.session-token")?.value ?? null;

  const res = PUBLIC.some((re) => re.test(pathname))
    ? NextResponse.next()
    : token
      ? NextResponse.next()
      : pathname.startsWith("/api/")
        ? NextResponse.json({ error: "unauthenticated" }, { status: 401 })
        : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));

  res.headers.set("x-request-id", requestId);
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"] };
```
Note: full session→actor resolution + `runWithContext` wrapping happens in a route-handler helper (`withRequest`) rather than middleware, because middleware runs on the edge runtime and cannot use Prisma. Add `src/lib/api/with-request.ts` exporting `withRequest(handler)` that: reads `x-request-id`, reads the cookie, calls `getSessionAndUser`, `touchSession`, then `runWithContext({ requestId, actorId }, () => handler(req, ctx))`. Every `api/**` route wraps its handler in `withRequest`.

- [ ] **Step 7: Run all three test files, verify they pass** — PASS.

- [ ] **Step 8: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts src/server/auth/actor.ts src/server/policy/actor.ts src/lib/api/with-request.ts
git commit -m "feat: middleware, actor loading, withRequest context wrapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: Logout and session management routes

**Files:**
- Create: `src/app/api/auth/logout/route.ts`, `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/route.ts`, `src/lib/api/schemas/sessions.ts`
- Test: `src/app/api/auth/__tests__/logout.route.test.ts`, `src/app/api/sessions/__tests__/sessions.route.test.ts`

**Interfaces:**
- Consumes: `destroySession` (Task 13), `getActor` (Task 14), `hasHat` (Task 14), `authorize` is NOT needed here (session ownership is a direct check).
- Produces: `POST /api/auth/logout` (deletes the caller's session, clears cookie); `GET /api/sessions` (caller's own sessions; a `TECHNICAL_APPROVER` may pass `?all=1` for everyone's); `DELETE /api/sessions/:id` (own, or any if `TECHNICAL_APPROVER`).

- [ ] **Step 1: Write the failing tests**

Cover: logout removes the row + clears the cookie; `GET /api/sessions` returns only the caller's rows; a `TECHNICAL_APPROVER` with `?all=1` sees others'; a non-`TECHNICAL_APPROVER` with `?all=1` still sees only their own; `DELETE` of someone else's session by a non-`TECHNICAL_APPROVER` → 404.

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement the three routes** using `withRequest`, `getActor`, `hasHat(actor, "TECHNICAL_APPROVER")`, and `destroySession`. Return `Session` rows with `passwordHash`-free shapes only (they have none, but assert the serializer shape in the test).

- [ ] **Step 4: Run the tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/logout/ src/app/api/sessions/ src/lib/api/schemas/sessions.ts
git commit -m "feat: logout and session list/revoke routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: Guest invite — create

**Files:**
- Create: `src/server/auth/invites.ts`, `src/app/api/guest-invites/route.ts`, `src/lib/api/schemas/invites.ts`
- Test: `src/server/auth/__tests__/invites.test.ts`, `src/app/api/guest-invites/__tests__/create.route.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getActor` (Task 14), `writeAudit` (Task 11), `APP_URL`.
- Produces:
  ```ts
  createInvite(actor: Actor, tx: PrismaTransaction, input: { clientId: string; email: string }): Promise<{ url: string }>
  ```
  `POST /api/guest-invites` — any `INTERNAL` actor — body `{ clientId, email }` → `{ url }`. Token is 32 random bytes, url-safe; **stored hashed** (`sha256`); `expiresAt = now + 7d`. Emits `guest_invite.created` audit.

- [ ] **Step 1: Write the failing test**

```ts
test("createInvite stores a hashed token and returns a redeem URL", async () => {
  const actor = { id: "u1", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null } as const;
  const client = await db().client.create({ data: { name: "N", isActive: true } });
  const { url } = await runWithContext({ requestId: "r", actorId: "u1" }, () =>
    runInTransaction((tx) => createInvite(actor, tx, { clientId: client.id, email: "g@n.example" })));
  const token = url.split("/").pop()!;
  const row = await db().guestInvite.findFirst();
  expect(row!.token).not.toBe(token);            // stored hashed, not raw
  expect(row!.token).toBe(sha256(token));
  expect(url).toContain("/portal/invite/");
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/server/auth/invites.ts
import { createHash, randomBytes } from "node:crypto";
import type { PrismaTransaction } from "@/server/db/tx";
import type { Actor } from "@/server/policy/actor";
import { isInternal } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";
import { writeAudit } from "@/server/audit/write";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createInvite(actor: Actor, tx: PrismaTransaction, input: { clientId: string; email: string }) {
  if (!isInternal(actor)) throw new ForbiddenError("internal only");
  const raw = randomBytes(32).toString("base64url");
  const invite = await tx.guestInvite.create({
    data: { token: sha256(raw), clientId: input.clientId, email: input.email, createdById: actor.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });
  await writeAudit(tx, { actorId: actor.id, action: "guest_invite.created", subjectType: "GuestInvite", subjectId: invite.id, payload: { clientId: input.clientId, email: input.email } });
  return { url: `${process.env.APP_URL}/portal/invite/${raw}` };
}
```
Route wraps this in `withRequest` + `runInTransaction`.

- [ ] **Step 4: Run both tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/invites.ts src/app/api/guest-invites/route.ts src/lib/api/schemas/invites.ts
git commit -m "feat: guest invite creation (hashed token, 7-day expiry, audited)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: Guest invite — redeem (route + page)

**Files:**
- Create: `src/app/api/guest-invites/[token]/redeem/route.ts`, `src/app/portal/invite/[token]/page.tsx`
- Modify: `src/server/auth/invites.ts` (add `redeemInvite`)
- Test: `src/server/auth/__tests__/redeem.test.ts`

**Interfaces:**
- Consumes: `sha256`, `hashPassword` (Task 9), `createSession` (Task 13), `writeAudit`.
- Produces:
  ```ts
  redeemInvite(tx: PrismaTransaction, input: { rawToken: string; name: string; password: string }): Promise<{ userId: string }>
  ```
  `POST /api/guest-invites/:token/redeem` — body `{ name, password }` → creates a `GUEST` `User` (that `clientId`, no hats), marks the invite redeemed, logs the user in (sets cookie). Expired / already-redeemed / unknown → **410**. Emits `guest_invite.redeemed`.

- [ ] **Step 1: Write the failing test**

Cover: valid raw token + name + password → a `GUEST` user with the invite's `clientId` and `hats: []`, invite `redeemedAt` set, a `Session` row exists; expired token → throws `GoneError`; second redeem of the same token → throws `GoneError`.

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement `redeemInvite`** — look up by `sha256(rawToken)`; reject if `redeemedAt != null` or `expiresAt < now`; create the user with `kind: "GUEST"`, `hats: []`, `clientId: invite.clientId`, `passwordHash: await hashPassword(password)`, `displayName: name`; set `redeemedAt`; `writeAudit`. The route then calls `createSession` and sets the cookie, and returns `{ ok: true }`.

- [ ] **Step 4: Build the page** — `src/app/portal/invite/[token]/page.tsx`: a server component that shows the inviting client's name (looked up by hashed token, read-only) and a small client-component form (name, password, confirm) posting to the redeem route; on 200 it `router.push("/portal")`; on 410 it shows "This invite link is no longer valid."

- [ ] **Step 5: Run the test, verify it passes** — PASS. Manually load `/portal/invite/<bad>` and confirm the invalid-state copy renders.

- [ ] **Step 6: Commit**

```bash
git add src/server/auth/invites.ts src/app/api/guest-invites/ src/app/portal/invite/
git commit -m "feat: guest invite redemption — creates scoped GUEST user and logs in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: Policy engine — errors, action catalogue, `authorize` skeleton

**Files:**
- Create: `src/server/policy/errors.ts`, `src/server/policy/actions.ts`, `src/server/policy/authorize.ts`, `src/server/policy/subjects/types.ts`
- Test: `src/server/policy/__tests__/authorize-skeleton.test.ts`

**Interfaces:**
- Consumes: `Actor`, `isInternal`, `hasHat` (Task 14).
- Produces:
  ```ts
  class ForbiddenError extends Error {}
  class NotFoundError extends Error {}
  class SegregationError extends Error { overrideAction: string }
  class UnauthenticatedError extends Error {}   // re-export from auth/actor
  type Action = /* the string-literal union from specs/00-foundation.md §4.2 */;
  type Subject =
    | { type: "none" } | { type: "audit" }
    | { type: "demand"; id?: string; submittedById?: string; clientId?: string | null; status?: DemandStatus }
    | { type: "incident"; id?: string; reportedById?: string; clientId?: string | null; status?: IncidentStatus }
    | { type: "change"; id?: string; ownerId?: string; status?: ChangeStatus; riskLevel?: Level }
    | { type: "approvalStep"; id?: string; requiredHat?: Hat; requestCreatedById?: string };
  function authorize(actor: Actor, action: Action, subject: Subject): void;   // throws; deny by default
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError } from "@/server/policy/errors";

const guest = { id: "g", kind: "GUEST", hats: [], clientId: "c1" } as const;

test("unknown action is denied", () => {
  // @ts-expect-error deliberately invalid
  expect(() => authorize(guest, "nonsense.action", { type: "none" })).toThrow(ForbiddenError);
});

test("a guest may create a demand", () => {
  expect(() => authorize(guest, "demand.create", { type: "demand" })).not.toThrow();
});

test("a guest may not view a change", () => {
  expect(() => authorize(guest, "change.view", { type: "change" })).toThrow(ForbiddenError);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement errors, the `Action` union, and the dispatch skeleton**

`actions.ts` — the full union, one string per line, exactly matching `specs/00-foundation.md` §4.2 (`"demand.create"`, `"demand.view"`, `"demand.score.value"`, … `"audit.export"`, `"notification.view.own"`).

`authorize.ts` — a `switch (action)` (or a `Record<Action, (a, s) => void>` table) that **throws `ForbiddenError` in the `default` branch**. Wire the trivial always-allow (`notification.view.own`) and always-internal (`audit.view`, `audit.export`, `comment.view.internal`) cases here; delegate the per-subject cases to Task 19's rule modules (import stubs that throw "not implemented" for now, replaced in Task 19).

- [ ] **Step 4: Run the test, verify it passes** — the three skeleton tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/policy/errors.ts src/server/policy/actions.ts src/server/policy/authorize.ts src/server/policy/subjects/types.ts
git commit -m "feat: policy engine skeleton — errors, action catalogue, deny-by-default authorize

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 19: Policy rules — the exhaustive allow/deny matrix

**Files:**
- Create: `src/server/policy/subjects/demand.rule.ts`, `incident.rule.ts`, `change.rule.ts`, `approval.rule.ts`, `audit.rule.ts`
- Modify: `src/server/policy/authorize.ts` (wire the rules in)
- Test: `src/server/policy/__tests__/matrix.test.ts`

**Interfaces:**
- Consumes: Task 18 types; `hasHat`, `isInternal`.
- Produces: complete `authorize` behaviour for every `Action` × actor-shape per `specs/00-foundation.md` §4.2, including the SoD branches that throw `SegregationError` with the correct `overrideAction`.

- [ ] **Step 1: Write the failing test — the full matrix**

A data-driven test: an array of `{ action, actor, subject, expect: "allow" | "deny" | "segregation:<overrideAction>" }` rows covering, at minimum:
- every action with a `GUEST` actor (only `demand.create`, `demand.view` own-client, `incident.create`, `incident.view` own-client, `comment.create` on a visible subject, `notification.view.own` allowed; everything else denied)
- `demand.score.value` — allowed for `BUSINESS_APPROVER`, denied for a `DEVELOPER`-only internal
- `demand.score.effort` — allowed for `TECHNICAL_APPROVER`, denied otherwise
- `demand.decide` by the demand's `submittedById` → `segregation:demand.decide.override`
- `change.approve.technical` by the change `ownerId` → `segregation:...`; by a non-owner `TECHNICAL_APPROVER` → allow; `change.approve.business` only when `riskLevel === "HIGH"`
- guest cross-client `demand.view` (`subject.clientId !== actor.clientId`) → deny (the caller maps this to 404)

```ts
import { describe, expect, it } from "vitest";
import { authorize } from "@/server/policy/authorize";
import { SegregationError } from "@/server/policy/errors";
import { CASES } from "./matrix.cases";

describe("authorize matrix", () => {
  it.each(CASES)("$action / $label", ({ actor, action, subject, expected }) => {
    if (expected === "allow") return expect(() => authorize(actor, action, subject)).not.toThrow();
    if (expected === "deny") return expect(() => authorize(actor, action, subject)).toThrow();
    // segregation:<overrideAction>
    try { authorize(actor, action, subject); throw new Error("expected SegregationError"); }
    catch (e) {
      expect(e).toBeInstanceOf(SegregationError);
      expect((e as SegregationError).overrideAction).toBe(expected.split(":")[1]);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (rules are stubs).

- [ ] **Step 3: Implement each rule module** per `specs/00-foundation.md` §4.2. Keep each rule a pure function `(actor, subject) => void`. `demand.rule.ts` handles `demand.*`; etc. SoD checks: `if (actor.id === subject.submittedById) throw new SegregationError("demand.decide.override")` (and the analogous change cases).

- [ ] **Step 4: Run the matrix test, verify it passes** — every row PASS.

- [ ] **Step 5: Refactor** — collapse duplication (a shared `requireHat`, `requireInternal`, `requireOwnClientOr404` helper). Re-run the matrix. Commit.

```bash
git add src/server/policy/subjects/ src/server/policy/authorize.ts src/server/policy/__tests__/
git commit -m "feat: complete authorization matrix with SoD override signalling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 20: `scopeToClient` and the guest 404 helper

**Files:**
- Create: `src/server/policy/scope.ts`
- Test: `src/server/policy/__tests__/scope.test.ts`

**Interfaces:**
- Consumes: `Actor`.
- Produces:
  ```ts
  scopeToClient(actor: Actor): { clientId: string } | Record<string, never>;   // {} for internal
  assertVisibleToGuest(actor: Actor, row: { clientId: string | null } | null): void;  // throws NotFoundError
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("scopeToClient returns a where fragment for guests, empty for internal", () => {
  expect(scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: "c1" })).toEqual({ clientId: "c1" });
  expect(scopeToClient({ id: "i", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null })).toEqual({});
});

test("assertVisibleToGuest throws NotFoundError for another client's row or a missing row", () => {
  const g = { id: "g", kind: "GUEST", hats: [], clientId: "c1" } as const;
  expect(() => assertVisibleToGuest(g, null)).toThrow(NotFoundError);
  expect(() => assertVisibleToGuest(g, { clientId: "c2" })).toThrow(NotFoundError);
  expect(() => assertVisibleToGuest(g, { clientId: "c1" })).not.toThrow();
  expect(() => assertVisibleToGuest({ ...g, kind: "INTERNAL", clientId: null }, { clientId: "c2" })).not.toThrow();
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — straightforward.

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/policy/scope.ts src/server/policy/__tests__/scope.test.ts
git commit -m "feat: scopeToClient and the guest 404 visibility helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 21: Serializer harness (`serializeFor` + `INTERNAL_ONLY_KEYS`)

**Files:**
- Create: `src/server/policy/serialize.ts`
- Test: `src/server/policy/__tests__/serialize.test.ts`

**Interfaces:**
- Consumes: `Actor`, `isInternal`.
- Produces:
  ```ts
  type SerializerConfig<T> = {
    internalOnlyKeys: readonly (keyof T)[];
    guestTransform?: (row: T) => Partial<T> & Record<string, unknown>;   // e.g. assignee → "Keel team"
  };
  serializeFor<T extends Record<string, unknown>>(actor: Actor, row: T, cfg: SerializerConfig<T>): Record<string, unknown>;
  assertNoInternalKeys(obj: Record<string, unknown>, keys: readonly string[]): void;   // test helper
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("guest serialization drops internal-only keys and applies the transform", () => {
  const row = { id: "1", title: "x", assigneeId: "u9", internalNote: "secret", clientId: "c1" };
  const out = serializeFor(
    { id: "g", kind: "GUEST", hats: [], clientId: "c1" },
    row,
    { internalOnlyKeys: ["assigneeId", "internalNote"], guestTransform: () => ({ assignee: "Keel team" }) },
  );
  expect(out).not.toHaveProperty("assigneeId");
  expect(out).not.toHaveProperty("internalNote");
  expect(out.assignee).toBe("Keel team");
});

test("internal serialization is a passthrough", () => {
  const row = { id: "1", assigneeId: "u9" };
  const out = serializeFor({ id: "i", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null }, row, { internalOnlyKeys: ["assigneeId"] });
  expect(out).toEqual(row);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/policy/serialize.ts src/server/policy/__tests__/serialize.test.ts
git commit -m "feat: role-aware serializer with internal-only key stripping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 22: `emitNotification`

**Files:**
- Create: `src/server/modules/notify/emit.ts`, `src/server/modules/notify/types.ts`
- Test: `src/server/modules/notify/__tests__/emit.test.ts`

**Interfaces:**
- Consumes: `PrismaTransaction`, `prisma` (for recipient resolution), `Hat` type.
- Produces:
  ```ts
  type NotificationKind = "ASSIGNED" | "APPROVAL_NEEDED" | "STATUS_CHANGED" | "COMMENTED" | "OVERDUE";
  type Recipients = { userIds: string[] } | { hat: Hat } | { audience: "ALL_INTERNAL" };
  type NotificationSpec = {
    recipients: Recipients; kind: NotificationKind;
    subjectType: string; subjectId: string; summary: string;
    excludeActorId?: string;
    email?: { template: string; payload: Record<string, unknown> };
  };
  emitNotification(tx: PrismaTransaction, spec: NotificationSpec): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("{ hat } resolves to active internal holders, excluding the actor, one Notification each", async () => {
  const a = await db().user.create({ data: { email: "a@k", passwordHash: "x", displayName: "A", kind: "INTERNAL", hats: ["TECHNICAL_APPROVER"] } });
  const b = await db().user.create({ data: { email: "b@k", passwordHash: "x", displayName: "B", kind: "INTERNAL", hats: ["TECHNICAL_APPROVER"] } });
  await runInTransaction((tx) => emitNotification(tx, {
    recipients: { hat: "TECHNICAL_APPROVER" }, kind: "APPROVAL_NEEDED",
    subjectType: "Change", subjectId: "chg1", summary: "needs you", excludeActorId: a.id,
  }));
  const notes = await db().notification.findMany();
  expect(notes.map((n) => n.userId)).toEqual([b.id]);
});

test("email spec writes an EmailOutbox row per recipient with an address", async () => { /* … */ });

test("nothing is written when the surrounding transaction rolls back", async () => {
  await expect(runInTransaction(async (tx) => {
    await emitNotification(tx, { recipients: { userIds: ["u1"] }, kind: "ASSIGNED", subjectType: "X", subjectId: "1", summary: "s" });
    throw new Error("boom");
  })).rejects.toThrow();
  expect(await db().notification.count()).toBe(0);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — resolve `recipients` to a `userId[]` (query `User` by `hat` = `hats has X` and `kind: "INTERNAL"` and `isActive`, or `audience` = all internal active, or the explicit list), drop `excludeActorId`, then `tx.notification.createMany` + (if `email`) look up each recipient's `email` and `tx.emailOutbox.createMany`.

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/notify/emit.ts src/server/modules/notify/types.ts src/server/modules/notify/__tests__/emit.test.ts
git commit -m "feat: emitNotification — in-app rows + email outbox in the caller's transaction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 23: Email outbox worker

**Files:**
- Create: `src/server/modules/notify/worker.ts`, `src/server/modules/notify/transport.ts`
- Test: `src/server/modules/notify/__tests__/worker.test.ts`

**Interfaces:**
- Consumes: `prisma`, `EmailOutbox` model, a `Transport` interface `{ send(msg: { to: string; subject: string; text: string; html: string }): Promise<void> }`, the template registry (Task 24 — import a stub now, real in 24).
- Produces:
  ```ts
  runOutboxOnce(deps: { transport: Transport; now?: () => Date }): Promise<{ sent: number; failed: number; deferred: number }>
  startOutboxWorker(): void            // setInterval loop, guarded to one per process
  backoffMs(attempts: number): number  // min(2^attempts, 30) minutes
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("sends a PENDING row and marks it SENT", async () => {
  await db().emailOutbox.create({ data: { toEmail: "a@b.c", template: "guest_invite", payload: { url: "x" }, status: "PENDING" } });
  const transport = { send: vi.fn().mockResolvedValue(undefined) };
  const res = await runOutboxOnce({ transport });
  expect(res.sent).toBe(1);
  expect((await db().emailOutbox.findFirst())!.status).toBe("SENT");
});

test("on transient failure: attempts++ and nextAttemptAt pushed into the future", async () => {
  await db().emailOutbox.create({ data: { toEmail: "a@b.c", template: "guest_invite", payload: {}, status: "PENDING" } });
  const transport = { send: vi.fn().mockRejectedValue(new Error("smtp down")) };
  await runOutboxOnce({ transport });
  const row = (await db().emailOutbox.findFirst())!;
  expect(row.attempts).toBe(1);
  expect(row.status).toBe("PENDING");
  expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
});

test("gives up at attempts >= 6 → FAILED", async () => { /* seed attempts: 5, fail once */ });

test("a row with nextAttemptAt in the future is skipped (deferred)", async () => { /* … */ });
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement `runOutboxOnce`** — `SELECT ... FOR UPDATE SKIP LOCKED` the `PENDING` rows with `nextAttemptAt <= now` (via `prisma.$transaction` + `$queryRaw`), render each through the template registry, `transport.send`, then set `SENT`/`sentAt` or bump `attempts` + `lastError` + `nextAttemptAt = now + backoffMs(attempts)` (→ `FAILED` at 6). Wrap the whole tick in `pg_try_advisory_lock(hashtext('keel:outbox'))` / `pg_advisory_unlock`; return early if not acquired. Never throw out of the tick — catch, `logger.error`, continue.

`startOutboxWorker` — `if (globalThis.__keelOutbox) return;` guard; `setInterval(() => runOutboxOnce({ transport: realTransport() }).catch(...) , Number(process.env.NOTIFY_POLL_MS ?? 5000))`.

- [ ] **Step 4: Write the advisory-lock test** — two concurrent `runOutboxOnce` calls against one pending row send it exactly once.

- [ ] **Step 5: Run all worker tests, verify they pass** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/notify/worker.ts src/server/modules/notify/transport.ts src/server/modules/notify/__tests__/worker.test.ts
git commit -m "feat: email outbox worker — advisory lock, backoff, fail at 6

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 24: nodemailer transport + template registry

**Files:**
- Create: `src/server/modules/notify/templates/index.ts`, `templates/layout.ts`, `templates/guest-invite.ts`
- Modify: `src/server/modules/notify/transport.ts` (real nodemailer transport)
- Test: `src/server/modules/notify/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: `SMTP_URL`, `APP_URL`.
- Produces:
  ```ts
  type Rendered = { subject: string; text: string; html: string };
  type Template = (payload: Record<string, unknown>) => Rendered;
  templates: Record<string, Template>;      // { guest_invite: ... } in Phase 0
  renderTemplate(name: string, payload: Record<string, unknown>): Rendered;   // throws on unknown name
  nodemailerTransport(): Transport;          // from SMTP_URL
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("guest_invite renders a subject, plain text, and HTML with the redeem URL", () => {
  const r = renderTemplate("guest_invite", { clientName: "Northwind", url: "http://localhost:3000/portal/invite/abc" });
  expect(r.subject).toMatch(/Keel/);
  expect(r.text).toContain("http://localhost:3000/portal/invite/abc");
  expect(r.html).toContain("abc");
});

test("renderTemplate throws for an unknown template", () => {
  expect(() => renderTemplate("nope", {})).toThrow(/unknown template/i);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `layout.ts` a minimal inline-styled HTML wrapper (product name, a `<a>` button, no tracking); `guest-invite.ts` a `Template`; `index.ts` the registry + `renderTemplate`. `transport.ts`: `nodemailer.createTransport(process.env.SMTP_URL)` wrapped to the `Transport` interface.

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Integration check** — with `docker compose up`, run a one-off script that enqueues a `guest_invite` row and calls `runOutboxOnce({ transport: nodemailerTransport() })`; confirm the mail appears in Mailpit (`http://localhost:8025`). Delete the script.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/notify/templates/ src/server/modules/notify/transport.ts package.json
git commit -m "feat: email template registry and nodemailer transport (guest_invite)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 25: Worker bootstrap (`instrumentation.ts`)

**Files:**
- Create: `instrumentation.ts` (project root), `src/server/bootstrap.ts`
- Test: `src/server/__tests__/bootstrap.test.ts`

**Interfaces:**
- Consumes: `startOutboxWorker` (Task 23).
- Produces: `register()` (Next instrumentation hook) that calls `startOutboxWorker()` exactly once, only in the Node.js runtime.

- [ ] **Step 1: Write the failing test**

```ts
test("startOutboxWorker is idempotent", async () => {
  const { bootstrap } = await import("@/server/bootstrap");
  const spy = vi.spyOn(globalThis as any, "setInterval");
  bootstrap(); bootstrap();
  expect(spy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `bootstrap.ts` with the `globalThis.__keelBooted` guard calling `startOutboxWorker()`. `instrumentation.ts`:
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("@/server/bootstrap");
    bootstrap();
  }
}
```

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts src/server/bootstrap.ts src/server/__tests__/bootstrap.test.ts
git commit -m "feat: start the outbox worker via Next instrumentation hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 26: Shared Comment module

**Files:**
- Create: `src/server/modules/comment/index.ts`, `src/server/modules/comment/serialize.ts`
- Test: `src/server/modules/comment/__tests__/comment.test.ts`

**Interfaces:**
- Consumes: `PrismaTransaction`, `Actor`, `isInternal`, `writeAudit`, `emitNotification`, `NotFoundError`.
- Produces:
  ```ts
  addComment(tx, { actor: Actor; subjectType: "Demand"|"Incident"|"Change"; subjectId: string; body: string; visibleToClient?: boolean; notifyUserId?: string }): Promise<Comment>
  listComments(actor: Actor, subjectType: string, subjectId: string): Promise<SerializedComment[]>   // guest → visibleToClient only, author masked "Keel team"
  ```
  Rules: a `GUEST` author's comment is forced `visibleToClient = true`. A guest `listComments` on a `Change` throws `NotFoundError`. Every add emits `comment.created` audit + a `COMMENTED` notification to `notifyUserId` when given.

- [ ] **Step 1: Write the failing tests** — the list from `specs/00-foundation.md` §8: guest comment forced client-visible; guest never sees an internal note; internal author masked to "Keel team" for a guest reader; guest `listComments` on a change → `NotFoundError`; audit + notification emitted.

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement** `addComment` / `listComments` + a `serializeComment(actor, row)` that masks `authorId` → `{ author: "Keel team" }` for guest readers and drops non-visible rows.

- [ ] **Step 4: Run the tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/comment/
git commit -m "feat: shared Comment module with visibleToClient rule and author masking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 27: Health and readiness endpoints

**Files:**
- Create: `src/app/api/healthz/route.ts`, `src/app/api/readyz/route.ts`
- Test: `src/app/api/__tests__/health.route.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `GET /api/healthz` → always `200 {"status":"ok"}` unless the process is broken. `GET /api/readyz` → `200` when `SELECT 1` succeeds **and** there are no pending migrations; `503 {"checks":{...}}` naming the failing check otherwise.

- [ ] **Step 1: Write the failing test**

```ts
test("healthz is always 200", async () => {
  const res = await GET_healthz();
  expect(res.status).toBe(200);
});

test("readyz is 200 when the DB is reachable and migrations are applied", async () => {
  const res = await GET_readyz();
  expect(res.status).toBe(200);
});

test("readyz is 503 when a migration is pending", async () => {
  // point at a schema that is one migration behind, or stub the pending-check
  const res = await GET_readyz();
  expect(res.status).toBe(503);
  expect((await res.json()).checks.migrations).toBe("pending");
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `readyz` runs `prisma.$queryRaw\`SELECT 1\`` and compares `prisma/migrations/` folder names against the `_prisma_migrations` table (or shells `prisma migrate status` — the folder-diff is faster and dependency-free). Keep both checks in the JSON body.

- [ ] **Step 4: Run the test, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/healthz/ src/app/api/readyz/ src/app/api/__tests__/
git commit -m "feat: /healthz and /readyz endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 28: Design tokens, self-hosted fonts, ThemeProvider

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/globals.css`, `src/components/ThemeProvider/ThemeProvider.tsx`, `src/app/fonts/index.ts`
- Modify: `src/app/layout.tsx`
- Test: `src/components/ThemeProvider/__tests__/theme.test.tsx`

**Interfaces:**
- Consumes: `prototypes/flightdeck.html` (source of the token blocks + base CSS).
- Produces: CSS custom properties (light + dark) on `:root`; `<ThemeProvider>` that reads a `keel-theme` cookie and sets `data-theme`; `useTheme()` → `{ theme, setTheme }`. Fonts: `archivo`, `plexSans`, `plexMono` from `next/font/local`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, ThemeToggle } from "@/components/ThemeProvider/ThemeProvider";

test("toggle flips data-theme on the document element", async () => {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
  await userEvent.click(screen.getByRole("button", { name: /theme/i }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Port the tokens and base CSS** — copy the `:root { … }`, `@media (prefers-color-scheme:dark) { :root:not([data-theme="light"]) { … } }`, and `:root[data-theme="dark"] { … }` blocks from `prototypes/flightdeck.html:9-90` verbatim into `src/styles/tokens.css`. Copy the `/* BASE */` rules (`prototypes/flightdeck.html:92-110`) into `globals.css`, replacing the three `font-family` stacks with CSS vars fed by `next/font`. Download the three font families (Archivo, IBM Plex Sans, IBM Plex Mono — the weights used in the prototype) into `src/app/fonts/` and wire `next/font/local` in `src/app/fonts/index.ts`, exposing `--sans`, `--display`, `--mono` on `<body>`.

- [ ] **Step 4: Implement `ThemeProvider`** — client component; initial theme from a `keel-theme` cookie (or `undefined` = system); `setTheme` writes the cookie and `document.documentElement.dataset.theme`. `ThemeToggle` is a button cycling light → dark → system.

- [ ] **Step 5: Run the test, verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/ src/components/ThemeProvider/ src/app/fonts/ src/app/layout.tsx
git commit -m "feat: ported design tokens, self-hosted fonts, ThemeProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 29: Ported components — AppShell, Drawer, Toasts

**Files:**
- Create: `src/components/AppShell/*`, `src/components/Drawer/*`, `src/components/Toasts/*`
- Test: `src/components/AppShell/__tests__/`, `Drawer/__tests__/`, `Toasts/__tests__/`

**Interfaces:**
- Consumes: tokens (Task 28), `@radix-ui/react-dialog`.
- Produces:
  ```ts
  <AppShell nav={NavItem[]} currentKey={string} user={{ name: string; sub: string }} topbar={ReactNode}>{children}</AppShell>
  type NavItem = { key: string; label: string; href: string; icon: ReactNode; badge?: number };
  <Drawer open={boolean} onClose={() => void} title={ReactNode} idLabel={string}>{children}</Drawer>
  <ToastProvider>{children}</ToastProvider> ; toast(message: string): void
  ```

- [ ] **Step 1: Write the failing tests** — `AppShell` renders each nav item and sets `aria-current="page"` on `currentKey`; renders a `<800px` bottom-bar layout (assert a class or computed style via a matchMedia mock). `Drawer` traps focus, closes on `Escape` and on scrim click, and is not in the DOM when `open={false}`. `toast("hi")` renders a live-region node that auto-dismisses.

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement** — `AppShell.module.css` ports `.app`, `.rail`, `.brand`, `.nav`, `.rail-foot`, `.topbar`, `.stage`, `.view` and the `@media (max-width:920px)` block from `prototypes/flightdeck.html:112-200, 574-609`. `Drawer` wraps `@radix-ui/react-dialog` (`pnpm add @radix-ui/react-dialog`) and ports `.scrim` / `.drawer` / `.dr-head` / `.dr-body` from `:411-448`. `Toasts` ports `.toasts` / `.toast` from `:564-571` behind an imperative `toast()` backed by a context + `useSyncExternalStore` (or a simple event emitter).

- [ ] **Step 4: Run the tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell/ src/components/Drawer/ src/components/Toasts/ package.json
git commit -m "feat: ported AppShell, Drawer (Radix Dialog), Toasts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 30: Ported components — Tile, Panel, Pill/PriorityTag/RiskLabel, DataTable, ActivityFeed, Timeline

**Files:**
- Create: `src/components/Tile/*`, `Panel/*`, `Pill/*` (exports `Pill`, `PriorityTag`, `RiskLabel`, `EnvTag`), `DataTable/*` (exports `DataTable`, `LifecyclePips`), `ActivityFeed/*`, `Timeline/*`
- Test: one `__tests__` per component

**Interfaces:**
- Consumes: tokens (Task 28).
- Produces:
  ```ts
  <Tile label={string} value={ReactNode} sub={ReactNode?} tone={"ok"|"warn"|"crit"|"info"?} />
  <Panel title={ReactNode} count={ReactNode?} pad={boolean?}>{children}</Panel>
  <Pill tone={"ok"|"warn"|"crit"|"info"|"accent"} dot={boolean?}>{children}</Pill>
  <PriorityTag priority={"P1"|"P2"|"P3"|"P4"} />
  <RiskLabel level={"LOW"|"MEDIUM"|"HIGH"} />
  <DataTable columns={Column<Row>[]} rows={Row[]} onRowClick={(row) => void} getRowId={(row) => string} />
  type Column<R> = { key: string; header: string; width?: string; cell: (row: R) => ReactNode };
  <LifecyclePips stages={string[]} currentIndex={number} parkedIndex={number?} />
  <ActivityFeed items={{ id: string; text: ReactNode; meta: string; tone?: string }[]} />
  <Timeline items={{ time: string; text: ReactNode }[]} />
  ```

- [ ] **Step 1: Write the failing tests** — each component: renders its content; `DataTable` calls `onRowClick` with the row and renders one `cell` per column; `PriorityTag` applies the `p1..p4` class; `LifecyclePips` marks `currentIndex` with the `now` class and earlier pips `past`.

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement** — port the CSS for each from `prototypes/flightdeck.html`: tiles `:202-214`, panel `:215-223`, pills/pri/risk `:255-289`, table `:302-327`, stage pips `:487-493`, feed `:244-253`, timeline `:440-448`. Keep every component a thin presentational wrapper — no data fetching.

- [ ] **Step 4: Run the tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tile/ src/components/Panel/ src/components/Pill/ src/components/DataTable/ src/components/ActivityFeed/ src/components/Timeline/
git commit -m "feat: ported Tile, Panel, Pill family, DataTable, ActivityFeed, Timeline

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 31: Ported component — LifecycleStepper (the centrepiece)

**Files:**
- Create: `src/components/LifecycleStepper/LifecycleStepper.tsx`, `LifecycleStepper.module.css`
- Test: `src/components/LifecycleStepper/__tests__/stepper.test.tsx`

**Interfaces:**
- Consumes: tokens.
- Produces (this is a **frozen contract** — Phase 1 owner C builds the change drawer against it):
  ```ts
  type GateItem = { key: string; label: string; hint?: string; done: boolean };
  type Stage = { key: string; label: string; purpose: string; gate: GateItem[] };
  type LifecycleStepperProps = {
    stages: Stage[];
    currentStageKey: string;
    canAdvance: boolean;                                   // server-computed
    onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
    onAdvance?: (fromStageKey: string) => void;
    readOnly?: boolean;
  };
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
test("Advance is disabled until every gate item on the current stage is done", async () => {
  const onAdvance = vi.fn();
  const { rerender } = render(<LifecycleStepper stages={STAGES} currentStageKey="assess" canAdvance={false} onAdvance={onAdvance} />);
  expect(screen.getByRole("button", { name: /advance/i })).toBeDisabled();
  rerender(<LifecycleStepper stages={STAGES} currentStageKey="assess" canAdvance onAdvance={onAdvance} />);
  await userEvent.click(screen.getByRole("button", { name: /advance/i }));
  expect(onAdvance).toHaveBeenCalledWith("assess");
});

test("clicking a gate checkbox calls onToggleGate with the keys and next value", async () => { /* … */ });

test("readOnly hides Advance and disables the gate checkboxes", () => { /* … */ });

test("past stages render as done, future stages muted", () => { /* … */ });
```

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement** — port `.stepper`, `.step`, `.step-node`, `.step-rail`, `.gate`, `.gate-box`, `.advance-row` from `prototypes/flightdeck.html:450-486`. Derive `done` / `current` / `upcoming` per stage from `currentStageKey` and stage order. The `Advance` button is `disabled={!canAdvance || readOnly}`. Gate checkboxes are `<button>`s calling `onToggleGate` (no-op when `readOnly`).

- [ ] **Step 4: Run the tests, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LifecycleStepper/
git commit -m "feat: LifecycleStepper — stages, exit-gate checklist, gated Advance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 32: Component gallery + Phase 0 contract freeze

**Files:**
- Create: `src/app/dev/components/page.tsx`, `CONTRACTS.md`
- Modify: `src/middleware.ts` (allow `/dev/*` only when `NODE_ENV !== "production"`)
- Test: `src/app/dev/__tests__/gallery.test.tsx`

**Interfaces:**
- Consumes: every component from Tasks 28–31.
- Produces: `/dev/components` (dev-only) rendering every component in light and dark; `CONTRACTS.md` — the authoritative copy of the Phase 0 → Phase 1 interfaces.

- [ ] **Step 1: Write the failing test** — the gallery page renders without throwing and contains a labelled section for each of: AppShell, Drawer, Toasts, Tile, Panel, Pill, PriorityTag, RiskLabel, DataTable, LifecyclePips, ActivityFeed, Timeline, LifecycleStepper.

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Build the gallery page** — one section per component with representative props, wrapped in `<ThemeProvider>`, plus a theme toggle. Gate the route in `middleware.ts` (`/dev/` → 404 in production).

- [ ] **Step 4: Run the test, verify it passes** — PASS. Run `pnpm dev`, open `/dev/components`, eyeball light + dark.

- [ ] **Step 5: Write `CONTRACTS.md`** — copy, verbatim from the code as built: the `Actor` / `Subject` / `Action` types; `authorize` / `scopeToClient` / `assertVisibleToGuest` signatures; `writeAudit` + `AuditInput`; `emitNotification` + `NotificationSpec` + `NotificationKind`; `addComment` / `listComments`; `nextRef`; `createSession` / `getSessionAndUser`; `LifecycleStepperProps` and the other component prop types; the `withRequest` wrapper contract. Add a header: "Frozen at end of Phase 0. Changes require a note to all Phase 1 owners (A: demand, B: incident, C: change+approvals, D: dashboards+portal)."

- [ ] **Step 6: Full verification pass**

Run and confirm all green:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
docker compose up -d && pnpm db:reset && pnpm db:deploy   # migrations apply clean from zero
```
Confirm: login → protected route → logout works end to end (a short manual check or a Playwright smoke); the outbox worker logs a startup line; `/api/readyz` returns 200.

- [ ] **Step 7: Commit**

```bash
git add src/app/dev/ CONTRACTS.md src/middleware.ts
git commit -m "feat: dev component gallery; freeze Phase 0 interface contracts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** — every objective in `specs/00-foundation.md`:
- §1 auth/session → Tasks 12–15, 17
- §2 schema baseline + restricted grants → Tasks 4–7
- §2.1 two-role setup → Tasks 2, 7
- §3 Auth.js + mitigation + contingency → Tasks 12, 13 (checkpoint)
- §4 policy layer (authorize, actions, scope) → Tasks 18–20
- §4.2 action catalogue → Task 18 (list) + Task 19 (behaviour)
- §5 guest scoping + serializer → Tasks 20, 21
- §6 audit log (writeAudit + append-only test + requestId) → Tasks 7, 10, 11
- §7 notification plumbing (emit + worker + transport + templates + bootstrap) → Tasks 22–25
- §8 Comment module → Task 26
- §9 design-system port (tokens, fonts, all components, stepper, gallery) → Tasks 28–32
- §10 definition of done → Task 32 Step 6
- `nextRef` (data-model.md §"Reference counters") → Task 8
- health endpoints (DESIGN §10) → Task 27

**2. Placeholder scan** — component-port tasks reference exact prototype line ranges rather than reproducing CSS; each has concrete prop types and test assertions. Test bodies with `/* … */` (Tasks 15, 17, 19, 23, 26, 30) name exactly which cases to cover from the spec — acceptable as they enumerate scenarios, not hide code, but the executor must write real assertions. No "TBD"/"handle errors appropriately".

**3. Type consistency** — `Actor` shape identical across Tasks 14, 18, 21, 22, 26. `PrismaTransaction` from Task 3 used everywhere. `NotificationKind` / `NotificationSpec` identical in Tasks 22–24. `writeAudit(tx, input)` signature stable from Task 11. `LifecycleStepperProps` matches `DESIGN.md` §8 / `specs/00-foundation.md` §9.3.

**Gap found and closed:** `withRequest` wrapper (session→actor→context) was implicit in the spec; added explicitly in Task 14 Step 6 and listed in `CONTRACTS.md` (Task 32).

---

## Execution Handoff

Phase 0 is the critical path — everything in Phase 1 depends on the frozen contracts. Recommended: **subagent-driven-development**, fresh subagent per task, review between tasks.

After Phase 0 lands and `CONTRACTS.md` is frozen, the Phase 1 module plans (`plan-01` … `plan-08`) get written against the real code — they will reference actual signatures, not projected ones.
