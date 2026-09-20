-- Runtime role must not own tables, be superuser, or have BYPASSRLS.
-- Transaction-local context is set only from the authenticated server session.
CREATE FUNCTION tenant_access(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT current_setting('app.platform',true)='true' OR org::text=current_setting('app.organization_id',true)
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['branches','members','membership_plans','memberships','payments','invoices','attendance','leads','trainers','trainer_assignments','workouts','body_measurements','appointments','inventory','inventory_transactions','notifications','automation_rules','message_logs','subscriptions','audit_logs','backups'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_policy ON %I USING (tenant_access(organization_id)) WITH CHECK (tenant_access(organization_id))',t);
 END LOOP;
END $$;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_policy ON organizations USING(tenant_access(id)) WITH CHECK(tenant_access(id));
-- Auth tables are never exposed by generic APIs: access through explicit authentication queries.
-- Enforce same-tenant member portal links, in addition to application validation.
ALTER TABLE members ADD CONSTRAINT member_user_tenant FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id);
