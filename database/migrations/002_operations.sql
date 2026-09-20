CREATE TABLE members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), branch_id uuid NOT NULL,
 number bigint GENERATED ALWAYS AS IDENTITY, name text NOT NULL, phone text NOT NULL, email text,
 dob date, gender text, address text NOT NULL DEFAULT '', emergency_contact text NOT NULL DEFAULT '', source text NOT NULL DEFAULT 'Walk-in', notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, qr_token text NOT NULL UNIQUE, user_id uuid UNIQUE REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id)
);
CREATE INDEX members_search ON members(organization_id,lower(name));
CREATE INDEX members_phone ON members(organization_id,phone);
CREATE TABLE membership_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, duration_days integer NOT NULL CHECK(duration_days BETWEEN 1 AND 3660),
 price_paise integer NOT NULL CHECK(price_paise>=0), tax_bps integer NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000),
 freeze_days integer NOT NULL DEFAULT 0 CHECK(freeze_days>=0), benefits text NOT NULL DEFAULT '', trial boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 UNIQUE(organization_id,id)
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL, plan_id uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','FROZEN','CANCELLED','TRIAL')),
 frozen_at date, freeze_used integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on>=starts_on), UNIQUE(organization_id,id), UNIQUE(organization_id,id,member_id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id), FOREIGN KEY(organization_id,plan_id) REFERENCES membership_plans(organization_id,id)
);
CREATE INDEX memberships_expiry ON memberships(organization_id,ends_on);
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL, membership_id uuid NOT NULL,
 amount_paise integer NOT NULL CHECK(amount_paise>=0), subtotal_paise integer NOT NULL CHECK(subtotal_paise>=0), discount_paise integer NOT NULL CHECK(discount_paise>=0), tax_paise integer NOT NULL CHECK(tax_paise>=0),
 method text NOT NULL CHECK(method IN ('CASH','UPI','CARD','BANK','OTHER')), transaction_id text, notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED','REFUNDED')),
 received_by uuid NOT NULL REFERENCES users(id), idempotency_key uuid NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(discount_paise<=subtotal_paise), CHECK(amount_paise=subtotal_paise-discount_paise+tax_paise),
 UNIQUE(organization_id,id), UNIQUE(organization_id,idempotency_key),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,membership_id,member_id) REFERENCES memberships(organization_id,id,member_id)
);
CREATE INDEX payments_date ON payments(organization_id,created_at DESC);
CREATE UNIQUE INDEX payments_transaction ON payments(organization_id,method,transaction_id) WHERE transaction_id IS NOT NULL;
CREATE TABLE invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), payment_id uuid NOT NULL,
 number bigint GENERATED ALWAYS AS IDENTITY, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,payment_id), FOREIGN KEY(organization_id,payment_id) REFERENCES payments(organization_id,id)
);
CREATE TRIGGER immutable_invoice BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL,
 checked_in_at timestamptz NOT NULL DEFAULT now(), checked_out_at timestamptz, recorded_by uuid NOT NULL REFERENCES users(id),
 CHECK(checked_out_at IS NULL OR checked_out_at>=checked_in_at), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE UNIQUE INDEX attendance_open ON attendance(organization_id,member_id) WHERE checked_out_at IS NULL;
CREATE INDEX attendance_time ON attendance(organization_id,checked_in_at DESC);
CREATE TABLE leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, phone text NOT NULL,
 source text NOT NULL DEFAULT 'Walk-in', status text NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','VISITED','TRIAL','CONVERTED')),
 follow_up_on date, notes text NOT NULL DEFAULT '', member_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE trainers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL,
 specialization text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 UNIQUE(organization_id,id), UNIQUE(organization_id,user_id), FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE TABLE trainer_assignments (
 organization_id uuid NOT NULL REFERENCES organizations(id), trainer_id uuid NOT NULL, member_id uuid NOT NULL,
 PRIMARY KEY(organization_id,trainer_id,member_id), FOREIGN KEY(organization_id,trainer_id) REFERENCES trainers(organization_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE workouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL,
 name text NOT NULL, exercises jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE body_measurements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL,
 weight_kg numeric(6,2) CHECK(weight_kg>0), height_cm numeric(6,2) CHECK(height_cm>0), body_fat numeric(5,2) CHECK(body_fat BETWEEN 0 AND 100),
 measurements jsonb NOT NULL DEFAULT '{}', measured_on date NOT NULL DEFAULT CURRENT_DATE, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), trainer_id uuid NOT NULL, member_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','COMPLETED','CANCELLED')), notes text NOT NULL DEFAULT '',
 CHECK(ends_at>starts_at), FOREIGN KEY(organization_id,trainer_id) REFERENCES trainers(organization_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE INDEX appointments_trainer ON appointments(organization_id,trainer_id,starts_at,ends_at);
CREATE TABLE inventory (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, sku text NOT NULL,
 category text NOT NULL DEFAULT '', quantity integer NOT NULL DEFAULT 0 CHECK(quantity>=0), minimum_stock integer NOT NULL DEFAULT 0 CHECK(minimum_stock>=0),
 purchase_paise integer NOT NULL DEFAULT 0 CHECK(purchase_paise>=0), selling_paise integer NOT NULL DEFAULT 0 CHECK(selling_paise>=0), supplier text NOT NULL DEFAULT '',
 UNIQUE(organization_id,id), UNIQUE(organization_id,sku)
);
CREATE TABLE inventory_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), inventory_id uuid NOT NULL,
 delta integer NOT NULL CHECK(delta<>0), reason text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,inventory_id) REFERENCES inventory(organization_id,id)
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), title text NOT NULL, body text NOT NULL,
 event_key text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,event_key)
);
CREATE TABLE automation_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), event text NOT NULL,
 action text NOT NULL CHECK(action IN ('NOTIFICATION','WHATSAPP')), enabled boolean NOT NULL DEFAULT true, configuration jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE message_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL,
 template text NOT NULL, status text NOT NULL CHECK(status IN ('QUEUED','SENT','DELIVERED','FAILED')), provider_id text, error text,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE backups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
 filename text, error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
