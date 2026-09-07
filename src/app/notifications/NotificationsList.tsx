"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cx } from "@/components/cx";
import { Pill, type PillTone } from "@/components/Pill";
import { apiFetch } from "@/lib/api/client";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "@/lib/api/schemas/notifications";
import styles from "./notifications.module.css";

/**
 * The standalone `/notifications` list (spec 04 §7) — the "See all" target of
 * the header {@link NotificationBell}. A `"use client"` island: the kind
 * `<select>` and the "Unread only" toggle are local state that drive
 * `GET /api/notifications?kind=&unread=`; every row is an `<a href={n.href}>`
 * (the API computes `href` server-side) with a per-row and a bulk mark-read.
 *
 * Reachable by guests too — the page around it runs no `requireInternal` — so
 * nothing here assumes an internal viewer.
 */

/** Mirror of `NotificationView` from `src/server/modules/notify/read.ts`; this
 * file is client-only and cannot import the server module. */
type NotificationView = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

type Feed = { notifications: NotificationView[]; unreadCount: number };

const KIND_LABELS: Record<NotificationKind, string> = {
  ASSIGNED: "Assigned",
  APPROVAL_NEEDED: "Approval needed",
  STATUS_CHANGED: "Status changed",
  COMMENTED: "Commented",
  OVERDUE: "Overdue",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind as NotificationKind] ?? kind;
}

function kindTone(kind: string): PillTone {
  if (kind === "OVERDUE") return "crit";
  if (kind === "APPROVAL_NEEDED") return "warn";
  if (kind === "ASSIGNED") return "accent";
  return "info";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function feedPath(kind: NotificationKind | "", unreadOnly: boolean): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (unreadOnly) params.set("unread", "true");
  const qs = params.toString();
  return qs ? `/api/notifications?${qs}` : "/api/notifications?";
}

export function NotificationsList(): ReactNode {
  const [kind, setKind] = useState<NotificationKind | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [feed, setFeed] = useState<Feed>({ notifications: [], unreadCount: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const path = feedPath(kind, unreadOnly);

  const load = useCallback(async (p: string) => {
    setStatus("loading");
    try {
      const data = await apiFetch<Feed>(p);
      setFeed(data ?? { notifications: [], unreadCount: 0 });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(path);
  }, [load, path]);

  const markRead = useCallback(
    async (ids: string[]) => {
      try {
        await apiFetch("/api/notifications/read", {
          method: "POST",
          body: { ids },
        });
      } catch {
        return;
      }
      await load(path);
    },
    [load, path],
  );

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch("/api/notifications/read", {
        method: "POST",
        body: { all: true },
      });
    } catch {
      return;
    }
    await load(path);
  }, [load, path]);

  const { notifications, unreadCount } = feed;

  return (
    <section className={styles.wrap} aria-label="Notifications">
      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Kind</span>
          <select
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as NotificationKind | "")}
          >
            <option value="">All kinds</option>
            {NOTIFICATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          <span>Unread only</span>
        </label>

        <button
          type="button"
          className={styles.action}
          onClick={() => void markAllRead()}
          disabled={unreadCount === 0}
        >
          Mark all read
        </button>
      </div>

      {status === "error" ? (
        <p className={styles.empty} role="status">
          Could not load notifications. Try again in a moment.
        </p>
      ) : notifications.length === 0 ? (
        <p className={styles.empty} role="status">
          {status === "loading" ? "Loading…" : "No notifications."}
        </p>
      ) : (
        <ul className={styles.list}>
          {notifications.map((n) => {
            const unread = n.readAt === null;
            return (
              <li
                key={n.id}
                className={cx(styles.row, unread && styles.unread)}
              >
                <span
                  className={cx(styles.dot, !unread && styles.dotHidden)}
                  aria-hidden="true"
                />
                <a className={styles.link} href={n.href}>
                  <span className={styles.kind}>
                    <Pill tone={kindTone(n.kind)}>{kindLabel(n.kind)}</Pill>
                  </span>
                  <span className={styles.summary}>{n.summary}</span>
                  <span className={styles.time}>
                    {relativeTime(n.createdAt)}
                  </span>
                </a>
                {unread ? (
                  <button
                    type="button"
                    className={styles.rowAction}
                    onClick={() => void markRead([n.id])}
                  >
                    Mark read
                  </button>
                ) : (
                  <span className={styles.readTag}>Read</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
