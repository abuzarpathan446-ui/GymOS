import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import type { Services } from "./app.js";
import { one, audit } from "./db.js";
import { fail } from "./security.js";
import { entitlement } from "./entitlements.js";
import { createAccountSetup, deliverySchema } from "./account-setup.js";
import { balanceSQL } from "./finances.js";

// The member identity always comes from the authenticated user-to-member link.
// These endpoints never accept member IDs, including as query parameters.
export async function registerMemberPortal(
  app: FastifyInstance,
  { run }: Services,
) {
  const queries = {
    membership: `SELECT s.id,s.starts_on,s.ends_on,s.status,s.freeze_used,p.name AS plan,p.benefits FROM memberships s JOIN membership_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.member_id=$2 ORDER BY s.starts_on DESC`,
    attendance: `SELECT id,checked_in_at,checked_out_at FROM attendance WHERE organization_id=$1 AND member_id=$2 ORDER BY checked_in_at DESC`,
    workouts: `SELECT id,name,exercises,created_by,created_at FROM workouts WHERE organization_id=$1 AND member_id=$2 ORDER BY created_at DESC`,
    progress: `SELECT id,weight_kg,height_cm,body_fat,measurements,measured_on FROM body_measurements WHERE organization_id=$1 AND member_id=$2 ORDER BY measured_on DESC`,
    payments: `SELECT p.id,p.amount_paise,p.method,p.status,p.created_at,i.number AS invoice_number FROM payments p JOIN invoices i ON i.payment_id=p.id WHERE p.organization_id=$1 AND p.member_id=$2 ORDER BY p.created_at DESC`,
    appointments: `SELECT p.id,p.starts_at,p.ends_at,p.status,u.name AS trainer_name FROM appointments p JOIN trainers t ON t.id=p.trainer_id JOIN users u ON u.id=t.user_id WHERE p.organization_id=$1 AND p.member_id=$2 ORDER BY p.starts_at DESC`,
  };
  for (const section of ["dashboard", "qr", ...Object.keys(queries)]) {
    app.get(`/api/member/${section}`, (req) =>
      run(req, "self:read", async (tx, a) => {
        const input = z
          .object({
            page: z.coerce.number().int().min(1).max(100000).default(1),
          })
          .strict()
          .parse(req.query);
        await entitlement(tx, a.organization_id!, "member_portal");
        if (
          [
            "attendance",
            "workouts",
            "progress",
            "payments",
            "appointments",
          ].includes(section)
        )
          await entitlement(tx, a.organization_id!, section);
        const member = await one(
          tx,
          "SELECT id,number,name,email,phone,photo,created_at,qr_token FROM members WHERE user_id=$1 AND organization_id=$2 AND active",
          [a.id, a.organization_id],
        );
        if (!member)
          fail(403, "Your member access is not active. Contact your gym.");
        if (section === "qr")
          return {
            qr: await QRCode.toDataURL(`gymos:${member.qr_token}`),
            identifier: `GYM-${String(member.number).padStart(6, "0")}`,
          };
        if (section === "dashboard") {
          const membership = await one(
            tx,
            `SELECT s.starts_on,s.ends_on,s.status,p.name AS plan FROM memberships s JOIN membership_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.member_id=$2 ORDER BY (CURRENT_DATE BETWEEN s.starts_on AND s.ends_on AND s.status IN ('ACTIVE','TRIAL','FROZEN')) DESC,s.starts_on DESC LIMIT 1`,
            [a.organization_id, member.id],
          );
          const visits = await one(
            tx,
            "SELECT count(*)::int AS total,count(*) FILTER(WHERE checked_out_at IS NULL)::int AS inside FROM attendance WHERE organization_id=$1 AND member_id=$2",
            [a.organization_id, member.id],
          );
          const gym = await one(
            tx,
            "SELECT name,phone,address FROM organizations WHERE id=$1",
            [a.organization_id],
          );
          const { qr_token, ...profile } = member;
          return {
            member: profile,
            gym,
            membership,
            visits: a.features?.includes("attendance") ? visits : null,
          };
        }
        const query = queries[section as keyof typeof queries];
        const items = (
          await tx.query(`${query} LIMIT 26 OFFSET $3`, [
            a.organization_id,
            member.id,
            (input.page - 1) * 25,
          ])
        ).rows;
        return {
          ...(section === "attendance"
            ? {
                summary: await one(
                  tx,
                  `SELECT count(DISTINCT (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS present_days,EXTRACT(DAY FROM CURRENT_DATE)::int AS elapsed_days,round(100.0*count(DISTINCT (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date)/EXTRACT(DAY FROM CURRENT_DATE),1) AS percentage FROM attendance WHERE organization_id=$1 AND member_id=$2 AND (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN date_trunc('month',CURRENT_DATE)::date AND CURRENT_DATE`,
                  [a.organization_id, member.id],
                ),
              }
            : {}),
          ...(section === "payments"
            ? {
                balances: (
                  await tx.query(
                    balanceSQL +
                      " WHERE s.organization_id=$1 AND s.member_id=$2 ORDER BY s.starts_on DESC LIMIT 100",
                    [a.organization_id, member.id],
                  )
                ).rows,
              }
            : {}),
          items: items.slice(0, 25),
          page: input.page,
          has_more: items.length > 25,
        };
      }),
    );
  }
  app.post("/api/members/:id/portal-invitation", (req) =>
    run(req, "members:account", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const p = z
        .object({ delivery: deliverySchema })
        .strict()
        .parse(req.body ?? {});
      await entitlement(tx, a.organization_id!, "member_portal");
      const m = await one(
        tx,
        "SELECT id,name,email,branch_id,user_id FROM members WHERE id=$1 AND organization_id=$2 AND active FOR UPDATE",
        [id, a.organization_id],
      );
      if (!m) fail(404, "Active member not found.");
      if (!m.email) fail(400, "Add the member’s email to their profile first.");
      if (m.user_id)
        fail(
          409,
          "This member already has portal access. They can use password recovery.",
        );
      if (
        await one(tx, "SELECT id FROM users WHERE email=$1", [
          m.email.toLowerCase(),
        ])
      )
        fail(
          409,
          "This email is already used by an account. Use a unique member email.",
        );
      const user = await one(
        tx,
        "INSERT INTO users(organization_id,branch_id,name,email,role) VALUES($1,$2,$3,$4,'MEMBER') RETURNING id,email,organization_id,role",
        [a.organization_id, m.branch_id, m.name, m.email.toLowerCase()],
      );
      await tx.query(
        "UPDATE members SET user_id=$1 WHERE id=$2 AND organization_id=$3",
        [user.id, id, a.organization_id],
      );
      const setup = await createAccountSetup(tx, user, p.delivery);
      await audit(tx, a.organization_id, a.id, "member.account_created", id, {
        delivery: p.delivery,
      });
      return setup;
    }),
  );
}
