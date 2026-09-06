"use client";

import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import styles from "./portal-demands.module.css";

/**
 * The guest's message thread on one request (`plans/plan-01-demand.md` Task 9).
 *
 * GETs `/api/demands/:id/comments` on mount and POSTs `{ body }` — through
 * `apiFetch`, never a bare `fetch` (Global Constraint). A guest sees only
 * `visibleToClient` comments (the comment module filters them) and every
 * comment a guest writes is client-visible, so there is NO "visible to client"
 * toggle here and the POST body carries nothing but `body`. On a successful
 * post the list is replaced from the response (the re-list carries the author
 * join `serializeComment` needs).
 */

type GuestComment = {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
};

function whenText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function CommentThread({ demandId }: { demandId: string }) {
  const [comments, setComments] = useState<GuestComment[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ comments: GuestComment[] }>(`/api/demands/${demandId}/comments`)
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .catch(() => {
        if (!cancelled) {
          setError("We could not load the messages on this request.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demandId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await apiFetch<{ comments: GuestComment[] }>(
        `/api/demands/${demandId}/comments`,
        { method: "POST", body: { body } },
      );
      setComments(res.comments);
      setDraft("");
    } catch {
      setError("Your message could not be sent. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className={styles.thread}>
      {comments.length > 0 ? (
        <ul className={styles.messages}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.message}>
              <p className={styles.messageMeta}>
                <span className={styles.messageAuthor}>
                  {comment.author ?? "Keel team"}
                </span>
                <span className={styles.date}>
                  {whenText(comment.createdAt)}
                </span>
              </p>
              <p className={styles.prose}>{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p className={styles.muted}>Loading messages…</p>
      ) : (
        <p className={styles.muted}>No messages yet.</p>
      )}

      <form className={styles.messageForm} onSubmit={onSubmit}>
        <label className={styles.messageLabel} htmlFor="portal-comment">
          Add a message
        </label>
        <textarea
          id="portal-comment"
          className={styles.textarea}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a question or add context"
        />
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <div>
          <button
            type="submit"
            className={styles.send}
            disabled={posting || draft.trim() === ""}
          >
            {posting ? "Sending…" : "Send message"}
          </button>
        </div>
      </form>
    </div>
  );
}
