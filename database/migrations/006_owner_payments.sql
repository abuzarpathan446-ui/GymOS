CREATE TABLE owner_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise>0),
 paid_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('CASH','UPI','CARD','BANK_TRANSFER','OTHER')),
 reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 recorded_by uuid NOT NULL REFERENCES users(id),
 idempotency_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,owner_id) REFERENCES users(organization_id,id)
);
CREATE INDEX owner_payments_date ON owner_payments(paid_on DESC,created_at DESC);
CREATE INDEX owner_payments_gym ON owner_payments(organization_id,paid_on DESC);
ALTER TABLE owner_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_payments USING (current_setting('app.platform',true)='true') WITH CHECK (current_setting('app.platform',true)='true');
CREATE TRIGGER immutable_owner_payment BEFORE UPDATE OR DELETE ON owner_payments FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
