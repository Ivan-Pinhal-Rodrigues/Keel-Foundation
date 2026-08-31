# BUILD: ITSM platform for a 2-person software company (CEO + CTO) with client guest access

Real, working, tested application. Not a prototype, not a mockup. ITIL-aligned,
deliberately scoped for a company of two people who also sell software to external clients.

If this is the real build of my existing "Flightdeck" ops-console prototype, tell me in
brainstorming and reuse that frontend instead of starting the UI from scratch.

---

## 0. HOW YOU MUST WORK — use the installed skills, in this order

1. `superpowers:brainstorming` FIRST. Interrogate me on scope, stack, data model, auth
   model, hosting target, SoD strictness, and the v1 module cut BEFORE writing any code.
2. `superpowers:writing-plans` — write the plan + one spec per module into `plans/`.
   I approve the plan before code.
3. `superpowers:using-git-worktrees` — isolated workspace.
4. Build with `agent-teams`: `team-spawn` (feature preset) + `superpowers:subagent-driven-development`
   and `superpowers:dispatching-parallel-agents`. Parallelize across modules with strict
   file-ownership boundaries and interface contracts agreed up front.
5. `superpowers:test-driven-development` on every module — RED / GREEN / REFACTOR, no exceptions.
6. `superpowers:migration` patterns for every schema change — reversible, preservation proof.
7. Review before merge: `agent-teams:team-review` across security + architecture + testing
   dimensions, plus `superpowers:requesting-code-review`. I review PRs twice — once wearing
   the CTO hat (technical), once the CEO hat (business/scope).
8. `superpowers:verification-before-completion` before ANY "done" claim — run the tests,
   paste the output. No assertion without evidence.
9. `webapp-testing` (Playwright) for end-to-end flows, especially the client demand journey.
10. `frontend-design` for the UI — distinctive, not templated. Dashboards must be legible at a glance.
11. Deploy with `cloud-infrastructure` + `kubernetes-operations` agents: Dockerfile →
    Helm chart → k8s, GitOps (ArgoCD or Flux) — GitOps is v2, see below. Health + readiness
    endpoints, structured logs, basic metrics.
12. Keep `/caveman` on for working chatter. Specs, PR descriptions, commits, README,
    and all ticket/notification copy stay in normal English.
13. When context fills up, use `handoff` to compress and continue.
14. If you correct the same mistake 3+ times, capture the rule as a skill with `skill-creator`.

---

## 1. ROLES & AUTH  (v1 — foundation, non-negotiable)

- **CEO** — internal. Hats: Developer, Reviewer, Business Approver (demand prioritization,
  budget sign-off, release go/no-go, high-risk change business approval).
- **CTO** — internal. Hats: Developer, Reviewer, Technical Approver (CAB chair, architecture
  review, all change approvals, security sign-off).
- **Client (guest)** — external. Invite link or self-signup → scoped `guest` role.
  CAN: submit demands (software / feature requests), raise incidents against delivered
  software, view + comment on their OWN items, see status and SLA state.
  CANNOT: see other clients, internal notes, CMDB, the change calendar, or any item
  they don't own.
- One person may hold multiple roles simultaneously. Enforce segregation of duties where
  possible (submitter ≠ sole approver). Allow a single-approver override for the 2-person
  reality, but require a typed justification that is written to the audit log.
- Session-based auth, hashed passwords, server-side authorization on every route,
  row-level scoping for guests, full immutable audit log.

---

## 2. MODULES — full target scope

Each module: functional, tested, seeded in every state.

1. **Demand Management** — client or internal user submits a demand → triage: CEO scores
   business value, CTO scores technical feasibility/effort → decision: approve / reject /
   convert to Change or Project. Prioritization board (WSJF or value-vs-effort). Primary
   client-facing intake.
2. **Incident Management** — report, categorize, impact × urgency → priority, assign,
   work, resolve, close. SLA timers with breach flags. Clients raise and track their own.
3. **Service Request / Catalog** — predefined request types with approval routing and
   fulfillment task lists.
4. **Change Management** — RFC → risk + impact assessment → CAB approval (CTO technical
   always; CEO business approval required for high-risk) → implementation window →
   mandatory rollback plan field → post-implementation review. Links to originating demand
   and to any incidents caused.
5. **Problem Management** — group related incidents, root-cause analysis, known-error
   database, link to corrective changes.
6. **Approvals engine** — generic, multi-step, role-routed, supports delegation, records
   every decision with actor/time/reason, supports the single-approver override.
7. **SLA engine** — policies per priority, business-hours calendars, auto-pause while
   "waiting for client", breach reporting.
8. **CMDB (light)** — services, applications, environments, ownership. Tickets link to CIs.
9. **Knowledge base** — articles, linkable from incidents/problems, per-article
   client-visible flag.
10. **Dashboards per role** — my queue, approvals waiting on me, SLA at risk, demand
    pipeline, change calendar. Guest dashboard shows only their items.
11. **Notifications** — in-app + email on assignment, approval needed, SLA breach,
    status change, comment.
12. **Audit log** — every state transition: who, what, when, why. Immutable, filterable, exportable.

---

## 3. V1 CUT — what the first shippable version delivers

Goal: a client can request software, the CEO and CTO can triage and deliver it through a
controlled change, and everything is auditable. Ship this before anything in the "defer" list.

### V1 includes
- **Auth + RBAC + guest scoping + audit log** (section 1, in full).
- **Demand Management** — full. This is the reason the product exists.
- **Incident Management** — core lifecycle (report → assign → resolve → close), priority
  from impact × urgency, a plain `dueAt` + `overdue` flag. Guests raise + track their own.
- **Change Management** — RFC → risk/impact → approval → implementation window → rollback
  plan field → post-implementation review. Link to originating demand.
- **Approvals engine** — multi-step, role-routed, decision log, single-approver override
  with justification. No delegation yet.
- **Dashboards** — per role: my queue, approvals waiting on me, overdue items, demand
  pipeline. Guest sees only their items.
- **Notifications** — in-app + email on: assignment, approval needed, status change, comment.
- **Seed data** — CEO, CTO, 2 demo clients, sample demands / incidents / changes in every state.
- **Deploy** — docker compose for local, one Helm chart with staging + prod values,
  secrets external, health + readiness endpoints, structured logs.
- **Tests** — TDD throughout; coverage guaranteed on auth, RBAC/guest scoping, approvals
  engine, audit log, and the demand→change conversion path. Playwright E2E for the full
  client demand journey.

### V1 simplifications (upgrade later)
- SLA = `dueAt` by priority + `overdue` boolean. No business-hours calendar, no auto-pause.
- "Affected service" is a free-text field, not a CMDB link.
- Deploy is Helm + `helm upgrade`. No ArgoCD/Flux yet.
- OpenAPI: keep end-to-end TypeScript types; skip the generated spec document.

### V2 backlog (do not build in v1)
Service Request / Catalog · Problem Management · full SLA engine (calendars, pause states,
breach reporting) · CMDB (light) + CI linking · Knowledge base · approval delegation ·
GitOps (ArgoCD/Flux) · generated OpenAPI doc · metrics dashboards · SSO.

---

## 4. NON-FUNCTIONAL

- RBAC middleware; deny by default.
- Typed API + typed client.
- CI: lint, typecheck, test, build — merge blocked on any failure.
- Local: docker compose. Cluster: Helm chart with staging + prod values.
- Migrations reversible.

---

## 5. DELIVERABLES

- Running app (compose for local, Helm for cluster).
- `plans/` — the plan plus per-module specs.
- Green test suite with the coverage guarantees above.
- README: how to run, seed, log in as each role, and deploy.
- A scripted demo walkthrough: client submits a demand → CTO + CEO score it → convert to
  Change → CAB approves → implement in window → verify → close → client sees "delivered".

---

## 6. START NOW

Run `superpowers:brainstorming`. Ask me about: product name, exact tech stack + DB,
hosting / k8s target, email provider, how strict segregation of duties must be, and
whether to confirm the V1 cut above or adjust it. Do not write code until I approve the plan.

Recommended default stack (confirm or override in brainstorming): Next.js App Router +
TypeScript, PostgreSQL + Prisma, Auth.js (credentials + guest invite tokens), Playwright
for E2E, docker compose locally, Helm chart for k8s.
