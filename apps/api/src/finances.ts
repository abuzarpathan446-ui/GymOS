import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "./app.js";
import { one, audit, type Executor } from "./db.js";
import { fail, digest, authorize } from "./security.js";
import { event } from "./business.js";
import { entitlement } from "./entitlements.js";
export const balanceSQL = `SELECT s.id,s.member_id,m.name AS member_name,p.name AS plan,s.starts_on,s.ends_on,s.status AS membership_status,s.fee_paise,s.payment_deadline,
 COALESCE(x.paid,0)::bigint AS paid_paise,(s.fee_paise-COALESCE(x.paid,0))::bigint AS pending_paise,
 CASE WHEN s.fee_paise<=COALESCE(x.paid,0) THEN 'PAID' WHEN s.payment_deadline<CURRENT_DATE THEN 'OVERDUE' WHEN COALESCE(x.paid,0)>0 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END AS payment_status
 FROM memberships s JOIN members m ON m.id=s.member_id JOIN membership_plans p ON p.id=s.plan_id
 LEFT JOIN LATERAL(SELECT sum(amount_paise) AS paid FROM payments WHERE membership_id=s.id AND organization_id=s.organization_id AND status='COMPLETED') x ON true`;
export async function financialSummary(tx: Executor, org: string) {
  const rows = [];
  for (const period of ["all", "day", "month", "year"]) {
    const r = await one(
      tx,
      `SELECT COALESCE(sum(amount_paise),0)::bigint AS amount FROM payments WHERE organization_id=$1 AND status='COMPLETED' ${period === "all" ? "" : `AND date_trunc('${period}',created_at AT TIME ZONE 'Asia/Kolkata')=date_trunc('${period}',CURRENT_DATE::timestamp)`}`,
      [org],
    );
    const e = await one(
      tx,
      `SELECT COALESCE(sum(amount_paise),0)::bigint AS amount FROM expenses WHERE organization_id=$1 ${period === "all" ? "" : `AND date_trunc('${period}',spent_on::timestamp)=date_trunc('${period}',CURRENT_DATE::timestamp)`}`,
      [org],
    );
    rows.push({
      period,
      revenue_paise: Number(r.amount),
      expenses_paise: Number(e.amount),
      profit_paise: Number(r.amount) - Number(e.amount),
    });
  }
  const balances = await one(
    tx,
    `SELECT COALESCE(sum(pending_paise),0)::bigint AS pending_paise,count(*) FILTER(WHERE payment_status='PAID')::int AS paid,count(*) FILTER(WHERE payment_status='PARTIALLY_PAID')::int AS partial,count(*) FILTER(WHERE payment_status='OVERDUE')::int AS overdue FROM (${balanceSQL} WHERE s.organization_id=$1) b`,
    [org],
  );
  return {
    periods: rows,
    balances,
    basis: "Cash received minus recorded expenses; refunds excluded.",
  };
}
export async function registerFinances(
  app: FastifyInstance,
  { run }: Services,
) {
  app.get("/api/financial-summary", (req) =>
    run(req, "reports", async (tx, a) => {
      authorize(a, "payments");
      await entitlement(tx, a.organization_id!, "payments");
      const summary = await financialSummary(tx, a.organization_id!);
      if (!a.features?.includes("expenses"))
        return {
          ...summary,
          periods: summary.periods.map(
            ({ expenses_paise, profit_paise, ...r }) => r,
          ),
        };
      return summary;
    }),
  );
  app.get("/api/balances", (req) =>
    run(req, "payments", async (tx, a) => {
      const p = z
        .object({
          member_id: z.uuid().optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          status: z
            .enum(["ALL", "PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE"])
            .default("ALL"),
        })
        .strict()
        .parse(req.query);
      const where = ` WHERE s.organization_id=$1 AND ($2::uuid IS NULL OR s.member_id=$2)`;
      const filter = `SELECT * FROM (${balanceSQL + where}) b WHERE ($3='ALL' OR payment_status=$3)`;
      return {
        items: (
          await tx.query(
            filter + " ORDER BY starts_on DESC LIMIT 25 OFFSET $4",
            [
              a.organization_id,
              p.member_id ?? null,
              p.status,
              (p.page - 1) * 25,
            ],
          )
        ).rows,
        total: (
          await one(tx, `SELECT count(*)::int AS n FROM (${filter}) q`, [
            a.organization_id,
            p.member_id ?? null,
            p.status,
          ])
        ).n,
        page: p.page,
      };
    }),
  );
  app.post("/api/memberships/:id/payments", (req) =>
    run(req, "payments", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = z
          .object({
            amount_paise: z.number().int().positive().max(100000000),
            method: z.enum(["CASH", "UPI", "CARD", "BANK", "OTHER"]),
            transaction_id: z.string().trim().min(1).max(150).optional(),
            notes: z.string().max(1000).default(""),
            idempotency_key: z.uuid(),
          })
          .strict()
          .parse(req.body);
      const hash = digest(JSON.stringify({ membership_id: id, ...p }));
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${a.organization_id}:${p.idempotency_key}`,
      ]);
      const previous = await one(
        tx,
        "SELECT p.*,i.id AS invoice_id FROM payments p JOIN invoices i ON i.payment_id=p.id WHERE p.organization_id=$1 AND p.idempotency_key=$2",
        [a.organization_id, p.idempotency_key],
      );
      if (previous) {
        if (previous.request_hash !== hash)
          fail(409, "Payment key already used for a different request.");
        return { payment: previous, replayed: true };
      }
      const membership = await one(
        tx,
        "SELECT * FROM memberships WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [id, a.organization_id],
      );
      if (!membership) fail(404, "Membership not found.");
      const b = await one(
        tx,
        balanceSQL + " WHERE s.id=$1 AND s.organization_id=$2",
        [id, a.organization_id],
      );
      if (p.amount_paise > Number(b.pending_paise))
        fail(409, "Payment exceeds the remaining balance. Refresh and retry.");
      if (p.method !== "CASH" && !p.transaction_id)
        fail(400, "A transaction reference is required for non-cash payments.");
      const payment = await one(
        tx,
        "INSERT INTO payments(organization_id,member_id,membership_id,amount_paise,subtotal_paise,discount_paise,tax_paise,method,transaction_id,notes,received_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$4,0,0,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          a.organization_id,
          membership.member_id,
          id,
          p.amount_paise,
          p.method,
          p.transaction_id ?? null,
          p.notes,
          a.id,
          p.idempotency_key,
          hash,
        ],
      );
      const member = await one(
        tx,
        "SELECT name,number FROM members WHERE id=$1 AND organization_id=$2",
        [membership.member_id, a.organization_id],
      );
      const gym = await one(
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
          JSON.stringify({ gym, member, plan: b.plan, membership, payment }),
        ],
      );
      await event(
        tx,
        a,
        "payment.completed",
        payment.id,
        "Membership installment recorded",
      );
      return { payment: { ...payment, invoice_id: invoice.id }, invoice };
    }),
  );
  app.patch("/api/memberships/:id/payment-deadline", (req) =>
    run(req, "payments", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = z
          .object({ payment_deadline: z.iso.date() })
          .strict()
          .parse(req.body);
      const row = await one(
        tx,
        "UPDATE memberships SET payment_deadline=$3 WHERE id=$1 AND organization_id=$2 RETURNING id",
        [id, a.organization_id, p.payment_deadline],
      );
      if (!row) fail(404, "Membership not found.");
      await audit(
        tx,
        a.organization_id,
        a.id,
        "payment.deadline_changed",
        id,
        p,
      );
      return { ok: true };
    }),
  );
  app.get("/api/expenses", (req) =>
    run(req, "expenses", async (tx, a) => {
      const p = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .parse(req.query);
      return {
        items: (
          await tx.query(
            "SELECT id,description,category,amount_paise,spent_on,created_at FROM expenses WHERE organization_id=$1 ORDER BY spent_on DESC,created_at DESC LIMIT 26 OFFSET $2",
            [a.organization_id, (p.page - 1) * 25],
          )
        ).rows,
        page: p.page,
      };
    }),
  );
  app.post("/api/expenses", (req) =>
    run(req, "expenses", async (tx, a) => {
      const p = z
        .object({
          description: z.string().trim().min(2).max(500),
          category: z.string().trim().min(2).max(80),
          amount_paise: z.number().int().positive().max(100000000),
          spent_on: z.iso.date(),
        })
        .strict()
        .parse(req.body);
      const row = await one(
        tx,
        "INSERT INTO expenses(organization_id,description,category,amount_paise,spent_on,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          a.organization_id,
          p.description,
          p.category,
          p.amount_paise,
          p.spent_on,
          a.id,
        ],
      );
      await audit(tx, a.organization_id, a.id, "expense.created", row.id);
      return row;
    }),
  );
}
