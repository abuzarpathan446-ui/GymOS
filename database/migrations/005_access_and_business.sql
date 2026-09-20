ALTER TABLE organizations ADD COLUMN access_overrides jsonb NOT NULL DEFAULT '{"features":{},"limits":{}}';
ALTER TABLE users ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN suspended boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN photo text;
ALTER TABLE memberships ADD COLUMN fee_paise bigint NOT NULL DEFAULT 0 CHECK(fee_paise>=0);
ALTER TABLE memberships ADD COLUMN payment_deadline date;
UPDATE memberships m SET fee_paise=COALESCE((SELECT sum(amount_paise) FROM payments p WHERE p.membership_id=m.id AND p.status='COMPLETED'),0);
CREATE TABLE login_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL, session_hash text NOT NULL UNIQUE,
 logged_in_at timestamptz NOT NULL DEFAULT now(), logged_out_at timestamptz,
 expires_at timestamptz NOT NULL, end_reason text,
 CHECK(logged_out_at IS NULL OR logged_out_at>=logged_in_at),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX login_history_org_date ON login_history(organization_id,logged_in_at DESC);
CREATE TABLE access_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 requested_by uuid NOT NULL, resource text NOT NULL, requested_limit integer CHECK(requested_limit>=0),
 notes text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED','DECLINED')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 FOREIGN KEY(organization_id,requested_by) REFERENCES users(organization_id,id)
);
CREATE TABLE expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 description text NOT NULL, category text NOT NULL, amount_paise bigint NOT NULL CHECK(amount_paise>0),
 spent_on date NOT NULL, recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,recorded_by) REFERENCES users(organization_id,id)
);
CREATE INDEX expenses_org_date ON expenses(organization_id,spent_on);
ALTER TABLE login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON login_history USING (tenant_access(organization_id)) WITH CHECK (tenant_access(organization_id));
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON access_requests USING (tenant_access(organization_id)) WITH CHECK (tenant_access(organization_id));
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON expenses USING (tenant_access(organization_id)) WITH CHECK (tenant_access(organization_id));
