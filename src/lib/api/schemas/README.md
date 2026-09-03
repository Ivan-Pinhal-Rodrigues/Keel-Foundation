# API schemas

Zod schemas for the HTTP boundary — the request/response contract shared by the
`src/app/api/**` route handlers and the typed client
([`../client.ts`](../client.ts)). No code generation: `apiFetch`'s result type
is inferred from the response schema handed to it.

## Convention

One file per module (`demand.ts`, `incident.ts`, …). Each endpoint has:

- a **request schema** — named `<verb><Noun>Body` (`loginBody`,
  `createInviteBody`). The route parses the request against it before calling a
  service.
- a **response schema** — named `<noun>Response` (`demandResponse`,
  `demandListResponse`) — **only where a client cares about the response
  shape**. It describes the **wire** shape: `NextResponse.json()` has already
  turned `Date` columns into ISO strings, so use `z.iso.datetime()`, not
  `z.date()`.

A client component reads a typed response by passing the schema to `apiFetch`:

```ts
import { demandListResponse } from "@/lib/api/schemas/demand";

const { demands } = await apiFetch("/api/demands", {
  schema: demandListResponse,
});
```

Phase 0's schemas (`auth`, `sessions`, `invites`) predate this convention — do
not retrofit them. Phase 1 endpoints follow it.
