"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import styles from "./login.module.css";

const MISSING_FIELDS = "Enter your email and password.";
const WRONG_CREDENTIALS = "The email or password is incorrect.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The sign-in form (Task 1). Controlled email / password inputs; on submit it
 * posts `{ email, password }` to `POST /api/auth/login` (which sets the session
 * cookie on 200) and then routes to `next`. A 401 is the wrong-credentials case
 * and is shown inline; the button is disabled for the duration of the request.
 *
 * `next` is already reduced to a same-origin path server-side in `page.tsx`
 * (`sanitize-next.ts`), so it is safe to hand straight to `router.push`.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // `noValidate` is set (consistent styling for the inline error), so catch an
    // empty submit here rather than letting the server answer it with an opaque
    // "something went wrong".
    if (!email.trim() || !password) {
      setError(MISSING_FIELDS);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        // The cookie is set; leave the button disabled through the navigation
        // so a second click cannot fire a second request.
        router.push(next || "/overview");
        return;
      }
      setError(res.status === 401 ? WRONG_CREDENTIALS : GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    }
    setPending(false);
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
