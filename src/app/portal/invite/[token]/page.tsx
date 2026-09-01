import type { Metadata } from "next";
import { clientForInviteToken } from "@/server/auth/invites";
import { RedeemForm } from "./RedeemForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Accept your invitation — Keel",
};

/**
 * `GET /portal/invite/:token` — the invite-redemption screen
 * (`specs/07-guest-portal.md` §4.1). Public: no session, and it is in
 * middleware's `PUBLIC` list.
 *
 * A server component. It resolves the token to the inviting client's name
 * (read-only — redeeming happens in the form's POST), and renders a plain
 * "no longer valid" page for an unknown / expired / already-redeemed token.
 * Styling is intentionally minimal until the design system (Task 28).
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await clientForInviteToken(token);

  if (!invite) {
    return (
      <main className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.heading}>
            This invite link is no longer valid
          </h1>
          <p className={styles.muted}>
            Ask your Keel contact to send a fresh invitation.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.heading}>
          You&rsquo;ve been invited to Keel by {invite.clientName}
        </h1>
        <p className={styles.muted}>
          Set your name and a password to create your account.
        </p>
        <RedeemForm token={token} />
      </div>
    </main>
  );
}
