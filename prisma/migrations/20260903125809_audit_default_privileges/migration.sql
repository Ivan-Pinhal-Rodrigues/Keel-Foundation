-- Record-of-fact tables are append-only at the database privilege level, like
-- AuditEvent (20260901200800_audit_grants). Every new such table must add its
-- own REVOKE in the migration that creates it (see docs/migrations.md); this
-- migration covers the ones that already existed when the convention landed.
--
-- Why this is needed: 20260901200800_audit_grants runs
--   ALTER DEFAULT PRIVILEGES FOR ROLE keel_migrate IN SCHEMA <s>
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keel_app
-- so every table created afterwards is fully mutable by the runtime role.
-- ApprovalDecision (20260901193100_approvals_support) and
-- PostImplementationReview (20260901162656_work_items) inherited full DML.
--
-- Schema-aware via current_schema() (same as audit_grants): production runs
-- ?schema=public; the integration-test harness runs ?schema=test_<hex>.
-- Hardcoding "public" would leave every test schema unrevoked.
--
-- Runs as keel_migrate (directUrl), which owns the schema and its tables.
--
-- Down: GRANT UPDATE, DELETE ON "ApprovalDecision", "PostImplementationReview" TO keel_app;

DO $$
DECLARE s text := current_schema();
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."ApprovalDecision" FROM keel_app', s);
  EXECUTE format('REVOKE UPDATE, DELETE ON %I."PostImplementationReview" FROM keel_app', s);
END $$;
