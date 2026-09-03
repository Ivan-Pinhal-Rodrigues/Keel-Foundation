import { redirect } from "next/navigation";

/**
 * `/` has no screen of its own. Middleware sends an unauthenticated hit to
 * `/login` before this renders; an authenticated internal user is forwarded to
 * `/demands`, and a guest is bounced on from there to `/portal` by the
 * `(internal)` layout guard.
 */
export default function Root(): never {
  redirect("/demands");
}
