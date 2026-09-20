import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "./app.js";
import { one, audit } from "./db.js";
import { fail, authorize } from "./security.js";
import { balanceSQL } from "./finances.js";
import { entitlement } from "./entitlements.js";
export async function registerWhatsApp(
  app: FastifyInstance,
  { run }: Services,
) {
  app.get("/api/whatsapp/reminders", (req) =>
    run(req, "whatsapp", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "members");
      const { page } = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .parse(req.query);
      return {
        items: (
          await tx.query(
            `SELECT s.id,m.id AS member_id,m.name,s.ends_on,CASE WHEN s.ends_on<CURRENT_DATE THEN 'EXPIRED' ELSE 'EXPIRING' END AS type FROM memberships s JOIN members m ON m.id=s.member_id WHERE s.organization_id=$1 AND m.active AND s.status IN ('ACTIVE','TRIAL') AND (s.ends_on=CURRENT_DATE+3 OR (s.ends_on<CURRENT_DATE AND NOT EXISTS(SELECT 1 FROM memberships newer WHERE newer.member_id=s.member_id AND newer.ends_on>s.ends_on AND newer.status IN ('ACTIVE','TRIAL')))) ORDER BY s.ends_on DESC LIMIT 26 OFFSET $2`,
            [a.organization_id, (page - 1) * 25],
          )
        ).rows,
        page,
        delivery: "MANUAL",
        billing:
          "Click-to-chat prepares a message. WhatsApp Business API automation requires separate activation and provider charges.",
      };
    }),
  );
  app.post("/api/members/:id/whatsapp", (req) =>
    run(req, "whatsapp", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "members");
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = z
          .object({
            type: z.enum(["WELCOME", "EXPIRING", "EXPIRED", "PENDING"]),
          })
          .strict()
          .parse(req.body);
      const m = await one(
        tx,
        "SELECT name,phone FROM members WHERE id=$1 AND organization_id=$2",
        [id, a.organization_id],
      );
      if (!m) fail(404, "Member not found.");
      let phone = m.phone.replace(/\D/g, "");
      if (phone.length === 10) phone = "91" + phone;
      if (!/^[1-9][0-9]{7,14}$/.test(phone))
        fail(
          400,
          "Update the member phone number with its international country code.",
        );
      let message = "";
      if (p.type === "PENDING") {
        authorize(a, "payments");
        await entitlement(tx, a.organization_id!, "payments");
        const rows = (
          await tx.query(
            balanceSQL +
              " WHERE s.organization_id=$1 AND s.member_id=$2 ORDER BY s.starts_on DESC LIMIT 100",
            [a.organization_id, id],
          )
        ).rows.filter((r) => Number(r.pending_paise) > 0);
        if (!rows.length) fail(409, "There are no pending payments.");
        const money = (v: unknown) => `INR ${(Number(v) / 100).toFixed(2)}`;
        message =
          `Hello ${m.name}, your pending membership payments:\n` +
          rows
            .map(
              (r) =>
                `${r.plan}: total ${money(r.fee_paise)}, paid ${money(r.paid_paise)}, pending ${money(r.pending_paise)}. Deadline: ${r.payment_deadline ? String(r.payment_deadline).slice(0, 10) : "Contact the gym"}.`,
            )
            .join("\n");
      } else {
        const s = await one(
          tx,
          "SELECT starts_on,ends_on,(ends_on-CURRENT_DATE)::int AS days FROM memberships WHERE organization_id=$1 AND member_id=$2 AND status IN ('ACTIVE','TRIAL') ORDER BY ends_on DESC LIMIT 1",
          [a.organization_id, id],
        );
        if (!s) fail(409, "No membership is available.");
        if (p.type === "EXPIRING" && s.days < 0)
          fail(409, "Membership has already expired.");
        if (p.type === "EXPIRED" && s.days >= 0)
          fail(409, "Membership has not expired.");
        message =
          p.type === "WELCOME"
            ? `Hello ${m.name}, welcome to your gym! Your membership runs from ${String(s.starts_on).slice(0, 10)} to ${String(s.ends_on).slice(0, 10)}.`
            : p.type === "EXPIRED"
              ? `Hello ${m.name}, your gym membership expired on ${String(s.ends_on).slice(0, 10)}. Please renew to continue your gym access.`
              : `Hello ${m.name}, your gym membership will expire in ${s.days} days. Please renew your membership to continue your gym access.`;
      }
      await audit(tx, a.organization_id, a.id, "whatsapp.prepared", id, {
        type: p.type,
      });
      return {
        message,
        url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
        status: "PREPARED",
        sent: false,
      };
    }),
  );
}
