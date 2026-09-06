"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Panel } from "@/components/Panel";
import { Pill, type PillTone } from "@/components/Pill";
import { Timeline } from "@/components/Timeline";
import { ApiError, apiFetch } from "@/lib/api/client";
import styles from "./DemandDrawer.module.css";
import { OverrideDialog } from "./OverrideDialog";

/**
 * The demand drawer — one demand plus its activity timeline and comment thread
 * (`plans/plan-01-demand.md` Task 6), with the Task 7 write actions layered on:
 * triage pick-up, value / effort / cost-of-delay scoring, the worth decision,
 * the single-approver override, an outright reject, and a disabled Convert stub.
 *
 * Opened from `DemandRegister`'s row click. On `open` it fetches
 * `GET /api/demands/:id` (role-serialized demand + assembled `activity`) and
 * `GET /api/demands/:id/comments` via `apiFetch` — never a bare `fetch` (Global
 * Constraint). Every write goes through `apiFetch` too; after a successful write
 * both GETs re-run so the status pill, the worth panels, and the activity
 * timeline all reflect the server.
 *
 * `viewer` is threaded from `page.tsx` (`whoami()` in an RSC) → `DemandRegister`
 * → here. `viewer.kind === "INTERNAL"` gates the "visible to client" checkbox;
 * `viewer.hats` / `viewer.id` gate the write controls.
 */

export type DemandViewer = {
  id: string;
  kind: string;
  hats: string[];
};

type ActivityItem = { time: string; text: string };

type WorthView = {
  businessValue?: string | null;
  valueScore?: number | null;
  effort?: string | null;
  feasibility?: string | null;
  costOfDelay?: string | null;
  decision?: string | null;
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
  /** Internal serialization only — the submitter, for the SoD override gate. */
  submittedById?: string | null;
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

const EFFORTS = ["S", "M", "L"] as const;

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
  viewer,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  viewer: DemandViewer;
}) {
  const [demand, setDemand] = useState<DemandView | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Write-action state.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [valueNarrative, setValueNarrative] = useState("");
  const [valueScore, setValueScore] = useState("");
  const [effort, setEffort] = useState("");
  const [feasibility, setFeasibility] = useState("");
  const [costOfDelay, setCostOfDelay] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [d, c] = await Promise.all([
      apiFetch<DemandView>(`/api/demands/${id}`),
      apiFetch<{ comments: CommentView[] }>(`/api/demands/${id}/comments`),
    ]);
    setDemand(d);
    setComments(c.comments);
  }, [id]);

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

  // Sync the editable drafts to the server's values whenever the demand
  // (re)loads — after a write, the server is the source of truth.
  useEffect(() => {
    const w = demand?.worth;
    setValueNarrative(w?.businessValue ?? "");
    setValueScore(w?.valueScore != null ? String(w.valueScore) : "");
    setEffort(w?.effort ?? "");
    setFeasibility(w?.feasibility ?? "");
    setCostOfDelay(w?.costOfDelay ?? "");
    setRejectOpen(false);
    setRejectReason("");
    setActionError(null);
  }, [demand]);

  const isInternal = viewer.kind === "INTERNAL";
  const worth = demand?.worth ?? null;
  const status = demand?.status;
  const isSubmitter = demand?.submittedById === viewer.id;

  const canValue =
    status === "TRIAGING" && viewer.hats.includes("BUSINESS_APPROVER");
  const canEffort =
    status === "TRIAGING" && viewer.hats.includes("TECHNICAL_APPROVER");
  const canCostOfDelay = status === "TRIAGING" && isInternal;
  const canDecide =
    viewer.hats.includes("BUSINESS_APPROVER") ||
    viewer.hats.includes("TECHNICAL_APPROVER");
  const canTriage = status === "SUBMITTED" && isInternal;
  const worthComplete = Boolean(
    worth?.businessValue && worth?.effort && worth?.costOfDelay,
  );
  const showConvert = status === "APPROVED" && worth?.decision === "PURSUE";
  const showDecisionPanel = canDecide || showConvert;

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

  const saveValue = () =>
    runWrite("PATCH", `/api/demands/${id}/value`, {
      businessValue: valueNarrative.trim(),
      valueScore: valueScore.trim() ? Number(valueScore) : undefined,
    });

  const saveEffort = () =>
    runWrite("PATCH", `/api/demands/${id}/effort`, {
      effort,
      feasibility: feasibility.trim() ? feasibility.trim() : undefined,
    });

  const saveCostOfDelay = () =>
    runWrite("PATCH", `/api/demands/${id}/cost-of-delay`, {
      costOfDelay: costOfDelay.trim(),
    });

  const startTriage = () => runWrite("POST", `/api/demands/${id}/triage`);

  const confirmReject = () =>
    runWrite("POST", `/api/demands/${id}/reject`, {
      reason: rejectReason.trim(),
    });

  async function sendDecision(
    decision: string,
    overrideJustification?: string,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      await apiFetch(`/api/demands/${id}/decision`, {
        method: "POST",
        body: { decision, overrideJustification },
      });
      setOverrideOpen(false);
      setPendingDecision(null);
      await refetch();
    } catch (e: unknown) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        e.body?.overrideAction === "demand.decide.override"
      ) {
        setPendingDecision(decision);
        setOverrideOpen(true);
      } else {
        setActionError("The decision could not be recorded.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onDecisionClick(decision: string) {
    setActionError(null);
    if (isSubmitter) {
      // Proactive: the viewer is the submitter, so an override is required.
      setPendingDecision(decision);
      setOverrideOpen(true);
      return;
    }
    void sendDecision(decision);
  }

  function onOverrideConfirm(justification: string) {
    if (pendingDecision) void sendDecision(pendingDecision, justification);
  }

  function onOverrideCancel() {
    if (busy) return;
    setOverrideOpen(false);
    setPendingDecision(null);
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      await apiFetch<{ comments: CommentView[] }>(
        `/api/demands/${id}/comments`,
        {
          method: "POST",
          body: {
            body,
            visibleToClient: isInternal ? visibleToClient : undefined,
          },
        },
      );
      // Route through the shared refresh so the activity timeline updates too.
      await refetch();
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
          <div className={styles.statusRow}>
            <Pill tone={statusTone(demand.status)}>
              {STATUS_LABELS[demand.status] ?? demand.status}
            </Pill>
            {canTriage ? (
              <button
                type="button"
                className={styles.action}
                onClick={startTriage}
                disabled={busy}
              >
                Start triage
              </button>
            ) : null}
          </div>

          <Panel title="Problem" pad>
            <p className={styles.prose}>{demand.problem}</p>
          </Panel>

          <section
            className={styles.worthSection}
            aria-label="Worth assessment"
          >
            <h3 className={styles.sectionHead}>Worth assessment</h3>
            <div className={styles.worthGrid}>
              <Panel title="Business value" pad>
                {canValue ? (
                  <div className={styles.field}>
                    <textarea
                      className={styles.textarea}
                      aria-label="Business value"
                      rows={3}
                      value={valueNarrative}
                      onChange={(e) => setValueNarrative(e.target.value)}
                      placeholder="What is the business value?"
                    />
                    <label className={styles.inlineLabel}>
                      Value score
                      <input
                        type="number"
                        className={styles.number}
                        aria-label="Value score (1-10)"
                        min={1}
                        max={10}
                        value={valueScore}
                        onChange={(e) => setValueScore(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.action}
                      onClick={saveValue}
                      disabled={busy || valueNarrative.trim() === ""}
                    >
                      Save business value
                    </button>
                  </div>
                ) : (
                  <>
                    <p className={styles.prose}>
                      {worth?.businessValue ?? "—"}
                    </p>
                    {worth?.valueScore != null ? (
                      <p className={styles.score}>{worth.valueScore}/10</p>
                    ) : null}
                  </>
                )}
              </Panel>
              <Panel title="Effort & feasibility" pad>
                {canEffort ? (
                  <div className={styles.field}>
                    <label className={styles.inlineLabel}>
                      Effort
                      <select
                        className={styles.select}
                        aria-label="Effort"
                        value={effort}
                        onChange={(e) => setEffort(e.target.value)}
                      >
                        <option value="">Select…</option>
                        {EFFORTS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      className={styles.textarea}
                      aria-label="Feasibility"
                      rows={3}
                      value={feasibility}
                      onChange={(e) => setFeasibility(e.target.value)}
                      placeholder="Feasibility notes (optional)"
                    />
                    <button
                      type="button"
                      className={styles.action}
                      onClick={saveEffort}
                      disabled={
                        busy ||
                        !EFFORTS.includes(effort as (typeof EFFORTS)[number])
                      }
                    >
                      Save effort
                    </button>
                  </div>
                ) : (
                  <>
                    <p className={styles.prose}>{worth?.effort ?? "—"}</p>
                    <p className={styles.prose}>{worth?.feasibility ?? "—"}</p>
                  </>
                )}
              </Panel>
            </div>
          </section>

          <Panel title="Cost of delay" pad>
            {canCostOfDelay ? (
              <div className={styles.field}>
                <textarea
                  className={styles.textarea}
                  aria-label="Cost of delay"
                  rows={3}
                  value={costOfDelay}
                  onChange={(e) => setCostOfDelay(e.target.value)}
                  placeholder="What does delay cost?"
                />
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveCostOfDelay}
                  disabled={busy || costOfDelay.trim() === ""}
                >
                  Save cost of delay
                </button>
              </div>
            ) : (
              <p className={styles.prose}>{worth?.costOfDelay ?? "—"}</p>
            )}
          </Panel>

          {showDecisionPanel ? (
            <Panel title="Decision" pad>
              <div className={styles.decisionRow}>
                {(["PURSUE", "PARK", "DROP"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={styles.action}
                    onClick={() => onDecisionClick(d)}
                    disabled={!worthComplete || !canDecide || busy}
                  >
                    {d === "PURSUE" ? "Pursue" : d === "PARK" ? "Park" : "Drop"}
                  </button>
                ))}
              </div>
              <div className={styles.decisionRow}>
                {canDecide ? (
                  <button
                    type="button"
                    className={styles.actionGhost}
                    onClick={() => setRejectOpen((v) => !v)}
                    disabled={busy}
                  >
                    Reject
                  </button>
                ) : null}
                {showConvert ? (
                  <button
                    type="button"
                    className={styles.actionGhost}
                    disabled
                    title="Available once the change module ships (plan-03)"
                  >
                    Convert
                  </button>
                ) : null}
              </div>
              {rejectOpen ? (
                <div className={styles.field}>
                  <textarea
                    className={styles.textarea}
                    aria-label="Reason for declining"
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why is this demand declined?"
                  />
                  <button
                    type="button"
                    className={styles.action}
                    onClick={confirmReject}
                    disabled={busy || rejectReason.trim() === ""}
                  >
                    Confirm decline
                  </button>
                </div>
              ) : null}
              {actionError ? (
                <p role="alert" className={styles.error}>
                  {actionError}
                </p>
              ) : null}
            </Panel>
          ) : null}

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

      <OverrideDialog
        open={overrideOpen}
        decision={pendingDecision}
        busy={busy}
        onConfirm={onOverrideConfirm}
        onCancel={onOverrideCancel}
      />
    </Drawer>
  );
}
