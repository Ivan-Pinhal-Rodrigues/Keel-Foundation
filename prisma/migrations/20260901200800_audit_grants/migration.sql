-- Audit-log immutability.
--
-- keel_app (runtime role) gets full DML on every table in the schema this
-- migration runs against, EXCEPT "AuditEvent" which is INSERT/SELECT only —
-- the application can never UPDATE or DELETE an audit record.
--
-- Schema-aware via current_schema(): production runs with ?schema=public; the
-- integration-test harness runs with ?schema=test_<hex>. Hardcoding "public"
-- would leave every test schema ungranted.
--
-- Reversible. Down path (per schema): revoke every grant made above, in
-- reverse — schema USAGE, the ALL TABLES/ALL SEQUENCES grants, and both
-- ALTER DEFAULT PRIVILEGES entries. The final `REVOKE UPDATE, DELETE ON
-- "AuditEvent"` line above narrows a grant already made by the ALL TABLES
-- line two statements earlier, so reversing the ALL TABLES grant reverses it
-- too — no separate re-GRANT step is needed (REVOKE of a privilege keel_app
-- no longer holds is a Postgres no-op, not an error). Pre-migration, keel_app
-- holds none of this (this is the first migration to grant it anything at
-- the table/sequence/default-privilege level; see docker/postgres-init.sql
-- and the CI `migrations` job's role-creation step, neither of which grants
-- beyond schema CONNECT/USAGE, and the CI scratch DB doesn't even run
-- postgres-init.sql), so a full revoke is the correct — not merely
-- convenient — return to pre-migration state:
-- Down: DO $$ DECLARE s text := current_schema(); BEGIN EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM keel_app', s); EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I FROM keel_app', s); EXECUTE format('REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I FROM keel_app', s); EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA %I REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM keel_app', s); EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA %I REVOKE USAGE, SELECT ON SEQUENCES FROM keel_app', s); END $$;
--
-- Runs as keel_migrate (directUrl), which owns the schema and its tables.

DO $$
DECLARE s text := current_schema();
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO keel_app', s);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO keel_app', s);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO keel_app', s);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keel_app', s);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO keel_app', s);
  -- AuditEvent: append-only for keel_app.
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."AuditEvent" FROM keel_app', s);
END $$;
