# Spec 05 — Notifications

In-app and email notifications on assignment, approval needed, status change,
comment, and item-became-overdue. The plumbing (`emitNotification`, the
`EmailOutbox` worker) is built in Phase 0 / spec 00; this spec covers the
in-app surface, the templates, and the Phase 2 trigger wiring.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 0 (plumbing) + Phase 2
(wiring). In-app UI: Phase 1 / D.

---

## 1. Scope

**In:** the `Notification` bell + list, mark-as-read, the five notification
kinds, email templates, the outbox worker's send + retry, per-user delivery
resolution, the failed-email dashboard tile.

**Out (v2):** user notification preferences, digest / batching, Slack or webhook
delivery, per-kind mute, mobile push, unsubscribe links (internal-only tool).

---

## 2. Data owned

`Notification`, `EmailOutbox` (schema in [`data-model.md`](data-model.md);
tables created in the Phase 0 baseline). This spec owns the `notify` module's
templates and the in-app routes/UI.

---

## 3. `emitNotification` (recap from spec 00 §7)

```ts
emitNotification(tx, {
  recipients: { userIds: string[] } | { hat: Hat } | { audience: "ALL_INTERNAL" },
  kind: NotificationKind,   // ASSIGNED | APPROVAL_NEEDED | STATUS_CHANGED | COMMENTED | OVERDUE
  subjectType: string,
  subjectId: string,
  summary: string,               // plain sentence; guest-safe when a guest may receive it
  email?: { template: string, payload: object },
}): Promise<void>
```

- `{ hat }` resolves to all active internal users holding that hat;
  `{ audience: "ALL_INTERNAL" }` to every active internal user. Both drop the
  acting user (you are not notified of your own action) unless the caller passes
  the acting id explicitly in `userIds`.
- Writes one `Notification` per recipient; writes one `EmailOutbox` per
  recipient when `email` is set and the recipient has an address.
- Always inside the caller's transaction — a notification is never sent for a
  domain write that rolled back.

---

## 4. Triggers (Phase 2 wiring)

The authoritative list is each module's "Notifications" table (specs 01–04).
Consolidated:

| Kind | Sources |
| --- | --- |
| `ASSIGNED` | incident assigned; demand raised by a guest (to internal); incident raised by a guest |
| `APPROVAL_NEEDED` | approval step becomes current (spec 04); change submitted for approval (spec 03) |
| `STATUS_CHANGED` | demand decided / rejected / converted; incident transitioned / resolved; change scheduled / implementing / rolled back / PIR; approval resolved; a linked demand or incident's change closed |
| `COMMENTED` | a comment added on an item the other party can see (internal ↔ guest) |
| `OVERDUE` | incident crossed `dueAt` (once, per spec 02 §3) |

Wiring is a Phase 2 task so that Phase 1 module owners implement
`emitNotification` calls against the frozen contract without coordinating on
recipient logic. Each call site gets a test asserting the rows written.

---

## 5. Email templates

`src/server/modules/notify/templates/<name>.ts` — pure
`(payload) => { subject, text, html }`. Shared minimal HTML layout (self-hosted
inline styles, product name, a deep link, no tracking). Templates:

- `demand_status` · `incident_assigned` · `incident_status` ·
  `incident_overdue` · `approval_needed` · `approval_resolved` ·
  `change_scheduled` · `comment_added` · `guest_invite`.

Deep links: internal → `/<module>/<ref>`; guest → `/portal/...`. Base URL from
`APP_URL`.

For a guest recipient, `subject` and `text` use the plain-language status words
(specs 01 §5, 02 §6) — never "triaging", "RFC", "CAB", a `ChangeStatus`, or an
internal user's name.

---

## 6. Outbox worker (recap + detail)

- Interval `NOTIFY_POLL_MS` (default 5000). `pg_try_advisory_lock(hashtext
  ('keel:outbox'))`; return early if not acquired.
- `SELECT ... WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY
  created_at LIMIT NOTIFY_BATCH (default 20) FOR UPDATE SKIP LOCKED`.
- Per row: render template, `transport.sendMail`, set `status='sent',
  sentAt=now()`; on error `attempts++`, `lastError`, `next_attempt_at = now() +
  backoff(attempts)` where backoff = `min(2^attempts, 30) minutes`; at
  `attempts >= 6` set `status='failed'`.
- Release the lock. Never throw out of the tick — log and continue.
- `nodemailer` transport from `SMTP_URL` (or discrete `SMTP_HOST/PORT/USER/
  PASS`). Local: Mailpit on `1025`. CI: a stub transport that records calls.

Add `next_attempt_at timestamptz NOT NULL DEFAULT now()` to `EmailOutbox` in the
spec 00 baseline.

---

## 7. In-app UI (Phase 1 / D)

- **Bell** in the topbar — unread count badge; opens a popover (Radix
  `Popover`) listing the 10 most recent, newest first, each a summary + relative
  time + deep link; "mark all read"; "see all" → `/notifications`.
- **`/notifications`** — full list, filter by kind and read/unread.
- `GET /api/notifications?unread=&kind=`, `POST /api/notifications/read`
  (`{ ids }` or `{ all: true }`). Action `notification.view.own`; a user only
  ever sees their own rows (`userId = actor.id`, no exceptions, no scoping
  helper needed).
- Guests have the same bell in the portal shell.

---

## 8. Failed-email visibility

Overview dashboard tile "Email delivery": count of `EmailOutbox` rows with
`status = 'failed'` in the last 7 days; click → a list with `to`, `template`,
`lastError`, `attempts`. Internal only. No retry button in v1 (manual DB action;
documented in the runbook section of the README).

---

## 9. Test plan (RED first)

- `emitNotification`: `{ userIds }`, `{ hat }`, and `{ audience: "ALL_INTERNAL" }`
  resolution; acting user excluded from `{ hat }` / `{ audience }`; one
  `Notification` per recipient; `EmailOutbox` only when `email` set and address
  present; nothing written if the transaction rolls back.
- Worker: sends a pending row → `SENT`; transient failure → `attempts++` +
  future `nextAttemptAt`; permanent at 6 → `FAILED`; advisory lock serialises
  two concurrent ticks; a thrown template error does not kill the tick.
- Guest-safe copy: a `STATUS_CHANGED` to a guest recipient contains none of a
  configurable list of internal terms (unit test with a banned-words list).
- In-app API: a user cannot read or mark another user's notifications.
- Templates: snapshot `subject` + `text` for each, one internal and one guest
  payload where applicable.

---

## 10. Definition of done

Every trigger in §4 produces the right in-app rows and (where specified) an
email visible in Mailpit locally; the bell shows unread counts and deep-links
correctly for both internal users and guests; guest emails never leak internal
vocabulary; worker retry/fail behaviour is tested.
