import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import type { Services } from "./app.js";
import { audit, one, type Executor } from "./db.js";
import {
  digest,
  fail,
  token,
  actorPermissions,
  type Actor,
} from "./security.js";
import { entitlement } from "./entitlements.js";

const idParam = z.object({ id: z.uuid() });
const memberInput = z
  .object({
    name: z.string().trim().min(2).max(150),
    phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/),
    email: z.union([z.email(), z.literal("")]).optional(),
    dob: z.iso.date().nullable().optional(),
    gender: z.enum(["Female", "Male", "Other", "Prefer not to say"]).optional(),
    address: z.string().max(500).default(""),
    emergency_contact: z.string().max(200).default(""),
    source: z.string().max(80).default("Walk-in"),
    notes: z.string().max(2000).default(""),
  })
  .strict();
const pageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().max(100).default(""),
  status: z
    .enum([
      "ALL",
      "ACTIVE",
      "EXPIRED",
      "EXPIRING",
      "INACTIVE",
      "TRIAL",
      "FROZEN",
    ])
    .default("ALL"),
});
export async function event(
  tx: Executor,
  a: Actor,
  name: string,
  id: string,
  title: string,
) {
  await audit(tx, a.organization_id, a.id, name, id);
  await tx.query(
    "INSERT INTO notifications(organization_id,title,body) VALUES($1,$2,$3)",
    [a.organization_id, title, name],
  );
  await tx.query(
    "INSERT INTO outbox(organization_id,kind,payload) VALUES($1,'EVENT',$2)",
    [a.organization_id, JSON.stringify({ event: name, resource_id: id })],
  );
}
async function member(tx: Executor, a: Actor, id: string) {
  const m = await one(
    tx,
    "SELECT * FROM members WHERE id=$1 AND organization_id=$2",
    [id, a.organization_id],
  );
  if (!m) fail(404, "Member not found.");
  return m;
}
export async function registerBusiness(
  app: FastifyInstance,
  { run }: Services,
) {
  app.get("/api/dashboard", (req) =>
    run(req, "dashboard", async (tx, a) => {
      const o = a.organization_id;
      const metrics = await one(
        tx,
        `SELECT
   (SELECT count(*)::int FROM members WHERE organization_id=$1) AS total_members,
   (SELECT count(DISTINCT m.member_id)::int FROM memberships m JOIN members x ON x.id=m.member_id WHERE m.organization_id=$1 AND x.active AND m.status IN ('ACTIVE','TRIAL') AND CURRENT_DATE BETWEEN m.starts_on AND m.ends_on) AS active_members,
   (SELECT count(DISTINCT member_id)::int FROM memberships WHERE organization_id=$1 AND status IN ('ACTIVE','TRIAL') AND ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE+7) AS expiring_members,
   (SELECT count(*)::int FROM members m WHERE m.organization_id=$1 AND m.active AND EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id) AND NOT EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id AND s.ends_on>=CURRENT_DATE AND s.status IN ('ACTIVE','TRIAL','FROZEN'))) AS expired_members,
   (SELECT count(*)::int FROM attendance WHERE organization_id=$1 AND (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date=CURRENT_DATE) AS today_checkins,
   (SELECT count(*)::int FROM attendance WHERE organization_id=$1 AND checked_out_at IS NULL) AS currently_inside,
   (SELECT COALESCE(sum(amount_paise),0)::bigint FROM payments WHERE organization_id=$1 AND status='COMPLETED' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date=CURRENT_DATE) AS today_revenue,
   (SELECT COALESCE(sum(amount_paise),0)::bigint FROM payments WHERE organization_id=$1 AND status='COMPLETED' AND date_trunc('month',created_at AT TIME ZONE 'Asia/Kolkata')=date_trunc('month',CURRENT_DATE::timestamp)) AS monthly_revenue,
   (SELECT count(*)::int FROM leads WHERE organization_id=$1 AND status='NEW') AS new_leads,
   (SELECT count(*)::int FROM members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.active AND m.created_at<now()-make_interval(days=>COALESCE((o.settings->>'inactive_days')::int,14)) AND NOT EXISTS(SELECT 1 FROM attendance t WHERE t.member_id=m.id AND t.checked_in_at>=now()-make_interval(days=>COALESCE((o.settings->>'inactive_days')::int,14)))) AS inactive_members`,
        [o],
      );
      const revenue = (
        await tx.query(
          `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day,sum(amount_paise)::bigint AS revenue FROM payments WHERE organization_id=$1 AND status='COMPLETED' AND created_at>=now()-interval '30 days' GROUP BY day ORDER BY day`,
          [o],
        )
      ).rows;
      const expiring = (
        await tx.query(
          `SELECT m.id,m.name,m.number,p.name AS plan,s.ends_on FROM memberships s JOIN members m ON m.id=s.member_id JOIN membership_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.status IN ('ACTIVE','TRIAL') AND s.ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE+7 ORDER BY s.ends_on LIMIT 8`,
          [o],
        )
      ).rows;
      const activity = (
        await tx.query(
          "SELECT action,created_at FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 8",
          [o],
        )
      ).rows;
      if (
        !a.features?.includes("payments") ||
        !a.features?.includes("reports") ||
        !actorPermissions(a).includes("payments")
      ) {
        delete metrics.today_revenue;
        delete metrics.monthly_revenue;
        revenue.length = 0;
      }
      if (!a.features?.includes("members")) {
        for (const k of [
          "total_members",
          "active_members",
          "expiring_members",
          "expired_members",
          "inactive_members",
        ])
          delete metrics[k];
        expiring.length = 0;
      }
      if (!a.features?.includes("attendance")) {
        delete metrics.today_checkins;
        delete metrics.currently_inside;
      }
      if (!a.features?.includes("leads")) delete metrics.new_leads;
      return {
        metrics,
        revenue,
        expiring,
        activity,
        organization: await one(
          tx,
          "SELECT name FROM organizations WHERE id=$1",
          [o],
        ),
      };
    }),
  );
  app.get("/api/members", (req) =>
    run(req, "members:read", async (tx, a) => {
      const p = pageInput.parse(req.query),
        args = [
          a.organization_id,
          `%${p.search.replace(/[\\%_]/g, "\\$&")}%`,
          p.status,
        ];
      const where = `m.organization_id=$1 AND (m.name ILIKE $2 OR m.phone ILIKE $2 OR ('GYM-'||lpad(m.number::text,6,'0')) ILIKE $2) AND ($3='ALL' OR ($3='INACTIVE' AND NOT m.active) OR ($3='ACTIVE' AND m.active AND EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id AND s.status IN ('ACTIVE','TRIAL') AND CURRENT_DATE BETWEEN s.starts_on AND s.ends_on)) OR ($3='EXPIRING' AND EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id AND s.status IN ('ACTIVE','TRIAL') AND s.ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE+7)) OR ($3='EXPIRED' AND EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id) AND NOT EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id AND s.ends_on>=CURRENT_DATE AND s.status IN ('ACTIVE','TRIAL','FROZEN'))) OR ($3 IN ('TRIAL','FROZEN') AND EXISTS(SELECT 1 FROM memberships s WHERE s.member_id=m.id AND s.status=$3 AND s.ends_on>=CURRENT_DATE)))`;
      return {
        items: (
          await tx.query(
            `SELECT m.id,m.number,m.name,m.phone,m.email,m.active,m.created_at,(SELECT max(ends_on) FROM memberships s WHERE s.member_id=m.id AND s.status IN ('ACTIVE','TRIAL')) AS expires_on FROM members m WHERE ${where} ORDER BY m.created_at DESC LIMIT 25 OFFSET $4`,
            [...args, (p.page - 1) * 25],
          )
        ).rows,
        total: (
          await one(
            tx,
            `SELECT count(*)::int AS n FROM members m WHERE ${where}`,
            args,
          )
        ).n,
        page: p.page,
      };
    }),
  );
  app.post("/api/members", (req) =>
    run(req, "members:create", async (tx, a) => {
      const p = memberInput.parse(req.body);
      await entitlement(tx, a.organization_id!, "members", "member");
      const branch =
        a.branch_id ??
        (
          await one(
            tx,
            "SELECT id FROM branches WHERE organization_id=$1 ORDER BY name LIMIT 1",
            [a.organization_id],
          )
        )?.id;
      if (!branch) fail(409, "Create a branch before registering members.");
      const m = await one(
        tx,
        "INSERT INTO members(organization_id,branch_id,name,phone,email,dob,gender,address,emergency_contact,source,notes,qr_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [
          a.organization_id,
          branch,
          p.name,
          p.phone,
          p.email || null,
          p.dob ?? null,
          p.gender ?? null,
          p.address,
          p.emergency_contact,
          p.source,
          p.notes,
          token(),
        ],
      );
      await event(tx, a, "member.created", m.id, `${m.name} joined your gym`);
      return { member: m };
    }),
  );
  app.get("/api/members/:id", (req) =>
    run(req, "members:read", async (tx, a) => {
      const { id } = idParam.parse(req.params);
      const m = await member(tx, a, id);
      return {
        member: m,
        memberships: (
          await tx.query(
            "SELECT s.id,s.starts_on,s.ends_on,s.status,s.freeze_used,p.name AS plan FROM memberships s JOIN membership_plans p ON p.id=s.plan_id WHERE s.member_id=$1 AND s.organization_id=$2 ORDER BY s.starts_on DESC LIMIT 100",
            [id, a.organization_id],
          )
        ).rows,
        payments:
          a.features?.includes("payments") &&
          actorPermissions(a).includes("payments")
            ? (
                await tx.query(
                  "SELECT p.*,i.id AS invoice_id,i.number AS invoice_number FROM payments p JOIN invoices i ON i.payment_id=p.id WHERE p.member_id=$1 AND p.organization_id=$2 ORDER BY p.created_at DESC LIMIT 100",
                  [id, a.organization_id],
                )
              ).rows
            : [],
        attendance: a.features?.includes("attendance")
          ? (
              await tx.query(
                "SELECT * FROM attendance WHERE member_id=$1 AND organization_id=$2 ORDER BY checked_in_at DESC LIMIT 100",
                [id, a.organization_id],
              )
            ).rows
          : [],
      };
    }),
  );
  app.patch("/api/members/:id", (req) =>
    run(req, "members:edit", async (tx, a) => {
      const { id } = idParam.parse(req.params),
        p = memberInput.parse(req.body);
      await entitlement(tx, a.organization_id!, "members");
      await member(tx, a, id);
      await tx.query(
        "UPDATE members SET name=$1,phone=$2,email=$3,dob=$4,gender=$5,address=$6,emergency_contact=$7,source=$8,notes=$9 WHERE id=$10 AND organization_id=$11",
        [
          p.name,
          p.phone,
          p.email || null,
          p.dob ?? null,
          p.gender ?? null,
          p.address,
          p.emergency_contact,
          p.source,
          p.notes,
          id,
          a.organization_id,
        ],
      );
      await audit(tx, a.organization_id, a.id, "member.updated", id);
      return { ok: true };
    }),
  );
  app.post("/api/members/:id/deactivate", (req) =>
    run(req, "members:deactivate", async (tx, a) => {
      const { id } = idParam.parse(req.params);
      await member(tx, a, id);
      await tx.query(
        "UPDATE members SET active=false WHERE id=$1 AND organization_id=$2",
        [id, a.organization_id],
      );
      await audit(tx, a.organization_id, a.id, "member.deactivated", id);
      return { ok: true };
    }),
  );
  app.get("/api/members/:id/qr", (req) =>
    run(req, "members:read", async (tx, a) => {
      const m = await member(tx, a, idParam.parse(req.params).id);
      return {
        qr: await QRCode.toDataURL(`gymos:${m.qr_token}`),
        identifier: `GYM-${String(m.number).padStart(6, "0")}`,
      };
    }),
  );
  app.post("/api/members/:id/qr", (req) =>
    run(req, "members:edit", async (tx, a) => {
      const { id } = idParam.parse(req.params);
      await member(tx, a, id);
      await tx.query(
        "UPDATE members SET qr_token=$1 WHERE id=$2 AND organization_id=$3",
        [token(), id, a.organization_id],
      );
      await audit(tx, a.organization_id, a.id, "member.qr_regenerated", id);
      return { ok: true };
    }),
  );
  app.get("/api/membership-plans", (req) =>
    run(req, "members:read", async (tx, a) => ({
      items: (
        await tx.query(
          "SELECT * FROM membership_plans WHERE organization_id=$1 ORDER BY price_paise",
          [a.organization_id],
        )
      ).rows,
    })),
  );
  app.post("/api/membership-plans", (req) =>
    run(req, "memberships", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(100),
          duration_days: z.number().int().min(1).max(3660),
          price_paise: z.number().int().min(0).max(100000000),
          tax_bps: z.number().int().min(0).max(10000).default(0),
          freeze_days: z.number().int().min(0).max(365).default(0),
          benefits: z.string().max(1000).default(""),
          trial: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "memberships");
      const row = await one(
        tx,
        "INSERT INTO membership_plans(organization_id,name,duration_days,price_paise,tax_bps,freeze_days,benefits,trial) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          a.organization_id,
          p.name,
          p.duration_days,
          p.price_paise,
          p.tax_bps,
          p.freeze_days,
          p.benefits,
          p.trial,
        ],
      );
      await audit(
        tx,
        a.organization_id,
        a.id,
        "membership_plan.created",
        row.id,
      );
      return { plan: row };
    }),
  );
  app.post("/api/payments", (req) =>
    run(req, "payments", async (tx, a) => {
      const p = z
        .object({
          member_id: z.uuid(),
          plan_id: z.uuid(),
          starts_on: z.iso.date(),
          discount_paise: z.number().int().min(0).default(0),
          amount_paise: z.number().int().min(0).max(100000000),
          payment_deadline: z.iso.date().nullable().default(null),
          method: z.enum(["CASH", "UPI", "CARD", "BANK", "OTHER"]),
          transaction_id: z.string().trim().min(1).max(150).optional(),
          notes: z.string().max(1000).default(""),
          idempotency_key: z.uuid(),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "payments");
      const hash = digest(JSON.stringify(p));
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${a.organization_id}:${p.idempotency_key}`,
      ]);
      const existing = await one(
        tx,
        "SELECT p.*,i.id AS invoice_id FROM payments p JOIN invoices i ON i.payment_id=p.id WHERE p.organization_id=$1 AND p.idempotency_key=$2",
        [a.organization_id, p.idempotency_key],
      );
      if (existing) {
        if (existing.request_hash !== hash)
          fail(
            409,
            "This payment key was already used for a different request.",
          );
        return { payment: existing, replayed: true };
      }
      const m = await one(
        tx,
        "SELECT * FROM members WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [p.member_id, a.organization_id],
      );
      if (!m || !m.active) fail(400, "Select an active member.");
      const plan = await one(
        tx,
        "SELECT * FROM membership_plans WHERE id=$1 AND organization_id=$2 AND active",
        [p.plan_id, a.organization_id],
      );
      if (!plan) fail(404, "Plan not found.");
      if (p.discount_paise > plan.price_paise)
        fail(400, "Discount cannot exceed the plan price.");
      const tax = Math.round(
          ((plan.price_paise - p.discount_paise) * plan.tax_bps) / 10000,
        ),
        amount = plan.price_paise - p.discount_paise + tax;
      if (p.amount_paise > amount)
        fail(400, "Payment cannot exceed the membership fee.");
      if (p.amount_paise < amount && !p.payment_deadline)
        fail(400, "Set a payment deadline for the remaining balance.");
      if (p.method !== "CASH" && !p.transaction_id)
        fail(400, "A transaction reference is required for non-cash payments.");
      const overlap = await one(
        tx,
        "SELECT id FROM memberships WHERE organization_id=$1 AND member_id=$2 AND status IN ('ACTIVE','TRIAL','FROZEN') AND starts_on<=($3::date+$4::int-1) AND ends_on>=$3::date",
        [a.organization_id, m.id, p.starts_on, plan.duration_days],
      );
      if (overlap)
        fail(
          409,
          "This membership period overlaps an existing period. Choose a date after the current membership ends.",
        );
      const membership = await one(
        tx,
        "INSERT INTO memberships(organization_id,member_id,plan_id,starts_on,ends_on,status,fee_paise,payment_deadline) VALUES($1,$2,$3,$4::date,$4::date+$5::int-1,$6,$7,$8) RETURNING *",
        [
          a.organization_id,
          m.id,
          plan.id,
          p.starts_on,
          plan.duration_days,
          plan.trial ? "TRIAL" : "ACTIVE",
          amount,
          p.payment_deadline,
        ],
      );
      const payment = await one(
        tx,
        "INSERT INTO payments(organization_id,member_id,membership_id,amount_paise,subtotal_paise,discount_paise,tax_paise,method,transaction_id,notes,received_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [
          a.organization_id,
          m.id,
          membership.id,
          p.amount_paise,
          p.amount_paise === amount ? plan.price_paise : p.amount_paise,
          p.amount_paise === amount ? p.discount_paise : 0,
          p.amount_paise === amount ? tax : 0,
          p.method,
          p.transaction_id ?? null,
          p.notes,
          a.id,
          p.idempotency_key,
          hash,
        ],
      );
      const org = await one(
        tx,
        "SELECT name,address,email,phone,currency FROM organizations WHERE id=$1",
        [a.organization_id],
      );
      const invoice = await one(
        tx,
        "INSERT INTO invoices(organization_id,payment_id,snapshot) VALUES($1,$2,$3) RETURNING id,number",
        [
          a.organization_id,
          payment.id,
          JSON.stringify({
            gym: org,
            member: { name: m.name, number: m.number },
            plan: plan.name,
            payment,
            membership,
          }),
        ],
      );
      await event(
        tx,
        a,
        "payment.completed",
        payment.id,
        `Payment recorded for ${m.name}`,
      );
      return {
        payment: { ...payment, invoice_id: invoice.id },
        membership,
        invoice,
      };
    }),
  );
  app.get("/api/payments", (req) =>
    run(req, "payments", async (tx, a) => {
      const p = pageInput.parse(req.query);
      return {
        items: (
          await tx.query(
            "SELECT p.*,m.name AS member_name,i.id AS invoice_id,i.number AS invoice_number FROM payments p JOIN members m ON m.id=p.member_id JOIN invoices i ON i.payment_id=p.id WHERE p.organization_id=$1 ORDER BY p.created_at DESC LIMIT 25 OFFSET $2",
            [a.organization_id, (p.page - 1) * 25],
          )
        ).rows,
        total: (
          await one(
            tx,
            "SELECT count(*)::int AS n FROM payments WHERE organization_id=$1",
            [a.organization_id],
          )
        ).n,
        page: p.page,
      };
    }),
  );
  app.get("/api/invoices/:id/pdf", async (req, reply) => {
    const result = await run(req, "payments", async (tx, a) => {
      const row = await one(
        tx,
        "SELECT * FROM invoices WHERE id=$1 AND organization_id=$2",
        [idParam.parse(req.params).id, a.organization_id],
      );
      if (!row) fail(404, "Invoice not found.");
      return row;
    });
    const s = result.snapshot;
    const doc = new PDFDocument({ margin: 55 });
    const chunks: Buffer[] = [];
    const buffer = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc
      .fontSize(26)
      .text(s.gym.name)
      .fontSize(10)
      .text(s.gym.address)
      .text(s.gym.email)
      .moveDown(2);
    doc
      .fontSize(20)
      .text(`RECEIPT INV-${String(result.number).padStart(6, "0")}`)
      .fontSize(11)
      .text(new Date(result.created_at).toLocaleDateString("en-IN"))
      .moveDown();
    doc
      .text(`Member: ${s.member.name}`)
      .text(`Member ID: GYM-${String(s.member.number).padStart(6, "0")}`)
      .text(`Plan: ${s.plan}`)
      .text(
        `Period: ${String(s.membership.starts_on).slice(0, 10)} to ${String(s.membership.ends_on).slice(0, 10)}`,
      )
      .moveDown();
    if (s.membership.fee_paise !== undefined)
      doc
        .text(
          `Agreed membership fee: INR ${(Number(s.membership.fee_paise) / 100).toFixed(2)}`,
        )
        .text(
          `Payment deadline: ${s.membership.payment_deadline ? String(s.membership.payment_deadline).slice(0, 10) : "Not applicable"}`,
        )
        .moveDown();
    for (const [label, key] of [
      ["Subtotal", "subtotal_paise"],
      ["Discount", "discount_paise"],
      ["Tax", "tax_paise"],
      ["Total paid", "amount_paise"],
    ])
      doc.text(`${label}: INR ${(s.payment[key] / 100).toFixed(2)}`);
    doc
      .moveDown()
      .text(`Method: ${s.payment.method}`)
      .text(`Reference: ${s.payment.transaction_id ?? "Cash payment"}`)
      .moveDown(2)
      .text(
        "Payment recorded by your gym. Keep this receipt for your records.",
      );
    doc.end();
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="receipt-${result.number}.pdf"`,
      )
      .type("application/pdf")
      .send(await buffer);
  });
  app.post("/api/memberships/:id/freeze", (req) =>
    run(req, "memberships", async (tx, a) => {
      const { id } = idParam.parse(req.params);
      await entitlement(tx, a.organization_id!, "memberships");
      const s = await one(
        tx,
        "SELECT s.*,p.freeze_days FROM memberships s JOIN membership_plans p ON p.id=s.plan_id WHERE s.id=$1 AND s.organization_id=$2 FOR UPDATE OF s",
        [id, a.organization_id],
      );
      if (!s) fail(404, "Membership not found.");
      const valid = await one(
        tx,
        "SELECT $1::date<=CURRENT_DATE AND $2::date>=CURRENT_DATE AS active",
        [s.starts_on, s.ends_on],
      );
      if (
        s.status !== "ACTIVE" ||
        !valid.active ||
        s.freeze_used >= s.freeze_days
      )
        fail(409, "Membership is not eligible for freezing.");
      await tx.query(
        "UPDATE memberships SET status='FROZEN',frozen_at=CURRENT_DATE WHERE id=$1",
        [id],
      );
      await audit(tx, a.organization_id, a.id, "membership.frozen", id);
      return { ok: true };
    }),
  );
  app.post("/api/memberships/:id/unfreeze", (req) =>
    run(req, "memberships", async (tx, a) => {
      const { id } = idParam.parse(req.params);
      await entitlement(tx, a.organization_id!, "memberships");
      const s = await one(
        tx,
        "SELECT s.*,p.freeze_days,(CURRENT_DATE-s.frozen_at)::int AS days FROM memberships s JOIN membership_plans p ON p.id=s.plan_id WHERE s.id=$1 AND s.organization_id=$2 FOR UPDATE OF s",
        [id, a.organization_id],
      );
      if (!s || s.status !== "FROZEN") fail(409, "Membership is not frozen.");
      const days = Math.min(s.days, s.freeze_days - s.freeze_used);
      if (
        await one(
          tx,
          "SELECT id FROM memberships WHERE member_id=$1 AND id<>$2 AND status IN ('ACTIVE','TRIAL','FROZEN') AND starts_on<=($3::date+$4::int) AND ends_on>=$5::date",
          [s.member_id, id, s.ends_on, days, s.starts_on],
        )
      )
        fail(
          409,
          "Extension would overlap a renewal. Resolve the schedule first.",
        );
      await tx.query(
        "UPDATE memberships SET status='ACTIVE',ends_on=ends_on+$1::int,freeze_used=freeze_used+$1::int,frozen_at=NULL WHERE id=$2",
        [days, id],
      );
      await audit(tx, a.organization_id, a.id, "membership.unfrozen", id, {
        days,
      });
      return { ok: true };
    }),
  );
  app.get("/api/attendance", (req) =>
    run(req, "attendance", async (tx, a) => {
      const p = pageInput.parse(req.query);
      return {
        items: (
          await tx.query(
            "SELECT t.*,m.name AS member_name,m.number FROM attendance t JOIN members m ON m.id=t.member_id WHERE t.organization_id=$1 ORDER BY t.checked_in_at DESC LIMIT 25 OFFSET $2",
            [a.organization_id, (p.page - 1) * 25],
          )
        ).rows,
        total: (
          await one(
            tx,
            "SELECT count(*)::int AS n FROM attendance WHERE organization_id=$1",
            [a.organization_id],
          )
        ).n,
        page: p.page,
      };
    }),
  );
  app.post("/api/attendance/check-in", (req) =>
    run(req, "attendance", async (tx, a) => {
      const p = z
        .object({
          member_id: z.uuid().optional(),
          qr: z.string().min(20).max(100).optional(),
        })
        .strict()
        .refine(
          (v) => Boolean(v.member_id) !== Boolean(v.qr),
          "Supply a member ID or QR identifier.",
        )
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "attendance");
      const m = await one(
        tx,
        "SELECT * FROM members WHERE organization_id=$1 AND " +
          (p.member_id ? "id=$2" : "qr_token=$2") +
          " FOR UPDATE",
        [a.organization_id, p.member_id ?? p.qr!.replace(/^gymos:/, "")],
      );
      if (!m || !m.active) fail(404, "Active member not found.");
      if (
        !(await one(
          tx,
          "SELECT id FROM memberships WHERE member_id=$1 AND organization_id=$2 AND status IN ('ACTIVE','TRIAL') AND CURRENT_DATE BETWEEN starts_on AND ends_on",
          [m.id, a.organization_id],
        ))
      )
        fail(409, "Member has no valid membership today.");
      if (
        await one(
          tx,
          "SELECT id FROM attendance WHERE member_id=$1 AND organization_id=$2 AND checked_out_at IS NULL",
          [m.id, a.organization_id],
        )
      )
        fail(409, "This member is already checked in.");
      const row = await one(
        tx,
        "INSERT INTO attendance(organization_id,member_id,recorded_by) VALUES($1,$2,$3) RETURNING *",
        [a.organization_id, m.id, a.id],
      );
      await event(
        tx,
        a,
        "attendance.checked_in",
        row.id,
        `${m.name} checked in`,
      );
      return { attendance: row };
    }),
  );
  app.post("/api/attendance/:id/check-out", (req) =>
    run(req, "attendance", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "attendance");
      const { id } = idParam.parse(req.params);
      const row = await one(
        tx,
        "UPDATE attendance SET checked_out_at=now() WHERE id=$1 AND organization_id=$2 AND checked_out_at IS NULL RETURNING *",
        [id, a.organization_id],
      );
      if (!row) fail(409, "Open check-in not found.");
      await event(tx, a, "attendance.checked_out", id, "Member checked out");
      return { attendance: row };
    }),
  );
}
