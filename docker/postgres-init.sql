-- runs once on first cluster init (mounted into /docker-entrypoint-initdb.d)
CREATE ROLE keel_app  WITH LOGIN PASSWORD 'keel_app';
CREATE ROLE keel_migrate WITH LOGIN PASSWORD 'keel_migrate';
GRANT ALL PRIVILEGES ON DATABASE keel TO keel_migrate;
-- keel_app gets table grants from the grant migration (Task 7); default: connect + usage
GRANT CONNECT ON DATABASE keel TO keel_app;
-- PG15+ locks down the public schema; keel_migrate owns it so Prisma Migrate can DDL
ALTER SCHEMA public OWNER TO keel_migrate;
GRANT USAGE ON SCHEMA public TO keel_app;
