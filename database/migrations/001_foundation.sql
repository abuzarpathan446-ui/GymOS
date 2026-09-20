CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
 email text NOT NULL, phone text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 currency text NOT NULL DEFAULT 'INR', timezone text NOT NULL DEFAULT 'Asia/Kolkata',
 settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, address text NOT NULL DEFAULT '', UNIQUE(organization_id,id)
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 branch_id uuid, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text, role text NOT NULL CHECK(role IN ('SUPER_ADMIN','OWNER','MANAGER','RECEPTIONIST','TRAINER','MEMBER')),
 active boolean NOT NULL DEFAULT true, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((role='SUPER_ADMIN' AND organization_id IS NULL) OR (role<>'SUPER_ADMIN' AND organization_id IS NOT NULL)),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id), UNIQUE(organization_id,id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE access_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), purpose text NOT NULL CHECK(purpose IN ('RESET','INVITE','VERIFY')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE subscription_plans (
 id text PRIMARY KEY, name text NOT NULL, price_paise integer NOT NULL CHECK(price_paise>=0),
 member_limit integer NOT NULL CHECK(member_limit>0), staff_limit integer NOT NULL CHECK(staff_limit>0), features jsonb NOT NULL
);
INSERT INTO subscription_plans VALUES
 ('BASIC','Basic',59900,100,1,'["members","memberships","payments","attendance","reports","backup","whatsapp_chat"]'),
 ('PRO','Pro',129900,500,10,'["members","memberships","payments","attendance","reports","backup","whatsapp_chat","automated_whatsapp","trainers","workouts","progress","leads","appointments","inventory","staff"]'),
 ('BUSINESS','Business',249900,2000,30,'["members","memberships","payments","attendance","reports","backup","whatsapp_chat","automated_whatsapp","trainers","workouts","progress","leads","appointments","inventory","staff","analytics","ai","member_portal","branding","api"]'),
 ('ENTERPRISE','Enterprise',0,100000,1000,'["members","memberships","payments","attendance","reports","backup","whatsapp_chat","automated_whatsapp","trainers","workouts","progress","leads","appointments","inventory","staff","analytics","ai","member_portal","branding","api","branches"]');
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
 plan_id text NOT NULL REFERENCES subscription_plans(id),
 status text NOT NULL CHECK(status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
 starts_at timestamptz NOT NULL DEFAULT now(), renews_at timestamptz NOT NULL, grace_until timestamptz,
 cancelled_at timestamptz, provider_reference text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 actor_id uuid REFERENCES users(id), action text NOT NULL, resource_id text, metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_time ON audit_logs(organization_id,created_at DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit records are immutable'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), kind text NOT NULL,
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox(status,available_at);
