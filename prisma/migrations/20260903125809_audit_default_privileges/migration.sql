-- Record-of-fact tables are append-only at the database privilege level, like
-- AuditEvent (20260901200800_audit_grants). Every new such table must add its
-- own REVOKE in the migration that creates it (see docs/migrations.md); this
-- migration covers the ones that already existed when the convention landed.
--
-- Why this is needed: 20260901200800_audit_grants runs
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <s> TO keel_app
-- and sets the same as the default privilege (ALTER DEFAULT PRIVILEGES) for
-- tables created after it. ApprovalDecision (20260901193100_approvals_support)
-- and PostImplementationReview (20260901162656_work_items) both predate
-- audit_grants, so they were granted full DML by its ON ALL TABLES line.
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
