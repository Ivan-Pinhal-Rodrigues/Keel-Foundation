-- A GUEST user is always scoped to a client. INTERNAL users have no client.
-- The runtime relies on this: policy/scope.ts and policy/subjects/helpers.ts
-- fail closed on a null clientId, but a NULL here would still be a data bug.
-- Down: ALTER TABLE "User" DROP CONSTRAINT "user_guest_has_client";
ALTER TABLE "User"
  ADD CONSTRAINT "user_guest_has_client"
  CHECK ("kind" <> 'GUEST' OR "clientId" IS NOT NULL);
