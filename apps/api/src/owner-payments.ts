import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Services } from "./app.js";
import { one, audit, type Executor } from "./db.js";
import { fail } from "./security.js";

export const ownerPaymentSchema = z
  .object({
    amount_paise: z.number().int().positive().max(10000000000),
    paid_on: z.iso.date(),
    method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"]),
    reference: z.string().trim().max(150).default(""),
    notes: z.string().trim().max(2000).default(""),
    idempotency_key: z.uuid(),
  })
  .strict();
export async function recordOwnerPayment(
  tx: Executor,
  ownerId: string,
  actor: string,
  p: z.infer<typeof ownerPaymentSchema>,
) {
  const owner = await one(
    tx,
    "SELECT id,organization_id FROM users WHERE id=$1 AND role='OWNER'",
    [ownerId],
  );
  if (!owner) fail(404, "Owner not found.");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    p.idempotency_key,
  ]);
  const previous = await one(
    tx,
    "SELECT *,to_char(paid_on,'YYYY-MM-DD') AS payment_date_key FROM owner_payments WHERE idempotency_key=$1",
    [p.idempotency_key],
  );
  if (previous) {
    if (
      previous.owner_id !== ownerId ||
      Number(previous.amount_paise) !== p.amount_paise ||
      previous.payment_date_key !== p.paid_on ||
      previous.method !== p.method ||
      previous.reference !== p.reference ||
      previous.notes !== p.notes
    )
      fail(
        409,
        "This payment request was already used with different details.",
      );
    return previous;
  }
  const row = await one(
    tx,
    "INSERT INTO owner_payments(organization_id,owner_id,amount_paise,paid_on,method,reference,notes,recorded_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [
      owner.organization_id,
      ownerId,
      p.amount_paise,
      p.paid_on,
      p.method,
      p.reference,
      p.notes,
      actor,
      p.idempotency_key,
    ],
  );
  await audit(
    tx,
    owner.organization_id,
    actor,
    "owner.payment_recorded",
    row.id,
    { amount_paise: p.amount_paise, owner_id: ownerId },
  );
  return row;
}
export async function registerOwnerPayments(
  app: FastifyInstance,
  { run }: Services,
) {
  app.post("/api/admin/owner-payments", (req) =>
    run(req, "platform", async (tx, a) => {
      const p = ownerPaymentSchema
        .extend({ owner_id: z.uuid() })
        .parse(req.body);
      return recordOwnerPayment(tx, p.owner_id, a.id, p);
    }),
  );
  app.get("/api/admin/owner-payments/accounts", (req) =>
    run(req, "platform", async (tx) => {
      const { q } = z
        .object({ q: z.string().max(150).default("") })
        .parse(req.query);
      return {
        items: (
          await tx.query(
            "SELECT u.id,u.name,u.email,o.name AS gym_name FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.role='OWNER' AND (u.name ILIKE $1 OR u.email ILIKE $1 OR o.name ILIKE $1) ORDER BY u.created_at DESC LIMIT 50",
            [`%${q}%`],
          )
        ).rows,
      };
    }),
  );
  app.get("/api/admin/owner-payments", (req) =>
    run(req, "platform", async (tx) => {
      const p = z
        .object({
          q: z.string().max(150).default(""),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .parse(req.query);
      const from =
        "FROM owner_payments p JOIN users u ON u.id=p.owner_id JOIN organizations o ON o.id=p.organization_id WHERE u.name ILIKE $1 OR u.email ILIKE $1 OR o.name ILIKE $1";
      const summary = await one(
        tx,
        `SELECT count(*)::int AS count,COALESCE(sum(p.amount_paise),0)::bigint AS collected_paise ${from}`,
        [`%${p.q}%`],
      );
      return {
        summary,
        items: (
          await tx.query(
            `SELECT p.*,u.name AS owner_name,u.email,o.name AS gym_name,(SELECT name FROM users WHERE id=p.recorded_by) AS recorded_by_name ${from} ORDER BY p.paid_on DESC,p.created_at DESC LIMIT 25 OFFSET $2`,
            [`%${p.q}%`, (p.page - 1) * 25],
          )
        ).rows,
      };
    }),
  );
}
