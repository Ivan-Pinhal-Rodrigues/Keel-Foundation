"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import styles from "./portal-incidents.module.css";

/**
 * The guest's "report a problem" form (`plans/plan-02-incident.md` Task 10,
 * spec 07 §4.4). Fields: title, description, which software (`affectedService`),
 * and "how much is it affecting you" (`affectingLevel`, appended verbatim to
 * the description server-side per spec 02 §5).
 *
 * POSTs the four fields to `/api/incidents` through `apiFetch` — never a bare
 * `fetch` (Global Constraint) — and on success routes to the incident list.
 * The required-field guard here mirrors `reportIncidentGuestBody`; the server
 * is authoritative. No priority is chosen — it is "being assessed" until an
 * internal user categorises it.
 */

export function PortalIncidentForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affectedService, setAffectedService] = useState("");
  const [affectingLevel, setAffectingLevel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const body = {
      title: title.trim(),
      description: description.trim(),
      affectedService: affectedService.trim(),
      affectingLevel: affectingLevel.trim(),
    };
    if (
      !body.title ||
      !body.description ||
      !body.affectedService ||
      !body.affectingLevel
    ) {
      setError("Please fill in every box so we can look into this.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/incidents", { method: "POST", body });
      router.push("/portal/incidents");
    } catch {
      setError("We could not send your report. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="incident-title">
          What went wrong
        </label>
        <input
          id="incident-title"
          className={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="incident-description">
          More detail
        </label>
        <textarea
          id="incident-description"
          className={styles.textarea}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What you were doing, what you expected, what happened instead"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="incident-service">
          Which software is affected
        </label>
        <input
          id="incident-service"
          className={styles.input}
          value={affectedService}
          onChange={(event) => setAffectedService(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="incident-affecting">
          How much is it affecting you
        </label>
        <textarea
          id="incident-affecting"
          className={styles.textarea}
          rows={3}
          value={affectingLevel}
          onChange={(event) => setAffectingLevel(event.target.value)}
          placeholder="For example: we cannot take orders at all"
        />
      </div>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <div>
        <button type="submit" className={styles.send} disabled={submitting}>
          {submitting ? "Sending…" : "Report the problem"}
        </button>
      </div>
    </form>
  );
}
