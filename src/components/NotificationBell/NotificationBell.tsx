"use client";

import * as Popover from "@radix-ui/react-popover";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cx } from "@/components/cx";
import { apiFetch } from "@/lib/api/client";
import styles from "./NotificationBell.module.css";

/**
 * The header notification bell (spec 04 §7). A pure client component: it owns a
 * small poll loop against `GET /api/notifications?unread=false` (on mount, every
 * 60s, and whenever the tab regains focus) and renders a Radix popover with the
 * ten most recent rows. The API already computes each row's `href` server-side
 * (`hrefFor` in `src/server/modules/notify/read.ts`) so the menu just links.
 *
 * A failed poll is swallowed — the bell is ambient chrome, and keeping the last
 * good state beats flashing an error into the header.
 */

/** Mirror of `NotificationView` from `src/server/modules/notify/read.ts`. This
 * file is client-only, so it cannot import the server module (and does not need
 * the Prisma enum type — `kind` is display-only here). */
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

const POLL_MS = 60_000;
const FEED_PATH = "/api/notifications?unread=false";

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

function BellIcon(): ReactNode {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function NotificationBell(): ReactNode {
  const [feed, setFeed] = useState<Feed>({ notifications: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Feed>(FEED_PATH);
      if (data) setFeed(data);
    } catch {
      // Ambient chrome — keep the last good state on a failed poll.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch("/api/notifications/read", {
        method: "POST",
        body: { all: true },
      });
    } catch {
      return;
    }
    await load();
  }, [load]);

  const recent = feed.notifications.slice(0, 10);
  const badge = feed.unreadCount > 9 ? "9+" : String(feed.unreadCount);
  const hasUnread = feed.unreadCount > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.bell}
          aria-label="Notifications"
        >
          <BellIcon />
          {hasUnread ? (
            <span className={styles.badge} aria-hidden="true">
              {badge}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.panel}
          align="end"
          sideOffset={8}
          aria-label="Notifications"
        >
          <div className={styles.head}>
            <span className={styles.title}>Notifications</span>
            {hasUnread ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => void markAllRead()}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {recent.length === 0 ? (
            <p className={styles.empty}>You&apos;re all caught up.</p>
          ) : (
            <ul className={styles.list}>
              {recent.map((n) => {
                const unread = n.readAt === null;
                return (
                  <li key={n.id}>
                    <a
                      href={n.href}
                      className={cx(styles.row, unread && styles.unread)}
                    >
                      <span
                        className={cx(styles.dot, !unread && styles.dotHidden)}
                        aria-hidden="true"
                      />
                      <span className={styles.summary}>{n.summary}</span>
                      <span className={styles.time}>
                        {relativeTime(n.createdAt)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          <a href="/notifications" className={styles.seeAll}>
            See all
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
