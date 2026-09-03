"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./LogoutButton.module.css";

/**
 * Sign-out control, shared by the internal AppShell chrome and the guest
 * portal shell. Posts to `POST /api/auth/logout` (idempotent — clears the
 * cookie and returns 200 on every path) and then routes to `/login`.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // A failed logout request still means the user wants out — send them to
      // /login, where an unauthenticated hit is handled cleanly anyway.
    }
    router.push("/login");
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onClick}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
