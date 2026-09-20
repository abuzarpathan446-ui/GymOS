import type { FastifyInstance } from "fastify";
import {normalizeGymSlug,validateGymSlug,gymSlugMessage} from '../../shared/gym-slug.js';
import { z } from "zod";
import type { Services } from "./app.js";
import { audit, one } from "./db.js";
import { fail, rolePermissions, passwordSchema, hashPassword } from "./security.js";
import { entitlement, accessPolicy } from "./entitlements.js";
import { createAccountSetup, deliverySchema } from "./account-setup.js";
import { endSessions } from "./access-management.js";
import {ownerPaymentSchema,recordOwnerPayment} from './owner-payments.js';
async function setInitialOwnerPassword(tx: import('./db.js').Executor,user:{id:string;email:string},password:string){
  await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1 AND role=\'OWNER\'',[user.id,await hashPassword(password)]);
  return {status:'PASSWORD_SET',email:user.email,login_path:'/owner/login',message:'Owner account created. The owner can sign in using the password you assigned. Share it privately.'};
}
export async function registerPlatform(
  app: FastifyInstance,
  { run }: Services,
) {
  app.post("/api/admin/backups", (req) =>
    run(req, "platform", async (tx, a) => {
      if (!process.env.BACKUP_ENCRYPTION_KEY)
        fail(
          503,
          "Configure a backup encryption key before starting a backup.",
        );
      const job = await one(
        tx,
        "INSERT INTO outbox(kind,payload) VALUES('BACKUP','{}') RETURNING id",
      );
      await audit(tx, null, a.id, "backup.requested", job.id);
      return { status: "QUEUED", job_id: job.id };
    }),
  );
  app.get("/api/subscription", (req) =>
    run(req, "subscription", async (tx, a) => {
      const policy = await accessPolicy(tx, a.organization_id!);
      return {
        subscription: {
          ...(await one(
            tx,
            "SELECT s.*,p.name,p.features,p.price_paise,p.member_limit,p.staff_limit FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE organization_id=$1",
            [a.organization_id],
          )),
          member_limit: policy.limits.member,
          staff_limit: policy.limits.staff,
          features: policy.features,
        },
        plans: (
          await tx.query(
            "SELECT * FROM subscription_plans ORDER BY price_paise",
          )
        ).rows,
        usage: await one(
          tx,
          "SELECT (SELECT count(*)::int FROM members WHERE organization_id=$1 AND active) AS members,(SELECT count(*)::int FROM users WHERE organization_id=$1 AND active AND role NOT IN ('OWNER','MEMBER')) AS staff",
          [a.organization_id],
        ),
      };
    }),
  );
  app.post("/api/subscription/cancel", (req) =>
    run(req, "platform", async (tx, a) => {
      fail(
        403,
        "Subscription changes must be made through the Super Admin gym controls.",
      );
    }),
  );
  app.get("/api/admin/dashboard", (req) =>
    run(req, "platform", async (tx) => ({
      metrics: await one(
        tx,
        `SELECT
  (SELECT count(*)::int FROM organizations) AS total_gyms,
  (SELECT count(*)::int FROM organizations WHERE status='ACTIVE') AS active_gyms,
  (SELECT count(*)::int FROM subscriptions WHERE status='TRIAL') AS trial_gyms,
  (SELECT count(*)::int FROM subscriptions WHERE renews_at<now()) AS expired_subscriptions,
  (SELECT COALESCE(sum(p.price_paise),0)::bigint FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.status='ACTIVE' AND s.renews_at>now()) AS mrr,
  (SELECT count(*)::int FROM users) AS total_users,
  (SELECT count(*)::int FROM members) AS total_members,
  (SELECT count(*)::int FROM message_logs WHERE status IN ('SENT','DELIVERED')) AS messages_sent`,
      ),
      activity: (
        await tx.query(
          "SELECT action,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 15",
        )
      ).rows,
    })),
  );
  app.get("/api/admin/gyms", (req) =>
    run(req, "platform", async (tx) => ({
      items: (
        await tx.query(
          `SELECT o.*,s.plan_id,s.status AS subscription_status,s.renews_at,(SELECT count(*)::int FROM members m WHERE m.organization_id=o.id) AS member_count FROM organizations o LEFT JOIN subscriptions s ON s.organization_id=o.id ORDER BY o.created_at DESC LIMIT 100`,
        )
      ).rows,
    })),
  );
  app.post("/api/admin/gyms", (req) =>
    run(req, "platform", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(150),
          slug: z.string().transform(normalizeGymSlug).refine(value=>!validateGymSlug(value),gymSlugMessage),
          email: z.email().transform((v) => v.toLowerCase()),
          owner_name: z.string().min(2).max(150),
          initial_payment:ownerPaymentSchema.optional(),
          password: z.preprocess(v=>v===''?undefined:v,passwordSchema.optional()),
          phone: z.string().max(30).default(""),
          plan_id: z.string().max(30).default("BUSINESS"),
          delivery: deliverySchema,
        })
        .strict()
        .parse(req.body);
      if (
        !(await one(tx, "SELECT id FROM subscription_plans WHERE id=$1", [
          p.plan_id,
        ]))
      )
        fail(400, "Invalid subscription plan.");
      const org = await one(
        tx,
        "INSERT INTO organizations(name,slug,email,phone) VALUES($1,$2,$3,$4) RETURNING *",
        [p.name, p.slug, p.email, p.phone],
      );
      const branch = await one(
        tx,
        "INSERT INTO branches(organization_id,name) VALUES($1,'Main branch') RETURNING id",
        [org.id],
      );
      const user = await one(
        tx,
        "INSERT INTO users(organization_id,branch_id,email,name,role) VALUES($1,$2,$3,$4,'OWNER') RETURNING id,email,organization_id,role",
        [org.id, branch.id, p.email, p.owner_name],
      );
      await tx.query(
        "INSERT INTO subscriptions(organization_id,plan_id,status,renews_at) VALUES($1,$2,'TRIAL',now()+interval '14 days')",
        [org.id, p.plan_id],
      );
      const setup = p.password ? await setInitialOwnerPassword(tx,user,p.password) : await createAccountSetup(tx, user, p.delivery);
      await audit(tx, org.id, a.id, "gym.created", org.id);
      if(p.initial_payment)await recordOwnerPayment(tx,user.id,a.id,p.initial_payment);
      return { organization: org, ...setup };
    }),
  );
  app.patch("/api/admin/gyms/:id", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const p = z
        .object({ status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]) })
        .strict()
        .parse(req.body);
      const org = await one(
        tx,
        "UPDATE organizations SET status=$1 WHERE id=$2 RETURNING id",
        [p.status, id],
      );
      if (!org) fail(404, "Gym not found.");
      if (p.status !== "ACTIVE")
        await tx.query(
          "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE organization_id=$1)",
          [id],
        );
      await audit(tx, id, a.id, `gym.${p.status.toLowerCase()}`, id);
      return { ok: true };
    }),
  );
  app.post("/api/admin/gyms/:id/owners", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const p = z
        .object({
          name: z.string().trim().min(2).max(150),
          initial_payment:ownerPaymentSchema.optional(),
          password: z.preprocess(v=>v===''?undefined:v,passwordSchema.optional()),
          email: z.email().transform((v) => v.toLowerCase()),
          delivery: deliverySchema,
        })
        .strict()
        .parse(req.body);
      const org = await one(
        tx,
        "SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [id],
      );
      if (!org) fail(404, "Active gym not found.");
      const branch = await one(
        tx,
        "SELECT id FROM branches WHERE organization_id=$1 ORDER BY name LIMIT 1",
        [id],
      );
      if (!branch) fail(409, "Create a gym branch first.");
      const user = await one(
        tx,
        "INSERT INTO users(organization_id,branch_id,email,name,role) VALUES($1,$2,$3,$4,'OWNER') RETURNING id,email,organization_id,role",
        [id, branch.id, p.email, p.name],
      );
      const setup = p.password ? await setInitialOwnerPassword(tx,user,p.password) : await createAccountSetup(tx, user, p.delivery);
      await audit(tx, id, a.id, "owner.created", user.id, {
        delivery: p.delivery,
      });
      if(p.initial_payment)await recordOwnerPayment(tx,user.id,a.id,p.initial_payment);
      return setup;
    }),
  );
  app.put("/api/admin/gyms/:id/subscription", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const p = z
        .object({
          plan_id: z.string().max(30),
          status: z.enum([
            "TRIAL",
            "ACTIVE",
            "PAST_DUE",
            "SUSPENDED",
            "CANCELLED",
          ]),
          renews_at: z.iso.datetime(),
          grace_until: z.iso.datetime().nullable().default(null),
        })
        .strict()
        .parse(req.body);
      const plan = await one(
        tx,
        "SELECT * FROM subscription_plans WHERE id=$1",
        [p.plan_id],
      );
      if (!plan) fail(400, "Invalid plan.");
      const s = await one(
        tx,
        "UPDATE subscriptions SET plan_id=$1,status=$2,renews_at=$3,grace_until=$4 WHERE organization_id=$5 RETURNING id",
        [p.plan_id, p.status, p.renews_at, p.grace_until, id],
      );
      if (!s) fail(404, "Subscription not found.");
      await audit(tx, id, a.id, "subscription.changed", s.id, p);
      return { ok: true };
    }),
  );
  app.get("/api/admin/plans", (req) =>
    run(req, "platform", async (tx) => ({
      items: (
        await tx.query("SELECT * FROM subscription_plans ORDER BY price_paise")
      ).rows,
    })),
  );
  app.patch("/api/admin/plans/:id", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = z.object({ id: z.string().max(30) }).parse(req.params);
      const p = z
        .object({
          price_paise: z.number().int().min(0),
          member_limit: z.number().int().min(1),
          staff_limit: z.number().int().min(1),
          features: z.array(z.string().regex(/^[a-z_]+$/)).max(40),
        })
        .strict()
        .parse(req.body);
      const row = await one(
        tx,
        "UPDATE subscription_plans SET price_paise=$1,member_limit=$2,staff_limit=$3,features=$4 WHERE id=$5 RETURNING id",
        [
          p.price_paise,
          p.member_limit,
          p.staff_limit,
          JSON.stringify(p.features),
          id,
        ],
      );
      if (!row) fail(404, "Plan not found.");
      await audit(tx, null, a.id, "platform_plan.updated", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/admin/users", (req) =>
    run(req, "platform", async (tx) => ({
      items: (
        await tx.query(
          "SELECT id,name,email,role,active,organization_id,created_at,(password_hash IS NULL) AS setup_pending FROM users ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    })),
  );
  app.get("/api/admin/audit-logs", (req) =>
    run(req, "platform", async (tx) => ({
      items: (
        await tx.query(
          "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    })),
  );
  app.get("/api/admin/system-health", (req) =>
    run(req, "platform", async (tx) => ({
      database: "ok",
      email: process.env.SMTP_HOST ? "configured" : "not configured",
      whatsapp: process.env.WHATSAPP_TOKEN ? "configured" : "not configured",
      jobs: (
        await tx.query(
          "SELECT status,count(*)::int AS count FROM outbox GROUP BY status",
        )
      ).rows,
      backups: (
        await tx.query(
          "SELECT status,created_at,completed_at,error FROM backups ORDER BY created_at DESC LIMIT 5",
        )
      ).rows,
    })),
  );
  app.get("/api/staff", (req) =>
    run(req, "staff", async (tx, a) => ({
      items: (
        await tx.query(
          "SELECT id,name,email,role,active,permission_overrides,created_at,(password_hash IS NULL) AS setup_pending FROM users WHERE organization_id=$1 AND role<>'MEMBER' ORDER BY name",
          [a.organization_id],
        )
      ).rows.map((u) => ({
        ...u,
        allowed_permissions: rolePermissions(u.role),
      })),
    })),
  );
  app.post("/api/staff", (req) =>
    run(req, "staff", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(150),
          email: z.email().transform((v) => v.toLowerCase()),
          role: z.enum(["MANAGER", "RECEPTIONIST", "TRAINER"]),
          delivery: deliverySchema,
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "staff", "staff");
      await entitlement(tx, a.organization_id!, "staff", p.role);
      if (p.role === "TRAINER")
        await entitlement(tx, a.organization_id!, "trainers");
      const u = await one(
        tx,
        "INSERT INTO users(organization_id,branch_id,name,email,role) VALUES($1,$2,$3,$4,$5) RETURNING id,email,organization_id,role",
        [a.organization_id, a.branch_id, p.name, p.email, p.role],
      );
      if (p.role === "TRAINER")
        await tx.query(
          "INSERT INTO trainers(organization_id,user_id) VALUES($1,$2)",
          [a.organization_id, u.id],
        );
      const setup = await createAccountSetup(tx, u, p.delivery);
      await audit(tx, a.organization_id, a.id, "user.created", u.id, {
        role: p.role,
        delivery: p.delivery,
      });
      return setup;
    }),
  );
  app.patch("/api/staff/:id", (req) =>
    run(req, "staff", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = z.object({ active: z.boolean() }).strict().parse(req.body);
      const current = await one(
        tx,
        "SELECT role,active FROM users WHERE id=$1 AND organization_id=$2 AND role IN ('TRAINER','RECEPTIONIST','MANAGER')",
        [id, a.organization_id],
      );
      if (!current) fail(404, "Staff account not found.");
      if (p.active && !current.active) {
        await entitlement(tx, a.organization_id!, "staff", "staff");
        await entitlement(tx, a.organization_id!, "staff", current.role);
        if (current.role === "TRAINER")
          await entitlement(tx, a.organization_id!, "trainers");
      }
      const u = await one(
        tx,
        "UPDATE users SET active=$1 WHERE id=$2 AND organization_id=$3 AND role IN ('TRAINER','RECEPTIONIST','MANAGER') RETURNING id",
        [p.active, id, a.organization_id],
      );
      if (!u) fail(404, "Staff account not found.");
      await endSessions(tx, id, "ACCOUNT_STATUS_CHANGED");
      await tx.query(
        "UPDATE trainers SET active=$1 WHERE user_id=$2 AND organization_id=$3",
        [p.active, id, a.organization_id],
      );
      await audit(tx, a.organization_id, a.id, "user.status_changed", id, p);
      return { ok: true };
    }),
  );
}
