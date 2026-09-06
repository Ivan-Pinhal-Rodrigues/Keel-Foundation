"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Panel } from "@/components/Panel";
import {
  Pill,
  PriorityTag,
  type PillTone,
  type Priority,
} from "@/components/Pill";
import { Timeline } from "@/components/Timeline";
import { ApiError, apiFetch } from "@/lib/api/client";
import { priorityFor } from "@/server/modules/incident/priority";
import { internalIncidentStatusLabel } from "@/server/modules/incident/serialize";
import styles from "./IncidentDrawer.module.css";

/**
 * The incident drawer — one incident plus its activity timeline and comment
 * thread, with the Task 5-7 write actions layered on: re-categorise
 * (impact / urgency → a derived priority), assign to an internal user, and the
 * work transitions (start / resolve / close / reopen).
 *
 * Mirrors `src/app/(internal)/demands/DemandDrawer.tsx`. Opened from
 * `IncidentRegister`'s card click. On `open` it fetches `GET /api/incidents/:id`
 * and `GET /api/incidents/:id/comments` via `apiFetch` — never a bare `fetch`
 * (Global Constraint). Every write goes through `apiFetch` too; after a
 * successful write both GETs re-run so the status pill, the priority tag, and
 * the activity timeline all reflect the server.
 *
 * `viewer` is threaded from `page.tsx` (`whoami()` in an RSC) → `IncidentRegister`
 * → here. `viewer.kind === "INTERNAL"` gates the "visible to client" checkbox;
 * `viewer.hats.includes("DEVELOPER")` gates the categorise / assign / work
 * controls.
 */

export type IncidentViewer = {
  id: string;
  kind: string;
  hats: string[];
};

type Level = "LOW" | "MEDIUM" | "HIGH";
type IncidentStatus =
  "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

type ActivityItem = { time: string; text: string };

type LinkedChange = {
  changeId: string;
  ref: string;
  kind: string;
  status: string;
};

type IncidentView = {
  id: string;
  ref: string;
  title: string;
  description: string;
  affectedService: string;
  impact: string;
  urgency: string;
  priority: string;
  status: string;
  assigneeId?: string | null;
  /** `INCIDENT_INCLUDE` joins `assignee: { displayName }`; may be null. */
  assignee?: { displayName: string } | null;
  dueAt?: string | null;
  overdue?: boolean;
  resolution?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  createdAt?: string;
  activity?: ActivityItem[];
  /** Internal serialization only — empty until plan-03 seeds any. */
  linkedChanges?: LinkedChange[];
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

type InternalUser = { id: string; displayName: string };

const LEVELS: Level[] = ["LOW", "MEDIUM", "HIGH"];
const LEVEL_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

function isLevel(v: string): v is Level {
  return v === "LOW" || v === "MEDIUM" || v === "HIGH";
}

function statusTone(status: string): PillTone {
  if (status === "RESOLVED" || status === "CLOSED") return "ok";
  if (status === "IN_PROGRESS") return "warn";
  return "info";
}

function statusLabel(status: string): string {
  const known: IncidentStatus[] = [
    "NEW",
    "ASSIGNED",
    "IN_PROGRESS",
    "RESOLVED",
    "CLOSED",
  ];
  return known.includes(status as IncidentStatus)
    ? internalIncidentStatusLabel(status as IncidentStatus)
    : status;
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

function humanizeDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function slaLine(
  dueAt: string | null | undefined,
  overdue: boolean | undefined,
): string {
  if (!dueAt) return "No SLA set.";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "No SLA set.";
  const diff = due - Date.now();
  if (overdue || diff <= 0) {
    return `Overdue by ${humanizeDuration(Math.abs(diff))}`;
  }
  return `Time remaining: ${humanizeDuration(diff)}`;
}

function linkedChangeLine(link: LinkedChange): string {
  const verb = link.kind === "FIXES" ? "Fixed by" : "Caused by";
  const status = link.status.toLowerCase().replace(/_/g, " ");
  return `${verb} ${link.ref} (${status})`;
}

export function IncidentDrawer({
  id,
  open,
  onClose,
  viewer,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  viewer: IncidentViewer;
}) {
  const [incident, setIncident] = useState<IncidentView | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comment thread.
  const [draft, setDraft] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Write-action state.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [impact, setImpact] = useState("");
  const [urgency, setUrgency] = useState("");
  const [categoriseReason, setCategoriseReason] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [resolution, setResolution] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const canWrite = viewer.hats.includes("DEVELOPER");
  const isInternal = viewer.kind === "INTERNAL";

  const refetch = useCallback(async () => {
    const [inc, c] = await Promise.all([
      apiFetch<IncidentView>(`/api/incidents/${id}`),
      apiFetch<{ comments: CommentView[] }>(`/api/incidents/${id}/comments`),
    ]);
    setIncident(inc);
    setComments(c.comments);
  }, [id]);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<IncidentView>(`/api/incidents/${id}`),
      apiFetch<{ comments: CommentView[] }>(`/api/incidents/${id}/comments`),
    ])
      .then(([inc, c]) => {
        if (cancelled) return;
        setIncident(inc);
        setComments(c.comments);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This incident could not be found."
            : "Something went wrong loading this incident.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, id]);

  // The assignee picker's source list — only a writer sees the control, so only
  // a writer needs the fetch.
  useEffect(() => {
    if (!open || !canWrite) return;
    let cancelled = false;
    apiFetch<{ users: InternalUser[] }>("/api/users?kind=INTERNAL")
      .then((r) => {
        if (!cancelled) setUsers(r.users);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canWrite]);

  // Sync the editable drafts to the server's values whenever the incident
  // (re)loads — after a write, the server is the source of truth.
  useEffect(() => {
    setImpact(incident?.impact ?? "");
    setUrgency(incident?.urgency ?? "");
    setCategoriseReason("");
    setAssigneeId(incident?.assigneeId ?? "");
    setResolution("");
    setReopenReason("");
    setActionError(null);
  }, [incident]);

  const status = incident?.status ?? "";
  // Server ruling 5: while NEW / ASSIGNED, impact / urgency are freely editable;
  // once work has started a non-empty reason is required.
  const categorisationLocked = status !== "NEW" && status !== "ASSIGNED";

  const previewPriority: Priority =
    isLevel(impact) && isLevel(urgency)
      ? priorityFor(impact, urgency)
      : ((incident?.priority as Priority) ?? "P4");

  async function runWrite(
    method: "POST" | "PATCH",
    path: string,
    body?: unknown,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      await apiFetch(path, { method, body });
      await refetch();
    } catch {
      setActionError("That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const saveCategorisation = () =>
    runWrite("PATCH", `/api/incidents/${id}/categorize`, {
      impact,
      urgency,
      reason:
        categorisationLocked && categoriseReason.trim()
          ? categoriseReason.trim()
          : undefined,
    });

  const assign = () =>
    runWrite("POST", `/api/incidents/${id}/assign`, { assigneeId });

  const startWork = () =>
    runWrite("POST", `/api/incidents/${id}/transition`, { to: "IN_PROGRESS" });

  const resolve = () =>
    runWrite("POST", `/api/incidents/${id}/transition`, {
      to: "RESOLVED",
      resolution: resolution.trim(),
    });

  const closeIncident = () =>
    runWrite("POST", `/api/incidents/${id}/transition`, { to: "CLOSED" });

  const reopen = () =>
    runWrite("POST", `/api/incidents/${id}/reopen`, {
      reason: reopenReason.trim(),
    });

  const categoriseDirty =
    impact !== (incident?.impact ?? "") ||
    urgency !== (incident?.urgency ?? "");
  const categoriseValid =
    isLevel(impact) &&
    isLevel(urgency) &&
    (!categorisationLocked || categoriseReason.trim() !== "");
  const assignDirty =
    assigneeId !== "" && assigneeId !== (incident?.assigneeId ?? "");

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      await apiFetch<{ comments: CommentView[] }>(
        `/api/incidents/${id}/comments`,
        {
          method: "POST",
          body: {
            body,
            visibleToClient: isInternal ? visibleToClient : undefined,
          },
        },
      );
      await refetch();
      setDraft("");
      setVisibleToClient(false);
    } catch {
      setCommentError("Your comment could not be posted.");
    } finally {
      setPosting(false);
    }
  }

  const linkedChanges = incident?.linkedChanges ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={incident?.title ?? "Incident"}
      idLabel={incident?.ref ?? ""}
    >
      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : incident ? (
        <div className={styles.body}>
          <div className={styles.statusRow}>
            <Pill tone={statusTone(incident.status)}>
              {statusLabel(incident.status)}
            </Pill>
            <PriorityTag priority={incident.priority as Priority} />
          </div>

          <Panel title="Impact" pad>
            <p className={styles.prose}>{incident.description}</p>
            <p className={styles.metaLine}>
              Affected service: {incident.affectedService}
            </p>
          </Panel>

          <Panel title="Categorisation" pad>
            {canWrite ? (
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Impact
                  <select
                    className={styles.select}
                    aria-label="Impact"
                    value={impact}
                    onChange={(e) => setImpact(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {LEVEL_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.inlineLabel}>
                  Urgency
                  <select
                    className={styles.select}
                    aria-label="Urgency"
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {LEVEL_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.preview} data-testid="priority-preview">
                  Priority preview: <PriorityTag priority={previewPriority} />
                </p>
                {categorisationLocked ? (
                  <textarea
                    className={styles.textarea}
                    aria-label="Reason for re-categorising"
                    rows={2}
                    value={categoriseReason}
                    onChange={(e) => setCategoriseReason(e.target.value)}
                    placeholder="Work has started — a reason is required"
                  />
                ) : null}
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveCategorisation}
                  disabled={busy || !categoriseValid || !categoriseDirty}
                >
                  Save categorisation
                </button>
              </div>
            ) : (
              <div className={styles.readonlyGrid}>
                <p className={styles.metaLine}>
                  Impact: {LEVEL_LABELS[incident.impact] ?? incident.impact}
                </p>
                <p className={styles.metaLine}>
                  Urgency: {LEVEL_LABELS[incident.urgency] ?? incident.urgency}
                </p>
              </div>
            )}
          </Panel>

          {canWrite ? (
            <Panel title="Assignment" pad>
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Assignee
                  <select
                    className={styles.select}
                    aria-label="Assignee"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.action}
                  onClick={assign}
                  disabled={busy || !assignDirty}
                >
                  Assign
                </button>
              </div>
            </Panel>
          ) : (
            <Panel title="Assignment" pad>
              <p className={styles.metaLine}>
                {incident.assignee?.displayName ?? "Unassigned"}
              </p>
            </Panel>
          )}

          {canWrite ? (
            <Panel title="Work" pad>
              <div className={styles.field}>
                {status === "NEW" ? (
                  <p className={styles.metaLine}>
                    Assign this incident to begin work.
                  </p>
                ) : null}

                {status === "ASSIGNED" ? (
                  <button
                    type="button"
                    className={styles.action}
                    onClick={startWork}
                    disabled={busy}
                  >
                    Start work
                  </button>
                ) : null}

                {status === "IN_PROGRESS" ? (
                  <>
                    <textarea
                      className={styles.textarea}
                      aria-label="Resolution"
                      rows={3}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="What resolved this incident?"
                    />
                    <button
                      type="button"
                      className={styles.action}
                      onClick={resolve}
                      disabled={busy || resolution.trim() === ""}
                    >
                      Resolve
                    </button>
                  </>
                ) : null}

                {status === "RESOLVED" || status === "CLOSED" ? (
                  <>
                    {status === "RESOLVED" ? (
                      <button
                        type="button"
                        className={styles.action}
                        onClick={closeIncident}
                        disabled={busy}
                      >
                        Close
                      </button>
                    ) : null}
                    <textarea
                      className={styles.textarea}
                      aria-label="Reason for reopening"
                      rows={2}
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Why is this incident being reopened?"
                    />
                    <button
                      type="button"
                      className={styles.actionGhost}
                      onClick={reopen}
                      disabled={busy || reopenReason.trim() === ""}
                    >
                      Reopen
                    </button>
                  </>
                ) : null}
              </div>
            </Panel>
          ) : null}

          <Panel title="SLA" pad>
            <p className={styles.metaLine}>
              {slaLine(incident.dueAt, incident.overdue)}
            </p>
          </Panel>

          {linkedChanges.length > 0 ? (
            <Panel title="Linked change" pad>
              <ul className={styles.linkList}>
                {linkedChanges.map((link) => (
                  <li key={link.changeId} className={styles.metaLine}>
                    {linkedChangeLine(link)}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {actionError ? (
            <p role="alert" className={styles.error}>
              {actionError}
            </p>
          ) : null}

          <Panel title="Activity" pad>
            <Timeline items={incident.activity ?? []} />
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
              {isInternal ? (
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
