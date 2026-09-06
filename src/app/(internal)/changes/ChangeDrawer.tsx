"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApprovalPanel,
  type ApprovalPanelState,
} from "@/components/ApprovalPanel";
import { Drawer } from "@/components/Drawer";
import { LifecycleStepper, type Stage } from "@/components/LifecycleStepper";
import { Panel } from "@/components/Panel";
import {
  Pill,
  RiskLabel,
  type PillTone,
  type RiskLevel,
} from "@/components/Pill";
import { Timeline } from "@/components/Timeline";
import { ApiError, apiFetch } from "@/lib/api/client";
import styles from "./ChangeDrawer.module.css";

/**
 * The change drawer (`plans/plan-03-change-approvals` Task 13, spec 03 §8.2) —
 * the plan's centrepiece UI. It mirrors `IncidentDrawer` in structure: on `open`
 * it `apiFetch`es `GET /api/changes/:id` (the serialized change with its
 * `stepper`, `approval`, and `activity`) and — for a REVIEWER — the review
 * thread; every write goes through `apiFetch` and re-fetches after.
 *
 * `viewer` is threaded from `page.tsx` (`whoami()` in an RSC) → `ChangeRegister`
 * → here. The RFC / risk / impact / rollback / link edits are gated on
 * owner-or-DEVELOPER; the stage advance / schedule / rollback / PIR writes are
 * DEVELOPER-gated server-side and simply surface their errors here. The review
 * thread and its composer are shown only to a REVIEWER-hat viewer.
 *
 * `stepper.canAdvance` is server-computed and passed to `LifecycleStepper`
 * verbatim — the drawer never recomputes it. The two free-checkbox gates
 * (`standaloneConfirmed`, `wentToPlanAcknowledged`) are local state, folded into
 * the `/advance` call's `acknowledgements` body.
 */

export type ChangeViewer = {
  id: string;
  kind: string;
  hats: string[];
};

type ApprovalDecisionInput = {
  decision: "APPROVED" | "REJECTED";
  reason: string;
  overrideJustification?: string;
};

type LinkedIncident = { incidentId: string; ref: string; kind: string };

type StepperView = {
  stages: Stage[];
  currentStageKey: string;
  canAdvance: boolean;
  blockedReason?: string;
};

type ChangeView = {
  id: string;
  ref: string;
  title: string;
  changeType: string;
  rfc: string | null;
  riskLevel: RiskLevel | null;
  impactAssessment: string | null;
  rollbackPlan: string | null;
  testPlan: string | null;
  status: string;
  statusLabel: string;
  ownerId: string;
  windowStart: string | null;
  windowEnd: string | null;
  originatingDemandId: string | null;
  implementedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stage: string | null;
  approval: ApprovalPanelState;
  linkedIncidents: LinkedIncident[];
  originatingDemand: { ref: string } | null;
  activity: { time: string; text: string }[];
  stepper: StepperView;
};

type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  authorName?: string;
  author?: string;
};

const RISK_LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];
const RISK_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};
const VALUE_REALIZED = ["YES", "PARTIAL", "NO"] as const;
const VALUE_REALIZED_LABELS: Record<string, string> = {
  YES: "Yes",
  PARTIAL: "Partially",
  NO: "No",
};
const LINK_KINDS = ["CAUSED_BY", "FIXES"] as const;
const LINK_KIND_LABELS: Record<string, string> = {
  CAUSED_BY: "Caused by",
  FIXES: "Fixes",
};

const TERMINAL: string[] = ["CLOSED", "ROLLED_BACK"];

function statusTone(status: string): PillTone {
  if (status === "CLOSED") return "ok";
  if (status === "ROLLED_BACK") return "crit";
  if (status === "IMPLEMENTING" || status === "SCHEDULED") return "warn";
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

/** ISO 8601 → the value a `<input type="datetime-local">` expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return iso.slice(0, 16);
}

export function ChangeDrawer({
  id,
  open,
  onClose,
  viewer,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  viewer: ChangeViewer;
}) {
  const [change, setChange] = useState<ChangeView | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Write-action state.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);

  // Editable field drafts (synced from the server on every (re)load).
  const [rfc, setRfc] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [impactAssessment, setImpactAssessment] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [valueRealized, setValueRealized] = useState("");
  const [lessons, setLessons] = useState("");
  const [rollbackNote, setRollbackNote] = useState("");
  const [showRollback, setShowRollback] = useState(false);
  const [linkIncidentId, setLinkIncidentId] = useState("");
  const [linkKind, setLinkKind] = useState<string>("FIXES");

  // Free-checkbox gate acknowledgements — local until sent on `/advance`.
  const [standaloneConfirmed, setStandaloneConfirmed] = useState(false);
  const [wentToPlanAcknowledged, setWentToPlanAcknowledged] = useState(false);

  // Review thread composer.
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const isReviewer = viewer.hats.includes("REVIEWER");
  const canEdit =
    change != null &&
    (viewer.id === change.ownerId || viewer.hats.includes("DEVELOPER"));

  const refetch = useCallback(async () => {
    const next = await apiFetch<ChangeView>(`/api/changes/${id}`);
    setChange(next);
    if (isReviewer) {
      const c = await apiFetch<{ comments: CommentView[] }>(
        `/api/changes/${id}/comments`,
      );
      setComments(c.comments);
    }
  }, [id, isReviewer]);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const next = await apiFetch<ChangeView>(`/api/changes/${id}`);
        if (cancelled) return;
        setChange(next);
        if (isReviewer) {
          const c = await apiFetch<{ comments: CommentView[] }>(
            `/api/changes/${id}/comments`,
          );
          if (cancelled) return;
          setComments(c.comments);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This change could not be found."
            : "Something went wrong loading this change.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, id, isReviewer]);

  // The server is the source of truth after every write — resync the drafts.
  useEffect(() => {
    setRfc(change?.rfc ?? "");
    setRiskLevel(change?.riskLevel ?? "");
    setImpactAssessment(change?.impactAssessment ?? "");
    setRollbackPlan(change?.rollbackPlan ?? "");
    setWindowStart(toLocalInput(change?.windowStart ?? null));
    setWindowEnd(toLocalInput(change?.windowEnd ?? null));
    setValueRealized("");
    setLessons("");
    setRollbackNote("");
    setShowRollback(false);
    setLinkIncidentId("");
    setLinkKind("FIXES");
    setStandaloneConfirmed(false);
    setWentToPlanAcknowledged(false);
    setActionError(null);
    setInlineMessage(null);
  }, [change]);

  async function runWrite(
    method: "POST" | "PATCH",
    path: string,
    body?: unknown,
  ) {
    setActionError(null);
    setInlineMessage(null);
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

  const status = change?.status ?? "";
  const stepperReadOnly = TERMINAL.includes(status);

  // Reflect the local gate acknowledgements in the stepper's gate items — the
  // serialized read always ships them un-checked.
  const stepperStages: Stage[] = (change?.stepper?.stages ?? []).map((s) => ({
    ...s,
    gate: s.gate.map((g) => {
      if (g.key === "origin" && standaloneConfirmed)
        return { ...g, done: true };
      if (g.key === "wentToPlanAcknowledged" && wentToPlanAcknowledged) {
        return { ...g, done: true };
      }
      return g;
    }),
  }));

  function toggleGate(_stageKey: string, gateKey: string, done: boolean) {
    if (gateKey === "origin") setStandaloneConfirmed(done);
    else if (gateKey === "wentToPlanAcknowledged") {
      setWentToPlanAcknowledged(done);
    }
  }

  function advance() {
    if (!change) return;
    const acknowledgements: Record<string, boolean> = {};
    if (standaloneConfirmed) acknowledgements.standaloneConfirmed = true;
    if (wentToPlanAcknowledged) acknowledgements.wentToPlanAcknowledged = true;
    void runWrite("POST", `/api/changes/${id}/advance`, {
      from: change.status,
      acknowledgements,
    });
  }

  function saveRfc() {
    void runWrite("PATCH", `/api/changes/${id}`, { rfc: rfc.trim() });
  }

  function saveRiskImpact() {
    const patch: Record<string, string> = {};
    if (riskLevel && riskLevel !== (change?.riskLevel ?? "")) {
      patch.riskLevel = riskLevel;
    }
    if (
      impactAssessment.trim() &&
      impactAssessment.trim() !== (change?.impactAssessment ?? "")
    ) {
      patch.impactAssessment = impactAssessment.trim();
    }
    if (Object.keys(patch).length === 0) return;
    void runWrite("PATCH", `/api/changes/${id}`, patch);
  }

  function saveRollbackPlan() {
    void runWrite("PATCH", `/api/changes/${id}`, {
      rollbackPlan: rollbackPlan.trim(),
    });
  }

  function saveWindow() {
    void runWrite("POST", `/api/changes/${id}/schedule`, {
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
    });
  }

  function recordPir() {
    void runWrite("POST", `/api/changes/${id}/pir`, {
      valueRealized,
      lessons: lessons.trim(),
    });
  }

  function markRolledBack() {
    void runWrite("POST", `/api/changes/${id}/rollback`, {
      note: rollbackNote.trim(),
    });
  }

  function addLink() {
    void runWrite("POST", `/api/changes/${id}/link-incident`, {
      incidentId: linkIncidentId.trim(),
      kind: linkKind,
    });
  }

  async function onDecision(input: ApprovalDecisionInput): Promise<void> {
    if (!change) return;
    const tier =
      change.approval?.currentStep?.requiredHat === "TECHNICAL_APPROVER"
        ? "technical"
        : "business";
    setActionError(null);
    setInlineMessage(null);
    setBusy(true);
    try {
      await apiFetch(`/api/changes/${id}/approve/${tier}`, {
        method: "POST",
        body: {
          decision: input.decision,
          reason: input.reason,
          overrideJustification: input.overrideJustification,
        },
      });
      await refetch();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        if (e.body?.error === "conflict") {
          setInlineMessage("This step was already decided.");
          await refetch();
          return;
        }
        // `segregation` — the panel already offers the creator the override
        // path and will re-call `onDecision` with an `overrideJustification`.
        if (e.body?.error === "segregation") return;
      }
      setActionError("That decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      await apiFetch(`/api/changes/${id}/comments`, {
        method: "POST",
        body: { body },
      });
      await refetch();
      setDraft("");
    } catch {
      setCommentError("Your comment could not be posted.");
    } finally {
      setPosting(false);
    }
  }

  const rfcDirty = rfc.trim() !== "" && rfc !== (change?.rfc ?? "");
  const riskImpactDirty =
    (riskLevel !== "" && riskLevel !== (change?.riskLevel ?? "")) ||
    (impactAssessment.trim() !== "" &&
      impactAssessment.trim() !== (change?.impactAssessment ?? ""));
  const rollbackDirty =
    rollbackPlan.trim() !== "" &&
    rollbackPlan.trim() !== (change?.rollbackPlan ?? "");
  const windowDirty = windowStart !== "" && windowEnd !== "";

  const showSchedule = status === "APPROVAL" || status === "SCHEDULED";
  const showPir = status === "IMPLEMENTING" || status === "PIR";
  const showRollbackPanel = status === "IMPLEMENTING";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={change?.title ?? "Change"}
      idLabel={change?.ref ?? ""}
    >
      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : change ? (
        <div className={styles.body}>
          <div className={styles.statusRow}>
            {change.riskLevel ? <RiskLabel level={change.riskLevel} /> : null}
            <Pill tone={statusTone(change.status)}>{change.statusLabel}</Pill>
          </div>

          <Panel title="RFC" pad>
            {canEdit ? (
              <div className={styles.field}>
                <textarea
                  className={styles.textarea}
                  aria-label="RFC"
                  rows={6}
                  value={rfc}
                  onChange={(e) => setRfc(e.target.value)}
                  placeholder="The request for change — markdown source."
                />
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveRfc}
                  disabled={busy || !rfcDirty}
                >
                  Save
                </button>
              </div>
            ) : (
              <p className={styles.prose}>
                {change.rfc?.trim() ? change.rfc : "No RFC written yet."}
              </p>
            )}
          </Panel>

          <Panel title="Risk & impact" pad>
            {canEdit ? (
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Risk level
                  <select
                    className={styles.select}
                    aria-label="Risk level"
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {RISK_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {RISK_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  className={styles.textarea}
                  aria-label="Impact assessment"
                  rows={4}
                  value={impactAssessment}
                  onChange={(e) => setImpactAssessment(e.target.value)}
                  placeholder="What this change affects, and how."
                />
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveRiskImpact}
                  disabled={busy || !riskImpactDirty}
                >
                  Save
                </button>
              </div>
            ) : (
              <div className={styles.readonlyGrid}>
                <p className={styles.metaLine}>
                  Risk:{" "}
                  {change.riskLevel
                    ? RISK_LABELS[change.riskLevel]
                    : "Not assessed"}
                </p>
                <p className={styles.prose}>
                  {change.impactAssessment?.trim()
                    ? change.impactAssessment
                    : "No impact assessment written yet."}
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Rollback plan" pad>
            {!change.rollbackPlan?.trim() ? (
              <p role="alert" className={styles.loudEmpty}>
                Required before approval
              </p>
            ) : null}
            {canEdit ? (
              <div className={styles.field}>
                <textarea
                  className={styles.textarea}
                  aria-label="Rollback plan"
                  rows={4}
                  value={rollbackPlan}
                  onChange={(e) => setRollbackPlan(e.target.value)}
                  placeholder="How to undo this change if it goes wrong."
                />
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveRollbackPlan}
                  disabled={busy || !rollbackDirty}
                >
                  Save
                </button>
              </div>
            ) : change.rollbackPlan?.trim() ? (
              <p className={styles.prose}>{change.rollbackPlan}</p>
            ) : null}
          </Panel>

          {change.stepper ? (
            <Panel title="Lifecycle" pad>
              <LifecycleStepper
                stages={stepperStages}
                currentStageKey={change.stepper.currentStageKey}
                canAdvance={change.stepper.canAdvance}
                blockedReason={change.stepper.blockedReason}
                onToggleGate={toggleGate}
                onAdvance={advance}
                readOnly={stepperReadOnly}
              />
            </Panel>
          ) : null}

          {change.approval ? (
            <Panel title="Approval" pad>
              <ApprovalPanel
                state={change.approval}
                viewer={{ id: viewer.id, hats: viewer.hats }}
                onDecision={onDecision}
                busy={busy}
              />
              {inlineMessage ? (
                <p role="status" className={styles.metaLine}>
                  {inlineMessage}
                </p>
              ) : null}
            </Panel>
          ) : null}

          {showSchedule ? (
            <Panel title="Schedule" pad>
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Window start
                  <input
                    type="datetime-local"
                    className={styles.select}
                    aria-label="Window start"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                  />
                </label>
                <label className={styles.inlineLabel}>
                  Window end
                  <input
                    type="datetime-local"
                    className={styles.select}
                    aria-label="Window end"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={styles.action}
                  onClick={saveWindow}
                  disabled={busy || !windowDirty}
                >
                  Save window
                </button>
              </div>
            </Panel>
          ) : null}

          {showPir ? (
            <Panel title="Post-implementation review" pad>
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Value realized
                  <select
                    className={styles.select}
                    aria-label="Value realized"
                    value={valueRealized}
                    onChange={(e) => setValueRealized(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {VALUE_REALIZED.map((v) => (
                      <option key={v} value={v}>
                        {VALUE_REALIZED_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  className={styles.textarea}
                  aria-label="Lessons learned"
                  rows={3}
                  value={lessons}
                  onChange={(e) => setLessons(e.target.value)}
                  placeholder="What went well, and what to change next time."
                />
                <button
                  type="button"
                  className={styles.action}
                  onClick={recordPir}
                  disabled={
                    busy ||
                    status !== "PIR" ||
                    valueRealized === "" ||
                    lessons.trim() === ""
                  }
                >
                  Record PIR
                </button>
              </div>
            </Panel>
          ) : null}

          {showRollbackPanel ? (
            <Panel title="Rollback" pad>
              <div className={styles.field}>
                {showRollback ? (
                  <>
                    <textarea
                      className={styles.textarea}
                      aria-label="Rollback note"
                      rows={2}
                      value={rollbackNote}
                      onChange={(e) => setRollbackNote(e.target.value)}
                      placeholder="Why is this change being rolled back?"
                    />
                    <button
                      type="button"
                      className={styles.actionGhost}
                      onClick={markRolledBack}
                      disabled={busy || rollbackNote.trim() === ""}
                    >
                      Confirm rollback
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.actionGhost}
                    onClick={() => setShowRollback(true)}
                    disabled={busy}
                  >
                    Mark rolled back
                  </button>
                )}
              </div>
            </Panel>
          ) : null}

          <Panel title="Links" pad>
            <p className={styles.metaLine}>
              {change.originatingDemand
                ? `From demand ${change.originatingDemand.ref}`
                : "Standalone change — no originating demand."}
            </p>
            {(change.linkedIncidents ?? []).length > 0 ? (
              <ul className={styles.linkList}>
                {(change.linkedIncidents ?? []).map((l) => (
                  <li
                    key={`${l.incidentId}-${l.kind}`}
                    className={styles.metaLine}
                  >
                    {LINK_KIND_LABELS[l.kind] ?? l.kind} {l.ref}
                  </li>
                ))}
              </ul>
            ) : null}
            {canEdit ? (
              <div className={styles.field}>
                <label className={styles.inlineLabel}>
                  Incident id
                  <input
                    className={styles.select}
                    aria-label="Incident id"
                    value={linkIncidentId}
                    onChange={(e) => setLinkIncidentId(e.target.value)}
                  />
                </label>
                <label className={styles.inlineLabel}>
                  Link kind
                  <select
                    className={styles.select}
                    aria-label="Link kind"
                    value={linkKind}
                    onChange={(e) => setLinkKind(e.target.value)}
                  >
                    {LINK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LINK_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.action}
                  onClick={addLink}
                  disabled={busy || linkIncidentId.trim() === ""}
                >
                  Add link
                </button>
              </div>
            ) : null}
          </Panel>

          {actionError ? (
            <p role="alert" className={styles.error}>
              {actionError}
            </p>
          ) : null}

          <Panel title="Activity" pad>
            <Timeline items={change.activity ?? []} />
          </Panel>

          {isReviewer ? (
            <Panel title="Review" count={comments.length} pad>
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
                      </div>
                      <p className={styles.prose}>{c.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No review comments yet.</p>
              )}

              <form className={styles.commentForm} onSubmit={submitComment}>
                <textarea
                  className={styles.textarea}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a review comment"
                  aria-label="Add a review comment"
                  rows={3}
                />
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
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
