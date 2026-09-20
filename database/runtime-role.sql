-- Run as migration owner after migrations. Provision login and password with your secret manager.
-- Example: CREATE ROLE gymos_runtime LOGIN PASSWORD '<provided securely>' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE gymos TO gymos_runtime;
GRANT USAGE ON SCHEMA public TO gymos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gymos_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gymos_runtime;
REVOKE UPDATE, DELETE ON audit_logs, invoices FROM gymos_runtime;
REVOKE ALL ON schema_migrations FROM gymos_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO gymos_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO gymos_runtime;
