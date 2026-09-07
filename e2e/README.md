# End-to-end tests (Playwright)

`e2e/` holds the Playwright end-to-end suite. It drives a real Chromium against a
running Keel server with the seeded database. Config: `playwright.config.ts` at
the repo root (`testDir: "./e2e"`, one `chromium` project, a `webServer` that
runs `pnpm start`).

## What is covered

`client-demand-journey.spec.ts` — the full client (guest) demand journey, spec
07 §7:

1. The guest signs in and lands on `/portal`.
2. The portal top bar shows the client org name ("Northwind Traders") and the
   notification bell.
3. The guest submits a request on `/portal/submit` (the "Request software or a
   feature" tab): title, "what do you need and why", product.
4. The new request appears in `/portal/demands` with the guest status "In
   review".
5. Opening the request shows the "What you asked for" text, the "Progress"
   milestone timeline (one row — "Demand raised" — for a freshly submitted
   demand), and the "Messages" box.
6. The internal side (`admin@keel.local`) sees a non-zero "Demands in triage"
   tile on `/overview` and the new demand on `/demands`.
7. Back as the guest, `/notifications` lists their rows (the seeded
   "…being reviewed by the Keel team." row).

Role switches clear cookies rather than click "Sign out" (the logout control has
its own unit test).

## Prerequisites

- `pnpm install`
- `pnpm exec playwright install chromium` (one-time browser download)
- A running Postgres reachable via `.env` `DATABASE_URL`, migrated and seeded:
  ```
  pnpm db:deploy   # or: pnpm db:migrate
  pnpm seed        # seeds admin, the Northwind guest, and the demo fixtures
  ```
  The spec assumes the seed has been applied. It is written to tolerate being
  re-run against an already-seeded database (each run submits a uniquely titled
  request).

## Running

```
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` is `playwright test`. The config's `webServer` runs `pnpm start`
for you (and reuses an already-running server outside CI), so a separate
`pnpm start` is optional. `pnpm build` must have run first — `pnpm start` serves
the built app.

Against an already-running server on another host/port:

```
PLAYWRIGHT_BASE_URL=https://staging.example pnpm test:e2e
```

(PowerShell: `$env:PLAYWRIGHT_BASE_URL="..."; pnpm test:e2e`.)

## Seeded credentials used

| Role     | Email                     | Password          |
| -------- | ------------------------- | ----------------- |
| Guest    | `guest@northwind.example` | `Keel-guest-2026` |
| Internal | `admin@keel.local`        | `Keel-admin-2026` |

## CI

CI wiring for this suite (build the image, seed a compose database, run
Playwright) is plan-05's job — `plans/specs/08-deploy-and-ci.md` §7. This
directory is only the spec + the local run instructions.

## Sandbox note

This suite was authored under plan-04 Task 14. Every selector and copy string
was verified against the shipped components, but the suite was not executed in
the authoring sandbox (see `task-14-report.md` for why — Chromium download / a
running Postgres were not available there). Run it locally per the steps above.
