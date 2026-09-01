"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import styles from "./page.module.css";

const INVALID_LINK = "This invite link is no longer valid.";

/**
 * The invite-redemption form (Task 17). Posts `{ name, password }` to
 * `POST /api/guest-invites/:token/redeem`; on 200 the guest is logged in
 * (cookie set by the route) and we go to the portal. 410 → the link is spent;
 * 400 → validation. `confirm` is checked here only — the server is
 * authoritative on the rest (`specs/07-guest-portal.md` §4.4).
 */
export function RedeemForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch(
        `/api/guest-invites/${encodeURIComponent(token)}/redeem`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, password }),
        },
      );

      if (res.status === 200) {
        // Logged in (the route set the cookie). `/portal` is a Phase 1 route —
        // a 404 landing is expected for now. Stay disabled through the nav.
        router.push("/portal");
        return;
      }
      if (res.status === 410) {
        setError(INVALID_LINK);
      } else if (res.status === 400) {
        setError("Please check your name and password and try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    // Only the non-redirect paths reach here — a successful redeem leaves the
    // button disabled so a stray second click cannot fire a second request.
    setPending(false);
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <label className={styles.field}>
        <span>Your name</span>
        <input
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Confirm password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
