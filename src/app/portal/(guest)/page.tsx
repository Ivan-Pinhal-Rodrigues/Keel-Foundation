import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal — Keel",
};

/**
 * `/portal` — the guest landing. A placeholder for now: it exists so the
 * post-redemption redirect (`POST /api/guest-invites/:token/redeem` →
 * `/portal`) lands on a real page inside the guarded shell rather than a 404.
 * plan-04 builds the real "My requests" / "My incidents" / "Submit" portal.
 */
export default function PortalHome() {
  return (
    <>
      <h1>Welcome to Keel</h1>
      <p>
        Your requests and incidents will appear here. This area is still being
        built.
      </p>
    </>
  );
}
