import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { LoginForm } from "./LoginForm";
import { sanitizeNext } from "./sanitize-next";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in — Keel",
};

/**
 * `GET /login` — the sign-in screen. Public (middleware's PUBLIC list). A
 * request that already has a live session is bounced to its home surface so the
 * form is never shown to someone who is signed in.
 *
 * `next` is where the form sends the user after a successful login; anything
 * that does not resolve to a same-origin path is dropped for `/demands`
 * (`sanitize-next.ts`), so a crafted `?next=` cannot turn this into an open
 * redirect.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const actor = await getCurrentActor();
  if (actor) {
    // TODO(plan-06): internal home becomes /overview once the dashboard ships.
    redirect(actor.kind === "INTERNAL" ? "/demands" : "/portal");
  }

  const { next: raw } = await searchParams;
  const next = sanitizeNext(raw);

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.glyph} aria-hidden="true">
            <svg viewBox="0 0 30 30">
              <path d="M15 3 L26 9 L15 15 L4 9 Z" fill="currentColor" />
              <path
                d="M4 15 L15 21 L26 15"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                opacity=".6"
              />
              <path
                d="M4 21 L15 27 L26 21"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                opacity=".3"
              />
            </svg>
          </span>
          <b>Keel</b>
        </div>
        <h1 className={styles.heading}>Sign in</h1>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
