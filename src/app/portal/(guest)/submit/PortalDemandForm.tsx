"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import styles from "./submit.module.css";

/**
 * The guest's "request software or a feature" form (plan-04 Task 11) — the
 * demand half of the unified `/portal/submit` page. Fields: title, "what do you
 * need and why" (`problem`), and an optional "which product" (`affectedService`).
 *
 * POSTs to `/api/demands` through `apiFetch` — never a bare `fetch` (Global
 * Constraint) — with `source: "CLIENT"`. `createDemand` trusts the body's
 * `source` for a guest (plan-01 Task 2) and the demand is client-scoped
 * server-side regardless; `source` only drives the register's display and
 * filter. On success routes to the request list. The required-field guard here
 * mirrors `createDemandBody`; the server is authoritative.
 */

export function PortalDemandForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [affectedService, setAffectedService] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = title.trim();
    const trimmedProblem = problem.trim();
    const trimmedService = affectedService.trim();
    if (!trimmedTitle || !trimmedProblem) {
      setError("Please tell us what you need and why so we can look into it.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/demands", {
        method: "POST",
        body: {
          title: trimmedTitle,
          problem: trimmedProblem,
          affectedService: trimmedService || undefined,
          source: "CLIENT",
        },
      });
      router.push("/portal/demands");
    } catch {
      setError("We could not send your request. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="demand-title">
          What do you need
        </label>
        <input
          id="demand-title"
          className={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="demand-problem">
          What do you need and why
        </label>
        <textarea
          id="demand-problem"
          className={styles.textarea}
          rows={4}
          value={problem}
          onChange={(event) => setProblem(event.target.value)}
          placeholder="What you are trying to do, and what would help"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="demand-service">
          Which product (optional)
        </label>
        <input
          id="demand-service"
          className={styles.input}
          value={affectedService}
          onChange={(event) => setAffectedService(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <div>
        <button type="submit" className={styles.send} disabled={submitting}>
          {submitting ? "Sending…" : "Send the request"}
        </button>
      </div>
    </form>
  );
}
