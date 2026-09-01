-- runs once on first cluster init (mounted into /docker-entrypoint-initdb.d)
CREATE ROLE keel_app  WITH LOGIN PASSWORD 'keel_app';
CREATE ROLE keel_migrate WITH LOGIN PASSWORD 'keel_migrate';
GRANT ALL PRIVILEGES ON DATABASE keel TO keel_migrate;
-- keel_app gets table grants from the grant migration (Task 7); default: connect + usage
GRANT CONNECT ON DATABASE keel TO keel_app;
