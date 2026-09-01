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
-- Reversible. Down path (per schema):
--   GRANT UPDATE, DELETE ON <schema>."AuditEvent" TO keel_app;
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
