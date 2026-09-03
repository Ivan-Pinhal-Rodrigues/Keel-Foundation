# Phase 1 Task 0 — Hardening & Shared Infrastructure (plan-1a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the fixes and shared infrastructure that the three pre-merge reviews found Phase 1's four module teams (A demand, B incident, C change+approvals, D dashboards+portal) all need — before any module work starts. Nothing here is a new feature; it is the foundation Phase 0 was one layer short of.

**Architecture:** Small, surgical changes to already-frozen Phase 0 code (the guest-scoping helpers, the comment module signature, two component contracts) plus new leaf modules (`getCurrentActor`, a typed fetch client, an audit-label registry, a DB-error helper, a seed script) plus a test-harness rework (migrate-once template schema, cloned per file). Every frozen-contract change is mirrored into `CONTRACTS.md` in the same task.

**Tech Stack:** as Phase 0 — Next 15.5.24, React 19, TS strict + `noUncheckedIndexedAccess`, Prisma 6.19.3 / PG16, Zod ^4.5.4, Vitest 3.2.7.

**Spec:** the three pre-merge review reports (security a2ae917b, architecture a9396466, testing a8919fe) recorded verbatim in `.superpowers/sdd/plan-00-foundation/progress.md`. Cross-ref [`../CONTRACTS.md`](../CONTRACTS.md), [`DESIGN.md`](DESIGN.md) §8.

## Global Constraints

Same as [`plan-01-demand.md`](plan-01-demand.md) "Global Constraints" — read that section. In addition:

- **Every task that changes a `CONTRACTS.md` interface updates `CONTRACTS.md` in the same commit**, and adds a line to a new `## Phase 1 amendments` section at the top of `CONTRACTS.md` noting what changed and which plans consume the new version.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green before every commit.** After Task 11 (harness rework), also confirm `pnpm test` is green on **5 consecutive runs** (the pre-merge flake was 1-in-6 — a real regression check).
- **Order matters:** Tasks 1–3 (RSC auth, guest-scoping) unblock plan-01. Tasks 8–9 (`LifecycleStepper`, `DataTable`) must land before plan-02/plan-03 start. Task 11 (harness) should land before plan-01 Task 2 so the module tests are written against the new helper.

---

## File Structure

**New leaves**
- `src/server/auth/current.ts` — `getCurrentActor()` / `whoami()`: cookie-based actor resolution for server components & layouts.
- `src/server/db/errors.ts` — `isUniqueViolation(e, target?)` and friends: typed Prisma error predicates.
- `src/server/audit/labels.ts` — `AUDIT_ACTION_LABELS` registry + `auditActionLabel(action)`: the one action→phrasing map, shared by the demand drawer timeline and the dashboard activity feed.
- `src/lib/api/client.ts` — `apiFetch<T>(path, opts)`: the typed fetch wrapper `DESIGN.md` §8 promised. Response schemas live in `src/lib/api/schemas/<module>.ts` next to the request schemas.
- `src/test/route-db.ts` — `withRouteTestDb()`: the route-handler test harness (mock `@/server/db/client` + schema lifecycle in one call).
- `prisma/seed.ts` — idempotent minimal seed (one internal admin, one demo client).

**Modified frozen code**
- `src/server/policy/scope.ts` — `scopeToClient` fails closed.
- `src/server/policy/serialize.ts` — add `serializePick` (allowlist); `serializeFor` kept, re-documented as internal-use-only / deprecated for guest output.
- `src/server/policy/__tests__/scope.test.ts` — rewrite the fail-open assertion.
- `src/server/modules/comment/index.ts` — `addComment` / `listComments` take an authorized `CommentSubject` and assert ownership internally.
- `src/components/LifecycleStepper/LifecycleStepper.tsx` + `.module.css` + tests — `blockedReason`, per-stage terminal state.
- `src/components/DataTable/DataTable.tsx` + `.module.css` + tests — optional `onRowClick`, non-`role="button"` affordance.
- `src/app/dev/components/Gallery.tsx` — exercise the new props.
- `src/test/db.ts` — migrate-once template schema, clone per file.
- `prisma/migrations/<ts>_user_guest_client_check/migration.sql` — the CHECK constraint.
- `prisma/migrations/<ts>_audit_default_privileges/migration.sql` — narrow the default grant.
- `src/lib/api/errors.ts` — no change; Task 6 only adds tests.
- `CONTRACTS.md` — amended by Tasks 1, 2, 3, 4, 7, 8, 9.
- `src/app/api/auth/login/route.ts` — Task 12 rate-limit key.
- `package.json` — `prisma.seed` key (Task 10).
- `DESIGN.md` §Migrations / a new `docs/migrations.md` — Task 5 convention.

---

## Task 1: RSC actor resolution — `getCurrentActor()` / `whoami()`  [unblocks plan-01]

**Problem (architecture C1):** `getActor()` / `getActorOrNull()` read only from `AsyncLocalStorage`, populated only by `withRequest`. Next 15 does not run server-component renders inside that context, so in any `async` layout/page `getActorOrNull()` always returns `null` and `getActor()` always throws. plan-01's `(internal)/layout.tsx` would redirect every authenticated user back to `/login`.

**Files:**
- Create: `src/server/auth/current.ts`, `src/server/auth/__tests__/current.test.ts`
- Modify: `CONTRACTS.md` (§6 + new amendments section)

**Interfaces:**
- Consumes: `cookies` (`next/headers`), `SESSION_COOKIE` (`@/lib/http/cookies`), `getSessionAndUser` (`@/server/auth/session`), `Actor` (`@/server/policy/actor`).
- Produces:
  ```ts
  export type Me = { id: string; kind: $Enums.UserKind; hats: $Enums.Hat[]; clientId: string | null; displayName: string; email: string };
  export function getCurrentActor(): Promise<Actor | null>;   // server components / layouts only
  export function whoami(): Promise<Me | null>;                // same, plus displayName + email for the shell
  ```

- [ ] **Step 1: Write the failing test** — `src/server/auth/__tests__/current.test.ts`

```ts
import { afterEach, expect, test, vi } from "vitest";
import { withTestDb } from "@/test/db";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { createSession } from "@/server/auth/session";

const db = withTestDb();

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "authjs.session-token" && cookieStore.value ? { value: cookieStore.value } : undefined) }),
}));
afterEach(() => { cookieStore.value = undefined; });

test("no cookie → null", async () => {
  expect(await getCurrentActor()).toBeNull();
  expect(await whoami()).toBeNull();
});

test("a live session cookie → the Actor and Me", async () => {
  const u = await db().user.create({ data: { email: "ceo@k", passwordHash: "x", displayName: "Casey", kind: "INTERNAL", hats: ["BUSINESS_APPROVER"] } });
  const { token } = await createSession(u.id, undefined, db() as never);
  cookieStore.value = token;

  const actor = await getCurrentActor();
  expect(actor).toMatchObject({ id: u.id, kind: "INTERNAL", hats: ["BUSINESS_APPROVER"], clientId: null });
  const me = await whoami();
  expect(me).toMatchObject({ id: u.id, displayName: "Casey", email: "ceo@k" });
});

test("an expired / unknown token → null (not a throw)", async () => {
  cookieStore.value = "deadbeef";
  expect(await getCurrentActor()).toBeNull();
});

test("a deactivated user's live token → null", async () => {
  const u = await db().user.create({ data: { email: "x@k", passwordHash: "x", displayName: "X", kind: "INTERNAL", hats: [], isActive: false } });
  const { token } = await createSession(u.id, undefined, db() as never);
  cookieStore.value = token;
  expect(await getCurrentActor()).toBeNull();
});
```
(`getSessionAndUser` returns `null` for a deactivated user — confirm against `src/server/auth/session.ts`; if it does not filter `isActive`, `getCurrentActor` must.)

- [ ] **Step 2: Run it, verify it fails** — `pnpm test src/server/auth/__tests__/current.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/server/auth/current.ts`**

```ts
import { cookies } from "next/headers";
import type { $Enums } from "@prisma/client";
import { SESSION_COOKIE } from "@/lib/http/cookies";
import { getSessionAndUser } from "@/server/auth/session";
import type { Actor } from "@/server/policy/actor";

export type Me = {
  id: string;
  kind: $Enums.UserKind;
  hats: $Enums.Hat[];
  clientId: string | null;
  displayName: string;
  email: string;
};

async function resolve(): Promise<{ user: Me } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await getSessionAndUser(token);
  if (!s || !s.user.isActive) return null;
  const { id, kind, hats, clientId, displayName, email } = s.user;
  return { user: { id, kind, hats, clientId, displayName, email } };
}

/** The current request's actor, for server components and layouts. Returns
 *  `null` (never throws) when there is no usable session. Do NOT use in an
 *  `api/**` route — those use `getActor()` inside `withRequest`. */
export async function getCurrentActor(): Promise<Actor | null> {
  const r = await resolve();
  if (!r) return null;
  const { id, kind, hats, clientId } = r.user;
  return { id, kind, hats, clientId };
}

/** Like `getCurrentActor` but with `displayName` + `email` for the AppShell
 *  user block. Server components / layouts only. */
export async function whoami(): Promise<Me | null> {
  return (await resolve())?.user ?? null;
}
```

- [ ] **Step 4: Run the tests, verify they pass.**

- [ ] **Step 5: Update `CONTRACTS.md`** — add a `## Phase 1 amendments` section directly under the header:
  ```markdown
  ## Phase 1 amendments

  Interfaces changed after the Phase 0 freeze. Each was reviewed and agreed with all Phase 1 owners.

  - **plan-1a Task 1** — `src/server/auth/current.ts` added. Server components and layouts resolve the actor with `getCurrentActor()` / `whoami()` (read the cookie via `next/headers`). `getActor()` / `getActorOrNull()` (§6) remain **API-route-only** — they read the request context that only `withRequest` populates and throw / return null everywhere else. **Never call an audit-writing service from a server component** — `writeAudit` needs the request context and will throw `"no request context"`.
  ```
  and a `### src/server/auth/current.ts` entry in §6 with the two signatures.

- [ ] **Step 6: Commit**

```bash
git add src/server/auth/current.ts src/server/auth/__tests__/current.test.ts CONTRACTS.md
git commit -F- <<'EOF'
feat: getCurrentActor / whoami — actor resolution for server components

getActor() only reads the withRequest request context, which Next does not
run RSC renders inside; a layout calling getActorOrNull() always saw null.
getCurrentActor() reads the session cookie via next/headers instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: `scopeToClient` fails closed + a DB CHECK constraint  [unblocks plan-01 guest reads]

**Problem (security I1, testing I4a):** `scopeToClient` returns `{}` (matches every row) for a guest whose `clientId` is `null`. The two assert-helpers fail closed on the same condition; only this where-fragment fails open. `scope.test.ts:22` codifies it as "defensive". The invariant "GUEST ⇒ clientId non-null" has no DB backing.

**Files:**
- Modify: `src/server/policy/scope.ts`, `src/server/policy/__tests__/scope.test.ts`, `CONTRACTS.md`
- Create: `prisma/migrations/<ts>_user_guest_client_check/migration.sql` (+ `schema.prisma` gets no model change — the CHECK is raw SQL; add a `/// @check` comment noting it)

- [ ] **Step 1: Rewrite the failing test** — replace `scope.test.ts`'s "returns empty object for guest with null clientId (defensive)" case with:

```ts
test("a guest with a null clientId gets an impossible-match scope, never {}", () => {
  const scoped = scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: null });
  // the exact shape is an implementation detail; the invariant is: it must not be
  // an empty object, and spreading it into a `where` must match zero rows.
  expect(scoped).not.toEqual({});
  expect(Object.keys(scoped)).toContain("clientId");
});

test("an internal actor gets {}", () => {
  expect(scopeToClient({ id: "u", kind: "INTERNAL", hats: [], clientId: null })).toEqual({});
});

test("a guest with a clientId gets that clientId", () => {
  expect(scopeToClient({ id: "g", kind: "GUEST", hats: [], clientId: "c1" })).toEqual({ clientId: "c1" });
});
```

Add an integration test in a `*.integration.test.ts` (needs `withTestDb`): create a guest user, then `db().$executeRaw` an `UPDATE "User" SET "clientId" = NULL WHERE id = ...` — **assert it throws** (the CHECK constraint rejects it). If the raw update somehow succeeds, a `findMany({ where: { ...scopeToClient(guestActorWithNullClientId) } })` must return `[]`, not every row.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `scope.ts`**

```ts
export function scopeToClient(
  actor: Actor,
): { clientId: string } | Record<string, never> {
  if (actor.kind !== "GUEST") return {};
  // A guest must always have a clientId (enforced by a DB CHECK constraint). If
  // one somehow does not, fail closed: an impossible clientId matches no rows,
  // rather than {} which would match every row.
  return { clientId: actor.clientId ?? " __no_such_client__" };
}
```

- [ ] **Step 4: Add the CHECK migration** — `prisma migrate dev --create-only --name user_guest_client_check`, then edit `migration.sql`:
```sql
-- A GUEST user is always scoped to a client. INTERNAL users have no client.
-- The runtime relies on this: policy/scope.ts and policy/subjects/helpers.ts
-- fail closed on a null clientId, but a NULL here would still be a data bug.
-- Down: ALTER TABLE "User" DROP CONSTRAINT "user_guest_has_client";
ALTER TABLE "User"
  ADD CONSTRAINT "user_guest_has_client"
  CHECK ("kind" <> 'GUEST' OR "clientId" IS NOT NULL);
```
Then `prisma migrate dev --name user_guest_client_check` to apply + record the checksum. Add a comment on `model User` in `schema.prisma`: `// CHECK constraint user_guest_has_client (kind <> GUEST OR clientId IS NOT NULL) — see migration 2026..._user_guest_client_check`.

- [ ] **Step 5: Run tests + full gate + `prisma migrate status` clean.**

- [ ] **Step 6: Update `CONTRACTS.md`** §1 `scopeToClient` entry + a Phase 1 amendments bullet:
  > **plan-1a Task 2** — `scopeToClient` now fails closed: a guest with a null `clientId` (a data bug the new `user_guest_has_client` CHECK constraint prevents) gets an impossible-match `{ clientId: … }`, never `{}`. Spreading it into a `where` matches zero rows. Consumed by plan-01 Task 2's `listDemands`, plan-02, plan-04.

- [ ] **Step 7: Commit**

```bash
git add src/server/policy/scope.ts src/server/policy/__tests__/ prisma/ schema.prisma CONTRACTS.md
git commit -F- <<'EOF'
fix: scopeToClient fails closed; CHECK constraint for GUEST clientId

A guest row with a null clientId made scopeToClient return {}, which spread
into a Prisma where matches every client's rows. Now impossible-match, and a
DB CHECK stops the null from existing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: `serializePick` — allowlist serializer  [unblocks plan-01 guest reads]

**Problem (security I2, testing I4b):** `serializeFor` copies the whole row then deletes an enumerated denylist. Any column added later ships to guests by default, and `assertNoInternalKeys` checks the same list so it cannot catch an un-listed leak. plan-01's `serializeDemand` and every Phase 1 guest response are slated to use it.

**Files:**
- Modify: `src/server/policy/serialize.ts`, `src/server/policy/__tests__/serialize.test.ts`, `CONTRACTS.md`

**Interfaces:**
- Produces:
  ```ts
  /** Guest output. Internal readers get every key in `internalView` (default: the
   *  row as-is). Guests get ONLY `guestKeys`, then `guestTransform`'s result
   *  merged over. Adding a column defaults to hidden. */
  export function serializePick<T extends Record<string, unknown>>(
    actor: Actor,
    row: T,
    cfg: {
      guestKeys: readonly (keyof T)[];
      guestTransform?: (row: T) => Record<string, unknown>;
      internalOmit?: readonly (keyof T)[]; // rare: keys even an internal reader shouldn't see (e.g. a password hash)
    },
  ): Record<string, unknown>;
  ```

- [ ] **Step 1: Write the failing tests** (extend `serialize.test.ts`)

```ts
import { serializePick } from "@/server/policy/serialize";

const internal = { id: "u", kind: "INTERNAL", hats: [], clientId: null } as const;
const guest = { id: "g", kind: "GUEST", hats: [], clientId: "c1" } as const;
const row = { id: "d1", title: "T", secretNote: "internal", clientId: "c1", futureColumnAddedLater: "oops" } as Record<string, unknown>;

test("guest gets only the allowlisted keys — a new column is hidden by default", () => {
  const out = serializePick(guest, row, { guestKeys: ["id", "title"] });
  expect(out).toEqual({ id: "d1", title: "T" });
  expect(out).not.toHaveProperty("secretNote");
  expect(out).not.toHaveProperty("futureColumnAddedLater");
});

test("guestTransform merges over the picked keys", () => {
  const out = serializePick(guest, row, { guestKeys: ["id"], guestTransform: (r) => ({ status: "In review", clientName: "N" }) });
  expect(out).toEqual({ id: "d1", status: "In review", clientName: "N" });
});

test("internal reader gets the whole row, minus internalOmit", () => {
  expect(serializePick(internal, row, { guestKeys: ["id"] })).toEqual(row);
  expect(serializePick(internal, row, { guestKeys: ["id"], internalOmit: ["secretNote"] })).not.toHaveProperty("secretNote");
});

test("mutating the result never touches the row", () => {
  const out = serializePick(guest, row, { guestKeys: ["id", "title"] });
  (out as Record<string, unknown>).title = "changed";
  expect(row.title).toBe("T");
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
export function serializePick<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: {
    guestKeys: readonly (keyof T)[];
    guestTransform?: (row: T) => Record<string, unknown>;
    internalOmit?: readonly (keyof T)[];
  },
): Record<string, unknown> {
  if (isInternal(actor)) {
    const out: Record<string, unknown> = { ...row };
    for (const k of cfg.internalOmit ?? []) delete out[k as string];
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of cfg.guestKeys) out[k as string] = row[k];
  if (cfg.guestTransform) Object.assign(out, cfg.guestTransform(row));
  return out;
}
```
Re-document `serializeFor` with a header comment: *"Denylist serializer. Safe for internal-to-internal shaping only. For any output that a guest can see, use `serializePick` — a new column must not leak by omission."* Keep `serializeFor` (the session-list serializer and any internal-only use may keep it) but grep for guest-facing callers; there are none in Phase 0 (`serializeComment` is hand-rolled).

- [ ] **Step 4: Run tests + full gate.**

- [ ] **Step 5: `CONTRACTS.md`** §1 — add `serializePick` next to `serializeFor`, mark `serializeFor` "internal shaping only — do not use for guest output". Amendments bullet: *"plan-1a Task 3 — `serializePick` (allowlist) added; `plan-01` `serializeDemand` and all Phase 1 guest serializers use it, not `serializeFor`."*

- [ ] **Step 6: Commit**

```bash
git add src/server/policy/serialize.ts src/server/policy/__tests__/serialize.test.ts CONTRACTS.md
git commit -F- <<'EOF'
feat: serializePick — allowlist serializer for guest output

serializeFor is spread-and-delete: a new column leaks to guests unless
someone remembers to list it. serializePick builds from an allowlist, so
adding a column defaults to hidden.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Comment module takes an authorized subject

**Problem (security I3):** `addComment` / `listComments` take a bare `subjectId: string` and (except the Change guard) do not check that the demand/incident belongs to the guest's client. A Phase 1 portal comment route that forgets the ownership check leaks another client's `visibleToClient` thread.

**Files:**
- Modify: `src/server/modules/comment/index.ts`, `src/server/modules/comment/__tests__/comment.test.ts`, `CONTRACTS.md`

**Interfaces:**
- Produces (changed):
  ```ts
  export type CommentSubject =
    | { type: "Demand"; id: string; clientId: string | null }
    | { type: "Incident"; id: string; clientId: string | null }
    | { type: "Change"; id: string };

  export function addComment(tx: PrismaTransaction, input: {
    actor: Actor; subject: CommentSubject; body: string;
    visibleToClient?: boolean; notifyUserId?: string;
  }): Promise<Comment>;

  export function listComments(actor: Actor, subject: CommentSubject, client?: PrismaClient): Promise<SerializedComment[]>;
  ```

- [ ] **Step 1: Update the failing tests** — `comment.test.ts`: every call site changes from `(…, "Demand", subjectId, …)` to `(…, { type: "Demand", id, clientId }, …)`. Add:

```ts
test("a guest commenting on / listing a Demand from another client → NotFoundError", async () => {
  const guestOfC1 = { id: "g1", kind: "GUEST", hats: [], clientId: "c1" } as const;
  await expect(listComments(guestOfC1, { type: "Demand", id: "d-of-c2", clientId: "c2" })).rejects.toBeInstanceOf(NotFoundError);
  await expect(db().$transaction((tx) => addComment(tx, { actor: guestOfC1, subject: { type: "Demand", id: "d-of-c2", clientId: "c2" }, body: "x" }))).rejects.toBeInstanceOf(NotFoundError);
});

test("a guest commenting on their own client's Demand → allowed, forced visibleToClient", async () => { /* unchanged behaviour, new signature */ });

test("guest + Change subject → NotFoundError (unchanged)", async () => { /* … */ });
```

- [ ] **Step 2: Run, verify fail** (compile errors + the new assertions).

- [ ] **Step 3: Implement** — at the top of both functions:
```ts
import { requireOwnClientOr404 } from "@/server/policy/subjects/helpers";
// ...
if (subject.type === "Change") {
  if (!isInternal(actor)) throw new NotFoundError("not found");
} else {
  requireOwnClientOr404(actor, subject.clientId); // internal → passes; guest cross-client → NotFoundError
}
```
Everything downstream uses `subject.type` / `subject.id` where it used `subjectType` / `subjectId`. `serializeComment` is unchanged.

- [ ] **Step 4: Run tests + full gate.**

- [ ] **Step 5: `CONTRACTS.md`** §4 — replace the signatures; keep the gotchas; add: *"The subject carries `clientId`; the module now calls `requireOwnClientOr404` itself. The caller still runs `authorize(actor, "comment.create"/"comment.view", …)` for the action check, but ownership is no longer solely the caller's responsibility."* Amendments bullet naming plan-01 Task 6, plan-02, plan-03 as consumers.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/comment/ CONTRACTS.md
git commit -F- <<'EOF'
feat: comment module takes an authorized subject with clientId

addComment / listComments took a bare subjectId and trusted the caller to
have checked client-ownership. Now they take { type, id, clientId } and call
requireOwnClientOr404 internally — a forgotten check in a portal route can no
longer leak another client's thread.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Audit default-grant lockdown + migration convention

**Problem (security I4, architecture minor):** `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE` means every future table is fully mutable by `keel_app`. Only `AuditEvent` has an explicit `REVOKE`. Future record-of-fact tables (`ApprovalDecision`, `PostImplementationReview`) will be silently mutable. Also: the migration timestamp convention is informal.

**Files:**
- Create: `prisma/migrations/<ts>_audit_default_privileges/migration.sql`, `docs/migrations.md`, `scripts/check-migrations.mjs`
- Modify: `package.json` (a `check:migrations` script + fold it into `pnpm lint` or the test gate), `DESIGN.md` §Migrations, `CONTRACTS.md` (a "record-of-fact tables" note)

- [ ] **Step 1: Write the check first** — `scripts/check-migrations.mjs`: a node script that (a) lists `prisma/migrations/*/` folder names, asserts they are in ascending lexical order and each matches `^\d{14}_[a-z0-9_]+$`; (b) connects as `keel_app` (via `DATABASE_URL`) and runs
  ```sql
  SELECT table_name FROM information_schema.role_table_grants
  WHERE grantee = 'keel_app' AND privilege_type IN ('UPDATE','DELETE')
    AND table_schema = 'public'
    AND table_name = ANY($1)  -- the record-of-fact allowlist-INVERSE
  ```
  i.e. fail if any table in a `RECORD_OF_FACT = ["AuditEvent", "ApprovalDecision", "PostImplementationReview"]` list has UPDATE or DELETE for `keel_app`. Print the offending table. Exit non-zero on any violation.
  Add `"check:migrations": "node scripts/check-migrations.mjs"` to `package.json` and append ` && node scripts/check-migrations.mjs` to the `test` script (it needs the DB up, like the integration tests).

- [ ] **Step 2: Run it, verify it FAILS** — `ApprovalDecision` currently has UPDATE/DELETE for `keel_app` (inherited default). The check reports it.

- [ ] **Step 3: Add the REVOKE migration** — `prisma migrate dev --create-only --name audit_default_privileges`, edit `migration.sql`:
```sql
-- Record-of-fact tables are append-only at the database privilege level, like
-- AuditEvent. Every new such table must add its own REVOKE in the migration
-- that creates it (see docs/migrations.md); this migration covers the ones
-- that already exist.
-- Down: GRANT UPDATE, DELETE ON "ApprovalDecision", "PostImplementationReview" TO keel_app;
DO $$
DECLARE s text := current_schema();
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."ApprovalDecision" FROM keel_app', s);
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."PostImplementationReview" FROM keel_app', s);
END $$;
```
(Confirm the exact model name for the PIR table in `schema.prisma` — it may be `Pir` or `PostImplementationReview`.) `prisma migrate dev --name audit_default_privileges` to apply.

- [ ] **Step 4: Write `docs/migrations.md`** — the convention: 14-digit UTC timestamp prefix (`date -u +%Y%m%d%H%M%S`), snake_case name; every record-of-fact table ships its `REVOKE UPDATE, DELETE … FROM keel_app` in the same migration; every migration carries a `-- Down:` comment; `scripts/check-migrations.mjs` runs in the gate. Link it from `DESIGN.md` §Migrations (replace the aspirational "CI runs up→down→up" line with "the gate runs `check:migrations`; a full up/down/up harness is plan-08").

- [ ] **Step 5: Run `check:migrations` → passes. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add prisma/ scripts/ docs/migrations.md package.json DESIGN.md CONTRACTS.md
git commit -F- <<'EOF'
feat: lock down UPDATE/DELETE on record-of-fact tables; migration check

ApprovalDecision and the PIR table inherited full DML for the runtime role
from ALTER DEFAULT PRIVILEGES. Revoke it, add a gate check that fails if any
record-of-fact table is mutable by keel_app, and document the convention.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: `mapError` HTTP coverage

**Problem (testing I3):** only `ForbiddenError → 403` has an end-to-end test. `NotFoundError → 404`, `GoneError → 410`, `SegregationError → 409 { overrideAction }`, `ZodError → 400 { issues }`, `UnauthenticatedError → 401` are untested at the HTTP boundary. plan-01 is the first code to route 404/409 through it.

**Files:**
- Create: `src/lib/api/__tests__/map-error.test.ts`

- [ ] **Step 1: Write the test** — direct unit test of `mapError`:

```ts
import { expect, test } from "vitest";
import { z } from "zod";
import { mapError } from "@/lib/api/errors";
import { ForbiddenError, NotFoundError, GoneError, SegregationError } from "@/server/policy/errors";
import { UnauthenticatedError } from "@/server/auth/actor";

async function body(r: Response) { return r.json(); }

test("UnauthenticatedError → 401", async () => {
  const r = mapError(new UnauthenticatedError("x"));
  expect(r.status).toBe(401);
  expect(await body(r)).toEqual({ error: "unauthenticated" });
});

test("ZodError → 400 with issues", async () => {
  const err = z.object({ a: z.string() }).safeParse({}).error!;
  const r = mapError(err);
  expect(r.status).toBe(400);
  const b = await body(r);
  expect(b.error).toBe("invalid");
  expect(Array.isArray(b.issues)).toBe(true);
});

test("ForbiddenError → 403", async () => { expect(mapError(new ForbiddenError("x")).status).toBe(403); });
test("NotFoundError → 404 { error: not_found }", async () => {
  const r = mapError(new NotFoundError("x"));
  expect(r.status).toBe(404);
  expect(await body(r)).toEqual({ error: "not_found" });
});
test("GoneError → 410", async () => { expect(mapError(new GoneError("x")).status).toBe(410); });
test("SegregationError → 409 with overrideAction", async () => {
  const r = mapError(new SegregationError("demand.decide.override"));
  expect(r.status).toBe(409);
  expect(await body(r)).toEqual({ error: "segregation", overrideAction: "demand.decide.override" });
});
test("an unknown error → 500 { error: internal }", async () => {
  const r = mapError(new Error("boom"));
  expect(r.status).toBe(500);
  expect(await body(r)).toEqual({ error: "internal" });
});
```

- [ ] **Step 2: Run, verify it exercises the branches** (it should mostly pass — this is coverage, not a fix; if a branch is wrong, fix `errors.ts` and note it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/__tests__/map-error.test.ts
git commit -F- <<'EOF'
test: mapError HTTP coverage for every error class

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 7: Typed fetch client + response-schema convention

**Problem (architecture I1):** `DESIGN.md` §8 promises a typed fetch wrapper with request AND response Zod schemas. Only request schemas exist. Every Phase 1 client component will hand-roll `fetch` + `as` casts (plan-01 already writes `as any`).

**Files:**
- Create: `src/lib/api/client.ts`, `src/lib/api/__tests__/client.test.ts`
- Modify: `CONTRACTS.md` §7, `DESIGN.md` §8 (mark it built)

**Interfaces:**
- Produces:
  ```ts
  export class ApiError extends Error {
    constructor(public status: number, public body: { error?: string; overrideAction?: string; issues?: unknown } | null) { super(`api ${status}`); }
  }
  /** Client-side typed fetch. Throws ApiError on non-2xx (body parsed if JSON).
   *  Parses the 2xx body with `schema` when given. */
  export async function apiFetch<T = unknown>(path: string, opts?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    schema?: import("zod").ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { apiFetch, ApiError } from "@/lib/api/client";
afterEach(() => vi.restoreAllMocks());

test("GET parses the 2xx body with the schema", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ demands: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  const out = await apiFetch("/api/demands", { schema: z.object({ demands: z.array(z.unknown()) }) });
  expect(out).toEqual({ demands: [] });
});

test("POST sends JSON + throws ApiError with the parsed body on 409", async () => {
  const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "segregation", overrideAction: "demand.decide.override" }), { status: 409, headers: { "content-type": "application/json" } }));
  await expect(apiFetch("/api/demands/d1/decision", { method: "POST", body: { decision: "PURSUE" } })).rejects.toMatchObject({ status: 409, body: { overrideAction: "demand.decide.override" } });
  expect(f).toHaveBeenCalledWith("/api/demands/d1/decision", expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "PURSUE" }) }));
});

test("a 204 / empty body resolves to undefined", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  expect(await apiFetch("/api/demands/d1/triage", { method: "POST" })).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `fetch(path, { method, headers: body ? {"content-type":"application/json"} : undefined, body: body ? JSON.stringify(body) : undefined, signal })`; read `res`; if `!res.ok` → parse JSON body (catch → null) → `throw new ApiError(res.status, body)`; if 204 or empty → return `undefined as T`; else parse JSON, run `schema.parse` if given, return.

- [ ] **Step 4: Establish the response-schema convention** — in `src/lib/api/schemas/`, add a short `README.md` (or a doc comment in an `index.ts`): *"Each endpoint has a request schema (`<verb><Noun>Body`) and, where the response shape matters to a client, a response schema (`<noun>Response`). Client components call `apiFetch(path, { schema: <noun>Response })`."* Do not retrofit Phase 0's three endpoints — Phase 1 endpoints follow it.

- [ ] **Step 5: Run tests + full gate. Mark `DESIGN.md` §8's typed-client bullet as built (link `src/lib/api/client.ts`).**

- [ ] **Step 6: `CONTRACTS.md` §7** — add `apiFetch` / `ApiError` + the convention. Amendments bullet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/client.ts src/lib/api/__tests__/client.test.ts src/lib/api/schemas/ CONTRACTS.md DESIGN.md
git commit -F- <<'EOF'
feat: apiFetch — the typed client DESIGN promised

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 8: `LifecycleStepper` contract amendment  [before plan-03]

**Problem (architecture I4):** `LifecycleStepperProps` has no `blockedReason` (the Approval stage will show a disabled Advance with no explanation) and no terminal/failed stage state (a `rolled_back` change renders its stepper entirely un-started).

**Files:**
- Modify: `src/components/LifecycleStepper/LifecycleStepper.tsx` + `.module.css` + `__tests__/stepper.test.tsx`, `src/app/dev/components/Gallery.tsx`, `CONTRACTS.md` §10

**Interfaces:**
- Produces (amended):
  ```ts
  type Stage = { key: string; label: string; purpose: string; gate: GateItem[]; state?: "done" | "current" | "upcoming" | "blocked" | "reverted" };
  type LifecycleStepperProps = {
    stages: Stage[];
    currentStageKey: string;
    canAdvance: boolean;
    blockedReason?: string;      // rendered under a disabled Advance when !canAdvance
    onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
    onAdvance?: (fromStageKey: string) => void;
    readOnly?: boolean;
  };
  ```
  Semantics: if a `Stage.state` is set it wins over the derived state (so plan-03 can mark the whole stepper `reverted` after a rollback, or a stage `blocked`). `blockedReason` shows under the Advance button whenever `!canAdvance` (replacing the current "show the gate count only when incomplete" logic — now: gate count when `doneCount < total`, else `blockedReason` if given, else nothing).

- [ ] **Step 1: Write the failing tests** (extend `stepper.test.tsx`)

```tsx
test("blockedReason renders under a disabled Advance when gates are complete but canAdvance is false", async () => {
  render(<LifecycleStepper stages={STAGES} currentStageKey="assess" canAdvance={false} blockedReason="Waiting on technical approval" onAdvance={vi.fn()} />);
  // assume STAGES 'assess' gates are all done in this fixture variant
  expect(screen.getByRole("button", { name: /advance/i })).toBeDisabled();
  expect(screen.getByText("Waiting on technical approval")).toBeInTheDocument();
});

test("an explicit Stage.state overrides the derived state", () => {
  const reverted = STAGES.map((s) => ({ ...s, state: "reverted" as const }));
  render(<LifecycleStepper stages={reverted} currentStageKey="assess" canAdvance={false} />);
  // every step node carries the reverted class; no Advance button
  expect(screen.queryByRole("button", { name: /advance/i })).not.toBeInTheDocument();
});

test("the gate-count hint still shows while gates are incomplete (blockedReason ignored then)", () => { /* … */ });
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `state` per stage: `stage.state ?? derivedState(index, currentIndex)`. Add `.blocked` / `.reverted` classes to `.module.css` (a muted red for reverted, an amber ring for blocked — use `--crit` / `--warn` tokens). The Advance row: render when `derivedState === "current" && !readOnly && !stage.state`; hint logic as above. Gallery: add a third stepper instance showing `blockedReason` + one showing an all-`reverted` state.

- [ ] **Step 4: Run tests + full gate. Manual: `pnpm dev` → `/dev/components` → the new stepper variants render.**

- [ ] **Step 5: `CONTRACTS.md` §10** — replace `Stage` + `LifecycleStepperProps`; update the consumer note (the "currentStageKey matches nothing → all upcoming" note stays; add "a Stage.state override wins"). Amendments bullet: consumed by plan-03.

- [ ] **Step 6: Commit**

```bash
git add src/components/LifecycleStepper/ "src/app/dev/components/Gallery.tsx" CONTRACTS.md
git commit -F- <<'EOF'
feat: LifecycleStepper — blockedReason and per-stage state override

The change drawer (plan-03) needs to explain a non-gate block (approval
pending) and to show a rolled-back change as reverted, not un-started.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 9: `DataTable` contract amendment  [before plan-02]

**Problem (architecture I8):** `<tr role="button">` is invalid ARIA (a button can't contain gridcells); `onRowClick` is required so read-only dashboard tables must pass a no-op; an actions-column cell double-fires the row click.

**Files:**
- Modify: `src/components/DataTable/DataTable.tsx` + `.module.css` + `__tests__/data-table.test.tsx`, `src/app/dev/components/Gallery.tsx`, `CONTRACTS.md` §10

**Interfaces:**
- Produces (amended):
  ```ts
  type DataTableProps<R> = {
    columns: Column<R>[];
    rows: R[];
    getRowId: (row: R) => string;
    onRowClick?: (row: R) => void;   // now OPTIONAL — omit for a read-only table
    label?: string;
  };
  ```
  When `onRowClick` is set: the row is keyboard-activatable via a **visually-hidden `<button>` in the first cell** (`aria-label` from `label` + the row's first column value), NOT `role="button"` on the `<tr>`. The `<tr>` keeps `role="row"`. A `<td>` that renders its own interactive element is unaffected (no row-level click handler to bubble into). When `onRowClick` is unset the table is inert (no affordance, no tabIndex).

- [ ] **Step 1: Write the failing tests** (extend `data-table.test.tsx`)

```tsx
test("with onRowClick: each row has an activator button that calls it with the row", async () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={cols} rows={ROWS} getRowId={(r) => r.id} onRowClick={onRowClick} label="Changes" />);
  const btns = screen.getAllByRole("button", { name: /open/i });
  await userEvent.click(btns[0]!);
  expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  // the <tr> is not itself a button
  expect(screen.getAllByRole("row")[1]).not.toHaveAttribute("role", "button");
});

test("without onRowClick: no activator, no tabindex, rows are inert", () => {
  render(<DataTable columns={cols} rows={ROWS} getRowId={(r) => r.id} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

test("an interactive cell does not trigger onRowClick", async () => {
  const onRowClick = vi.fn();
  const withAction = [...cols, { key: "act", header: "", cell: (r) => <button onClick={() => {}}>edit {r.id}</button> }];
  render(<DataTable columns={withAction} rows={ROWS} getRowId={(r) => r.id} onRowClick={onRowClick} />);
  await userEvent.click(screen.getByRole("button", { name: /edit/i }));
  expect(onRowClick).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — drop `role="button"` / `tabIndex` / `onKeyDown` from `<tr>`. When `onRowClick`: render a visually-hidden `<button type="button" class={styles.rowActivator} onClick={() => onRowClick(row)} aria-label={`Open ${label ?? "row"}: ${firstCellText}`}>` as the first child of the first `<td>` (or a dedicated leading `<td>`). Keep a subtle `:hover` background on the `<tr>` via `:has(.rowActivator:hover)` or a JS `onClick` on the `<tr>` that checks `e.target` is not inside an interactive element — **prefer the pure-CSS `:has()` approach**; if the row must be mouse-clickable anywhere, add `<tr onClick>` that early-returns when `e.target.closest("a,button,input,select,textarea")` is truthy. Gallery: add a read-only `DataTable` (no `onRowClick`) and one with an actions column.

- [ ] **Step 4: Run tests + full gate + manual `/dev/components` check.**

- [ ] **Step 5: `CONTRACTS.md` §10** — amended `DataTableProps`; rewrite the consumer note: `onRowClick` optional; the actions-column pattern (an interactive cell just works — no `stopPropagation` needed with the activator-button approach); `label` recommended. Amendments bullet: consumed by plan-01 Task 5, plan-02, plan-04.

- [ ] **Step 6: Commit**

```bash
git add src/components/DataTable/ "src/app/dev/components/Gallery.tsx" CONTRACTS.md
git commit -F- <<'EOF'
feat: DataTable — optional onRowClick, valid row affordance

role="button" on a <tr> containing <td>s is invalid ARIA and made every
interactive cell double-fire. Row activation is now a visually-hidden button;
read-only tables omit onRowClick entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 10: `isUniqueViolation` + `prisma/seed.ts`

**Problem (architecture I6, I9):** no seed script (a fresh clone can't log in; `admin@keel.local` is a manual insert); no typed `P2002` helper (plan-03's convert idempotency and plan-01's redeem race both need it).

**Files:**
- Create: `src/server/db/errors.ts`, `src/server/db/__tests__/errors.test.ts`, `prisma/seed.ts`
- Modify: `package.json` (`prisma.seed` key), `CONTRACTS.md` §7, `src/server/auth/invites.ts` (use the helper — it currently checks P2002 inline)

- [ ] **Step 1: Write the failing test** — `errors.test.ts`:

```ts
import { expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "@/server/db/errors";

test("recognises a P2002 with an optional target", () => {
  const e = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x", meta: { target: ["email"] } });
  expect(isUniqueViolation(e)).toBe(true);
  expect(isUniqueViolation(e, "email")).toBe(true);
  expect(isUniqueViolation(e, "ref")).toBe(false);
});

test("not a P2002", () => {
  expect(isUniqueViolation(new Error("x"))).toBe(false);
  expect(isUniqueViolation(new Prisma.PrismaClientKnownRequestError("x", { code: "P2025", clientVersion: "x" }))).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `src/server/db/errors.ts`**

```ts
import { Prisma } from "@prisma/client"; // value import — this file lives under src/server/db/**, allowed

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (target == null) return true;
  const t = (e.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(t) ? t.includes(target) : t === target;
}

export function isNotFound(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}
```
Retrofit `src/server/auth/invites.ts`'s inline P2002 check to `isUniqueViolation(e)`.

- [ ] **Step 4: Write `prisma/seed.ts`** — idempotent:

```ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Keel-admin-2026");
  await prisma.user.upsert({
    where: { email: "admin@keel.local" },
    update: {},
    create: { email: "admin@keel.local", passwordHash, displayName: "Keel Admin", kind: "INTERNAL", hats: ["DEVELOPER", "REVIEWER", "BUSINESS_APPROVER", "TECHNICAL_APPROVER"] },
  });
  await prisma.client.upsert({
    where: { /* Client has no natural unique key besides id — add `name @unique` in a tiny migration, OR findFirst-then-create */ },
    update: {},
    create: { name: "Northwind Traders", isActive: true },
  });
  console.log("seeded: admin@keel.local (Keel-admin-2026), client Northwind Traders");
}
main().finally(() => prisma.$disconnect());
```
`Client.name` is not unique in the schema — either add `@unique` to `Client.name` in a one-line migration (preferred — the demo/portal flows want it anyway), or `const existing = await prisma.client.findFirst({ where: { name } })` then create. **Ruling: add `Client.name @unique`** (migration `client_name_unique`). Add `"prisma": { "seed": "tsx prisma/seed.ts" }` to `package.json` (the `seed` script already runs `dotenv -e .env -- tsx prisma/seed.ts`).

- [ ] **Step 5: Run `pnpm seed` against the dev DB — idempotent (run twice, no error). Full gate + `check:migrations`.**

- [ ] **Step 6: `CONTRACTS.md` §7** — add `isUniqueViolation` / `isNotFound`. Amendments bullet.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/errors.ts src/server/db/__tests__/ prisma/ package.json src/server/auth/invites.ts CONTRACTS.md
git commit -F- <<'EOF'
feat: isUniqueViolation helper + idempotent seed script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 11: Test-harness rework — migrate-once template schema  [before plan-01 Task 2]

**Problem (architecture I7, testing I1/I2):** `src/test/db.ts` runs a blocking `prisma migrate deploy` per test file (~2.7 s, ~13 concurrent process spawns). It flaked ~1 run in 6 on 49 files; Phase 1 doubles that. 11 `test_*` schemas leaked (two callers pass no name, so a mid-`beforeAll` throw loses it). Route tests re-implement the mock+lifecycle dance 6×.

**Files:**
- Modify: `src/test/db.ts`, `src/test/db.test.ts`, `src/server/audit/__tests__/append-only.test.ts` (the no-arg caller), `src/test/__tests__/db.test.ts` (the other no-arg caller)
- Create: `src/test/route-db.ts`, `src/test/global-setup.ts`
- Modify: `vitest.config.ts` (`globalSetup`), `CONTRACTS.md` "Test infrastructure"

- [ ] **Step 1: Add a Vitest `globalSetup`** — `src/test/global-setup.ts` runs **once** before the whole suite: `CREATE SCHEMA IF NOT EXISTS keel_test_template`, `prisma migrate deploy` into it (via `?schema=keel_test_template` on `MIGRATE_DATABASE_URL`), and `DROP SCHEMA … CASCADE` in teardown. Export the template name. This is the only `migrate deploy` call in the run.

- [ ] **Step 2: Rework `withTestDb`** — per file: mint `test_<hex>`, then instead of `migrate deploy`, clone the template: `CREATE SCHEMA test_<hex>` then copy every table+type via `pg_dump --schema=keel_test_template --schema-only | sed 's/keel_test_template/test_<hex>/g' | psql` — **or**, simpler and faster, use Postgres template databases: keep migrations in a template *database* `keel_test_tmpl` and `CREATE DATABASE test_<hex> TEMPLATE keel_test_tmpl` per file (a near-instant file copy). **Ruling: template DATABASE, not schema** — it sidesteps the search_path juggling and is the standard pattern. `withTestDb` connects to `test_<hex>` (a fresh DB), drops it in `afterAll`. `keel_migrate` needs `CREATEDB` (it already has it).
  - Adjust: the current per-file *schema* naming becomes per-file *database* naming; `appUrlForSchema` / `migrateUrlForSchema` become `...ForDb`. The `keel_app` grants (from the `audit_grants` migration) are in the template, so they clone too — verify `append-only.test.ts` still sees the REVOKE.

- [ ] **Step 3: Fix the two no-arg leak callers** — `append-only.test.ts` and `db.test.ts` mint the name/db first, then apply, so `afterAll` can always drop it (mirror `withTestDb`'s existing name-first pattern).

- [ ] **Step 4: Extract `withRouteTestDb()`** — `src/test/route-db.ts`: one call that (a) `vi.mock("@/server/db/client")` returning a client bound to a fresh test DB, (b) runs the `beforeAll`/`afterAll` lifecycle, (c) returns `{ db, asActor(actor) }` where `asActor` wraps a handler invocation in `runWithContext` + a stubbed session cookie. Port `src/app/api/guest-invites/__tests__/create.route.test.ts` to it as the proof; leave the other 5 Phase 0 route tests (they work) but note the helper in their file headers.

- [ ] **Step 5: Run the FULL suite 5× consecutively — 0 failures, no leaked `test_*` DBs (`SELECT datname FROM pg_database WHERE datname LIKE 'test_%'` → empty after).** Time the run — it should be *faster* (no 49× migrate).

- [ ] **Step 6: `CONTRACTS.md`** "Test infrastructure" — describe the template-DB model + `withRouteTestDb()`; delete the "template DB is a Phase 2 improvement" line.

- [ ] **Step 7: Commit**

```bash
git add src/test/ vitest.config.ts src/server/audit/__tests__/append-only.test.ts src/app/api/guest-invites/__tests__/create.route.test.ts CONTRACTS.md
git commit -F- <<'EOF'
perf: migrate once into a template DB, clone per test file

Replaces 49x `prisma migrate deploy` (2.7s + 13 concurrent process spawns,
flaked 1 run in 6) with one migrate + CREATE DATABASE ... TEMPLATE per file.
Fixes the two no-arg callers that leaked schemas on a beforeAll throw, and
extracts withRouteTestDb() so route tests stop copy-pasting the mock dance.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 12: Login rate-limit key + ingress note

**Problem (security I5):** `clientIp` falls back to the literal `"local"` (one global bucket — an attacker locks out everyone) and trusts a client-appendable `x-forwarded-for` (no limit at all behind the wrong proxy).

**Files:**
- Modify: `src/app/api/auth/login/route.ts`, `src/lib/api/rate-limit.ts` (doc only), `plans/specs/08-deploy-and-ci.md` (ingress contract)

- [ ] **Step 1: Write / adjust the test** — `login.route.test.ts`: two failed logins for the same email from *different* XFF values still count against the same bucket (key includes the email); a request with no XFF and no `x-real-ip` is **not** rate-limited on a shared `"local"` bucket (either skipped, or keyed per the connection — assert two such requests from "different" simulated peers don't share a counter).

- [ ] **Step 2: Implement** — key on `"login:" + normalizedEmail` (always available, from the parsed body) as the primary dimension, plus the IP as a secondary only when a trusted header is present. Drop the `"local"` fallback: if neither `x-forwarded-for` nor `x-real-ip` is set, rate-limit on the email alone (a stuffer hitting many emails from one unknown IP is then only bounded by argon2 cost — acceptable per the threat model, and documented). Keep `max: 10, windowMs: 60_000`.

- [ ] **Step 3: `plans/specs/08-deploy-and-ci.md`** — add to the ingress section: *"The ingress/proxy MUST replace (not append to) `X-Forwarded-For` with the real client address before the request reaches the app. Until a trusted proxy is in place the login limiter keys on the submitted email only."* Update `rate-limit.ts`'s doc comment to match.

- [ ] **Step 4: Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/login/ src/lib/api/rate-limit.ts plans/specs/08-deploy-and-ci.md
git commit -F- <<'EOF'
fix: login limiter keys on the email, not a shared "local" bucket

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 13: `auditActionLabel` registry

**Problem (architecture I2):** plan-01's demand drawer timeline and spec-06's dashboard activity feed each need an action→phrasing map; spec-06 wants a test that iterates the whole audit-action catalogue and fails on a missing phrase. A private map per module makes that test impossible.

**Files:**
- Create: `src/server/audit/labels.ts`, `src/server/audit/__tests__/labels.test.ts`
- Modify: `CONTRACTS.md` §2

**Interfaces:**
- Produces:
  ```ts
  /** Every audit action string a module writes → a short human phrase for a
   *  Timeline / ActivityFeed. Modules add their entries here. */
  export const AUDIT_ACTION_LABELS: Record<string, string>;
  /** The phrase, or a humanised fallback (`"demand.value_scored" → "Demand value scored"`). */
  export function auditActionLabel(action: string): string;
  /** For a guest-facing feed: the subset + guest phrasing (internal-only actions → null). */
  export function guestAuditActionLabel(action: string): string | null;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { AUDIT_ACTION_LABELS, auditActionLabel, guestAuditActionLabel } from "@/server/audit/labels";

// The actions Phase 0 already writes (grep `action:` in src/server) — every one must have a label.
const PHASE0_ACTIONS = ["auth.login", "auth.login_failed", "auth.logout", "session.revoked", "guest_invite.created", "guest_invite.redeemed", "comment.created"];

test("every Phase 0 audit action has an explicit label", () => {
  for (const a of PHASE0_ACTIONS) expect(AUDIT_ACTION_LABELS[a], a).toBeTruthy();
});

test("auditActionLabel humanises an unknown action", () => {
  expect(auditActionLabel("demand.value_scored")).toBe("Demand value scored");
});

test("guestAuditActionLabel hides internal-only actions", () => {
  expect(guestAuditActionLabel("comment.created")).toBeTruthy();
  expect(guestAuditActionLabel("session.revoked")).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — the `Record` with the 7 Phase 0 actions (Phase 1 tasks append their own: `demand.create`, `demand.decided`, …). `auditActionLabel`: `AUDIT_ACTION_LABELS[action] ?? action.replace(/\./g, " ").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())`. `guestAuditActionLabel`: a `GUEST_VISIBLE` set + guest phrasing map; anything not in it → `null`.

- [ ] **Step 4: Run tests + full gate.**

- [ ] **Step 5: `CONTRACTS.md` §2** — add the registry; note that every module's audit-writing task appends its actions here, and spec-06's dashboard test iterates `AUDIT_ACTION_LABELS` keys. Amendments bullet.

- [ ] **Step 6: Commit**

```bash
git add src/server/audit/labels.ts src/server/audit/__tests__/labels.test.ts CONTRACTS.md
git commit -F- <<'EOF'
feat: auditActionLabel registry — one action -> phrasing map

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Task 14: Verification pass & plan-01 revision

**Files:**
- Modify: `plans/plan-01-demand.md` (consume the new helpers), `.superpowers/sdd/plan-00-foundation/progress.md` (close out Task 0)

- [ ] **Step 1: Full verification** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:migrations`; `pnpm test` **5× consecutively, 0 failures**; `SELECT datname FROM pg_database WHERE datname LIKE 'test_%'` empty; `pnpm seed` idempotent; `pnpm dev` → sign in as `admin@keel.local` → land on… `/demands` 404s (plan-01 not built) but **no redirect loop** — the `(internal)` layout, if it existed, would now resolve the actor. Sanity-check by adding a throwaway `src/app/(internal)/demands/page.tsx` that just renders `whoami()`'s result, confirm it shows the admin, then delete it.

- [ ] **Step 2: Revise `plan-01-demand.md`:**
  - Task 1: `(internal)/layout.tsx` and `login/page.tsx` use `getCurrentActor()` / `whoami()` (not `getActorOrNull()`); delete the ruling that invents `src/server/auth/whoami.ts` (it exists now).
  - Task 2: `serializeDemand` uses `serializePick` with an explicit `guestKeys` allowlist (`["id", "ref", "title", "problem", "source", "affectedService", "createdAt"]` + the `guestTransform` for status/clientName), not `serializeFor` + `DEMAND_INTERNAL_ONLY_KEYS`. Drop `assertNoInternalKeys` from the test (redundant with an allowlist) — replace with "the guest object's keys are exactly `guestKeys ∪ guestTransform keys`".
  - Task 4/6: the comments route passes `{ type: "Demand", id, clientId }` to `addComment`/`listComments`.
  - Task 5/6: `DataTable` — `onRowClick` and `label` per the amended contract; the drawer opens via the activator button.
  - Task 6: `auditToTimeline` → `auditActionLabel` from `@/server/audit/labels`; the demand tasks append `demand.*` entries to `AUDIT_ACTION_LABELS`.
  - Task 2/3/4 route tests: use `withRouteTestDb()`.
  - Task 10: the seed script already exists — plan-01 Task 10 only adds the demo *demands*, not the admin/client.
  - Every client component uses `apiFetch` (no bare `fetch`, no `as any`).

- [ ] **Step 3: Commit**

```bash
git add plans/ .superpowers/
git commit -F- <<'EOF'
docs: plan-1a verification; plan-01 revised to consume Task 0 helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Definition of done (plan-1a)

- A server component / layout can resolve the current actor (`getCurrentActor` / `whoami`) — the plan-01 login flow no longer loops.
- `scopeToClient` fails closed; a guest can never have a null `clientId` (DB CHECK); guest serialization is allowlist-based; the comment module checks client-ownership itself.
- `LifecycleStepper` and `DataTable` contracts carry what plan-02/plan-03 need; `CONTRACTS.md` has a `Phase 1 amendments` section.
- `apiFetch`, `auditActionLabel`, `isUniqueViolation`, `withRouteTestDb`, `prisma/seed.ts` exist and are documented.
- Record-of-fact tables are DB-immutable; `check:migrations` is in the gate.
- `pnpm test` is green on 5 consecutive full runs; no leaked test databases.
- `plan-01-demand.md` is revised to build on all of the above.

## Self-review notes

- Every review Important is a task: sec I1→T2, I2→T3, I3→T4, I4→T5, I5→T12; arch C1→T1, I1→T7, I2→T13, I3+I7→T11, I4→T8, I5→T1, I6→T10, I8→T9, I9→T10; testing I1→(pre-merge, done), I2→T11, I3→T6, I4→T2/T3.
- Minors folded: `import type` (pre-merge, done); `NOTIFY_BATCH` (pre-merge, done); migration naming→T5; `deferred`→`backlog` rename, `checkMigrations` logging → deferred (genuinely minor, note in progress.md); `audit.recentEvents(limit)` → deferred to spec-06/plan-04 (it's that module's read); unindexed columns → each module's plan adds its own `@@index` when it writes the query; `middleware.ts fonts/` dead matcher → deferred cosmetic.
- Ordering: T1–T4 before plan-01 build; T8 before plan-03; T9 before plan-02; T11 before plan-01 Task 2. T5, T6, T7, T10, T12, T13 are independent and can interleave. T14 last.
- Type consistency: `Me` (T1) used by plan-01 Task 1's shell; `serializePick` cfg shape (T3) identical in plan-01 Task 2; `CommentSubject` (T4) identical in plan-01 Task 6; `apiFetch` signature (T7) identical everywhere a client component is described.
- Placeholder scan: `prisma/seed.ts` `Client` upsert has a real ruling (add `Client.name @unique`); the T11 template-DB approach has a concrete ruling (database not schema); no "handle errors"/"similar to"/"TBD".
