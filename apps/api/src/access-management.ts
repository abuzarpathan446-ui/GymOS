import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "./app.js";
import { audit, one, type Executor } from "./db.js";
import { fail, rolePermissions, passwordSchema, hashPassword } from "./security.js";
import { accessPolicy } from "./entitlements.js";
import {
  featureNames,
  limitNames,
  ownerPermissionNames,
  staffPermissionNames,
} from "../../shared/policy.js";
import { financialSummary } from "./finances.js";
const idInput = z.object({ id: z.uuid() });
const overrides = z
  .object({
    features: z.partialRecord(z.enum(featureNames), z.boolean()),
    limits: z.partialRecord(
      z.enum(limitNames),
      z.number().int().min(0).max(1000000),
    ),
  })
  .strict();
export async function usage(tx: Executor, org: string) {
  return await one(
    tx,
    `SELECT (SELECT count(*)::int FROM members WHERE organization_id=$1 AND active) AS member,
 (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active AND role IN ('TRAINER','RECEPTIONIST','MANAGER')) AS staff,
 (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active AND role='TRAINER') AS "TRAINER",
 (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active AND role='RECEPTIONIST') AS "RECEPTIONIST",
 (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active AND role='MANAGER') AS "MANAGER"`,
    [org],
  );
}
export async function endSessions(tx: Executor, user: string, reason: string) {
  await tx.query(
    "UPDATE login_history SET logged_out_at=LEAST(now(),expires_at),end_reason=$2 WHERE user_id=$1 AND logged_out_at IS NULL",
    [user, reason],
  );
  await tx.query("DELETE FROM sessions WHERE user_id=$1", [user]);
}
export async function registerAccessManagement(
  app: FastifyInstance,
  { run }: Services,
) {
  app.put("/api/staff/:id/access", (req) =>
    run(req, "staff", async (tx, a) => {
      const { id } = idInput.parse(req.params),
        p = z
          .object({
            name: z.string().trim().min(2).max(150),
            email: z.email().transform((v) => v.toLowerCase()),
            permissions: z.partialRecord(
              z.enum(staffPermissionNames),
              z.boolean(),
            ),
            all_members: z.boolean().default(false),
          })
          .strict()
          .parse(req.body);
      const user = await one(
        tx,
        "SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND role IN ('TRAINER','RECEPTIONIST','MANAGER') FOR UPDATE",
        [id, a.organization_id],
      );
      if (!user) fail(404, "Staff account not found.");
      if (
        Object.entries(p.permissions).some(
          ([key, value]) => value && !rolePermissions(user.role).includes(key),
        )
      )
        fail(400, "A staff account cannot exceed its role permissions.");
      await tx.query(
        "UPDATE users SET name=$3,email=$4,permission_overrides=$5 WHERE id=$1 AND organization_id=$2",
        [
          id,
          a.organization_id,
          p.name,
          p.email,
          JSON.stringify({
            ...p.permissions,
            ...(user.role === "TRAINER"
              ? { "trainer:all": p.all_members }
              : {}),
          }),
        ],
      );
      await audit(tx, a.organization_id, a.id, "staff.access_changed", id, {
        permissions: p.permissions,
        all_members: p.all_members,
      });
      return { ok: true };
    }),
  );
  app.get("/api/access", (req) =>
    run(req, "subscription", async (tx, a) => ({
      policy: await accessPolicy(tx, a.organization_id!),
      usage: await usage(tx, a.organization_id!),
      requests: (
        await tx.query(
          "SELECT * FROM access_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50",
          [a.organization_id],
        )
      ).rows,
    })),
  );
  app.post("/api/access/requests", (req) =>
    run(req, "subscription", async (tx, a) => {
      const p = z
        .object({
          resource: z.enum([...limitNames, ...featureNames]),
          requested_limit: z
            .number()
            .int()
            .min(0)
            .max(1000000)
            .nullable()
            .default(null),
          notes: z.string().trim().min(3).max(1000),
        })
        .strict()
        .parse(req.body);
      const row = await one(
        tx,
        "INSERT INTO access_requests(organization_id,requested_by,resource,requested_limit,notes) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [a.organization_id, a.id, p.resource, p.requested_limit, p.notes],
      );
      await audit(tx, a.organization_id, a.id, "access.requested", row.id, p);
      return { ok: true };
    }),
  );
  app.get("/api/admin/access-requests", (req) =>
    run(req, "platform", async (tx) => ({
      items: (
        await tx.query(
          "SELECT r.*,o.name AS gym FROM access_requests r JOIN organizations o ON o.id=r.organization_id ORDER BY r.created_at DESC LIMIT 100",
        )
      ).rows,
    })),
  );
  app.patch("/api/admin/access-requests/:id", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = idInput.parse(req.params),
        p = z
          .object({ status: z.enum(["RESOLVED", "DECLINED"]) })
          .strict()
          .parse(req.body);
      const r = await one(
        tx,
        "UPDATE access_requests SET status=$2,resolved_at=now() WHERE id=$1 RETURNING organization_id",
        [id, p.status],
      );
      if (!r) fail(404, "Request not found.");
      await audit(tx, r.organization_id, a.id, "access.request_closed", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/admin/gyms/:id/details", (req) =>
    run(req, "platform", async (tx) => {
      const { id } = idInput.parse(req.params);
      const gym = await one(tx, "SELECT * FROM organizations WHERE id=$1", [
        id,
      ]);
      if (!gym) fail(404, "Gym not found.");
      const { section, page } = z
        .object({
          section: z
            .enum([
              "overview",
              "users",
              "members",
              "payments",
              "activity",
              "logins",
            ])
            .default("overview"),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .strict()
        .parse(req.query);
      const queries = {
        users:
          "SELECT id,name,email,role,active,suspended,permission_overrides,created_at FROM users WHERE organization_id=$1 ORDER BY created_at DESC",
        members:
          "SELECT id,name,number,phone,active FROM members WHERE organization_id=$1 ORDER BY created_at DESC",
        payments:
          "SELECT p.id,m.name,p.amount_paise,p.method,p.status,p.created_at FROM payments p JOIN members m ON m.id=p.member_id WHERE p.organization_id=$1 ORDER BY p.created_at DESC",
        activity:
          "SELECT action,actor_id,resource_id,metadata,created_at FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC",
        logins:
          "SELECT h.id,u.name,h.role,h.logged_in_at,h.logged_out_at,h.expires_at,h.end_reason FROM login_history h JOIN users u ON u.id=h.user_id WHERE h.organization_id=$1 ORDER BY h.logged_in_at DESC",
      };
      return {
        gym,
        financial:
          section === "overview" ? await financialSummary(tx, id) : undefined,
        policy: await accessPolicy(tx, id),
        usage: await usage(tx, id),
        subscription: await one(
          tx,
          "SELECT * FROM subscriptions WHERE organization_id=$1",
          [id],
        ),
        items:
          section === "overview"
            ? []
            : (
                await tx.query(queries[section] + " LIMIT 26 OFFSET $2", [
                  id,
                  (page - 1) * 25,
                ])
              ).rows,
        page,
      };
    }),
  );
  app.put("/api/admin/gyms/:id/access", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = idInput.parse(req.params),
        p = overrides.parse(req.body);
      // All quota mutations serialize on the same subscription row as member/staff creation.
      await tx.query(
        "SELECT id FROM subscriptions WHERE organization_id=$1 FOR UPDATE",
        [id],
      );
      const row = await one(
        tx,
        "UPDATE organizations SET access_overrides=$2 WHERE id=$1 RETURNING id",
        [id, JSON.stringify(p)],
      );
      if (!row) fail(404, "Gym not found.");
      await audit(tx, id, a.id, "access.changed", id, p);
      return { ok: true, policy: await accessPolicy(tx, id) };
    }),
  );
  app.patch("/api/admin/owners/:id", (req) =>
    run(req, "platform", async (tx, a) => {
      const { id } = idInput.parse(req.params),
        p = z
          .object({
            name: z.string().trim().min(2).max(150),
            email: z.email().transform((v) => v.toLowerCase()),
            status: z.enum(["ACTIVE", "DEACTIVATED", "SUSPENDED"]),
            permissions: z.partialRecord(
              z.enum(ownerPermissionNames),
              z.boolean(),
            ),
          })
          .strict()
          .parse(req.body);
      const row = await one(
        tx,
        "UPDATE users SET name=$2,email=$3,active=$4,suspended=$5,permission_overrides=$6 WHERE id=$1 AND role='OWNER' RETURNING organization_id",
        [
          id,
          p.name,
          p.email,
          p.status !== "DEACTIVATED",
          p.status === "SUSPENDED",
          JSON.stringify(p.permissions),
        ],
      );
      if (!row) fail(404, "Owner not found.");
      if (p.status !== "ACTIVE") {
        await endSessions(tx, id, p.status);
        await tx.query('UPDATE access_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[id]);
      }
      await audit(tx, row.organization_id, a.id, "owner.updated", id, { ...p });
      return { ok: true };
    }),
  );
  app.put('/api/admin/owners/:id/password', req=>run(req,'platform',async(tx,a)=>{
    const {id}=idInput.parse(req.params);
    const p=z.object({password:passwordSchema}).strict().parse(req.body);
    const owner=await one(tx,"SELECT id,organization_id FROM users WHERE id=$1 AND role='OWNER' FOR UPDATE",[id]);
    if(!owner)fail(404,'Owner not found.');
    await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1',[id,await hashPassword(p.password)]);
    await tx.query('UPDATE access_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[id]);
    await endSessions(tx,id,'ADMIN_PASSWORD_RESET');
    await audit(tx,owner.organization_id,a.id,'owner.password_changed',id);
    return {ok:true,message:'Owner password updated. Existing sessions and setup links have been revoked.'};
  }));
  app.get("/api/staff/activity", (req) =>
    run(req, "staff", async (tx, a) => {
      const p = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .parse(req.query);
      return {
        items: (
          await tx.query(
            `SELECT h.id,u.name,h.role,h.logged_in_at,h.logged_out_at,h.expires_at,h.end_reason,
   EXTRACT(EPOCH FROM (COALESCE(h.logged_out_at,LEAST(now(),h.expires_at))-h.logged_in_at))::int AS seconds,
   (h.logged_out_at IS NULL AND h.expires_at>now() AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=h.session_hash)) AS online
   FROM login_history h JOIN users u ON u.id=h.user_id WHERE h.organization_id=$1 AND h.role IN ('TRAINER','RECEPTIONIST','MANAGER') ORDER BY h.logged_in_at DESC LIMIT 26 OFFSET $2`,
            [a.organization_id, (p.page - 1) * 25],
          )
        ).rows,
        page: p.page,
      };
    }),
  );
}
