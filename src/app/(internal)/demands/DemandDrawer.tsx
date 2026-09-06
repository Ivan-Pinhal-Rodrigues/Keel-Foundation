"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Panel } from "@/components/Panel";
import { Pill, type PillTone } from "@/components/Pill";
import { Timeline } from "@/components/Timeline";
import { ApiError, apiFetch } from "@/lib/api/client";
import styles from "./DemandDrawer.module.css";

/**
 * The demand drawer — a read-only view of one demand plus its activity timeline
 * and comment thread (`plans/plan-01-demand.md` Task 6). Task 7 adds the write
 * actions (scoring, decision, override).
 *
 * Opened from `DemandRegister`'s row click. On `open`, it fetches
 * `GET /api/demands/:id` (role-serialized demand + assembled `activity`) and
 * `GET /api/demands/:id/comments` via `apiFetch` — never a bare `fetch` (Global
 * Constraint). `apiFetch` throws `ApiError` on a non-2xx, caught for the error
 * state.
 */

type ActivityItem = { time: string; text: string };

type WorthView = {
  businessValue?: string | null;
  valueScore?: number | null;
  effort?: string | null;
  feasibility?: string | null;
  costOfDelay?: string | null;
};

type DemandView = {
  id: string;
  ref: string;
  title: string;
  problem: string;
  status: string;
  activity?: ActivityItem[];
  /** Present only on the internal serialization (guest allowlist omits it). */
  worth?: WorthView | null;
};

type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  /** Internal serialization. */
  authorName?: string;
  visibleToClient?: boolean;
  /** Guest serialization. */
  author?: string;
};

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  TRIAGING: "Triaging",
  WORTH_ASSESSED: "Worth assessed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CONVERTED: "Converted",
};

function statusTone(status: string): PillTone {
  if (status === "APPROVED") return "ok";
  if (status === "REJECTED") return "crit";
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

export function DemandDrawer({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const [demand, setDemand] = useState<DemandView | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<DemandView>(`/api/demands/${id}`),
      apiFetch<{ comments: CommentView[] }>(`/api/demands/${id}/comments`),
    ])
      .then(([d, c]) => {
        if (cancelled) return;
        setDemand(d);
        setComments(c.comments);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This demand could not be found."
            : "Something went wrong loading this demand.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, id]);

  // The internal serialization carries a `worth` key (null or object); the guest
  // allowlist omits it. That is the drawer's only signal of the viewer's kind,
  // and it gates the "visible to client" checkbox.
  const internalView = demand != null && "worth" in demand;

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const res = await apiFetch<{ comments: CommentView[] }>(
        `/api/demands/${id}/comments`,
        {
          method: "POST",
          body: {
            body,
            visibleToClient: internalView ? visibleToClient : undefined,
          },
        },
      );
      setComments(res.comments);
      setDraft("");
      setVisibleToClient(false);
    } catch {
      setCommentError("Your comment could not be posted.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={demand?.title ?? "Demand"}
      idLabel={demand?.ref ?? ""}
    >
      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : demand ? (
        <div className={styles.body}>
          <div>
            <Pill tone={statusTone(demand.status)}>
              {STATUS_LABELS[demand.status] ?? demand.status}
            </Pill>
          </div>

          <Panel title="Problem" pad>
            <p className={styles.prose}>{demand.problem}</p>
          </Panel>

          <section
            className={styles.worthSection}
            aria-label="Worth assessment"
          >
            <h3 className={styles.sectionHead}>Worth assessment</h3>
            {demand.worth ? (
              <div className={styles.worthGrid}>
                <Panel title="Business value" pad>
                  <p className={styles.prose}>
                    {demand.worth.businessValue ?? "—"}
                  </p>
                  {demand.worth.valueScore != null ? (
                    <p className={styles.score}>{demand.worth.valueScore}/10</p>
                  ) : null}
                </Panel>
                <Panel title="Effort & feasibility" pad>
                  <p className={styles.prose}>{demand.worth.effort ?? "—"}</p>
                  <p className={styles.prose}>
                    {demand.worth.feasibility ?? "—"}
                  </p>
                </Panel>
              </div>
            ) : (
              <Panel title="Worth assessment" pad>
                <p className={styles.muted}>Not yet assessed</p>
              </Panel>
            )}
          </section>

          <Panel title="Cost of delay" pad>
            <p className={styles.prose}>{demand.worth?.costOfDelay ?? "—"}</p>
          </Panel>

          <Panel title="Activity" pad>
            <Timeline items={demand.activity ?? []} />
          </Panel>

          <Panel title="Comments" count={comments.length} pad>
            {comments.length > 0 ? (
              <ul className={styles.comments}>
                {comments.map((c) => (
                  <li key={c.id} className={styles.comment}>
                    <div className={styles.commentMeta}>
                      <span className={styles.commentAuthor}>
                        {c.authorName ?? c.author ?? "Unknown"}
                      </span>
                      <span className={styles.muted}>
                        {relativeTime(c.createdAt)}
                      </span>
                      {c.visibleToClient === false ? (
                        <span className={styles.internalTag}>
                          Internal only
                        </span>
                      ) : null}
                    </div>
                    <p className={styles.prose}>{c.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>No comments yet.</p>
            )}

            <form className={styles.commentForm} onSubmit={submitComment}>
              <textarea
                className={styles.textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a comment"
                aria-label="Add a comment"
                rows={3}
              />
              {internalView ? (
                <label className={styles.visibleToggle}>
                  <input
                    type="checkbox"
                    checked={visibleToClient}
                    onChange={(e) => setVisibleToClient(e.target.checked)}
                  />
                  Visible to client
                </label>
              ) : null}
              {commentError ? (
                <p role="alert" className={styles.error}>
                  {commentError}
                </p>
              ) : null}
              <div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={posting || draft.trim() === ""}
                >
                  {posting ? "Posting…" : "Post comment"}
                </button>
              </div>
            </form>
          </Panel>
        </div>
      ) : null}
    </Drawer>
  );
}
