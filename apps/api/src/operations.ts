import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "./app.js";
import { audit, one, type Executor } from "./db.js";
import { fail, authorize, type Actor } from "./security.js";
import { entitlement } from "./entitlements.js";
import { workoutInput, checkAssignment } from "./coaching.js";
const idSchema = z.object({ id: z.uuid() });
const assigned = checkAssignment;
export async function registerOperations(
  app: FastifyInstance,
  { run }: Services,
) {
  app.get("/api/leads", (req) =>
    run(req, "leads", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "leads");
      return {
        items: (
          await tx.query(
            "SELECT * FROM leads WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
            [a.organization_id],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/leads", (req) =>
    run(req, "leads", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(150),
          phone: z.string().min(7).max(30),
          source: z.string().max(80).default("Walk-in"),
          notes: z.string().max(2000).default(""),
          follow_up_on: z.iso.date().nullable().default(null),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "leads");
      const row = await one(
        tx,
        "INSERT INTO leads(organization_id,name,phone,source,notes,follow_up_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [a.organization_id, p.name, p.phone, p.source, p.notes, p.follow_up_on],
      );
      await audit(tx, a.organization_id, a.id, "lead.created", row.id);
      return { lead: row };
    }),
  );
  app.patch("/api/leads/:id", (req) =>
    run(req, "leads", async (tx, a) => {
      const { id } = idSchema.parse(req.params),
        p = z
          .object({
            status: z.enum([
              "NEW",
              "CONTACTED",
              "VISITED",
              "TRIAL",
              "CONVERTED",
            ]),
            member_id: z.uuid().optional(),
          })
          .strict()
          .parse(req.body);
      await entitlement(tx, a.organization_id!, "leads");
      if (p.status === "CONVERTED" && !p.member_id)
        fail(400, "Select the registered member to record conversion.");
      if (p.member_id) await assigned(tx, a, p.member_id);
      const row = await one(
        tx,
        "UPDATE leads SET status=$1,member_id=$2 WHERE id=$3 AND organization_id=$4 RETURNING id",
        [p.status, p.member_id ?? null, id, a.organization_id],
      );
      if (!row) fail(404, "Lead not found.");
      await audit(tx, a.organization_id, a.id, "lead.updated", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/trainers", (req) =>
    run(req, "appointments", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "trainers");
      return {
        items: (
          await tx.query(
            "SELECT t.id,t.specialization,t.active,u.name,(SELECT count(*)::int FROM trainer_assignments x WHERE x.trainer_id=t.id) AS assigned_members FROM trainers t JOIN users u ON u.id=t.user_id WHERE t.organization_id=$1 AND ($2<>'TRAINER' OR t.user_id=$3) ORDER BY u.name",
            [a.organization_id, a.role, a.id],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/trainers/:id/assign", (req) =>
    run(req, "trainers", async (tx, a) => {
      const { id } = idSchema.parse(req.params),
        p = z.object({ member_id: z.uuid() }).strict().parse(req.body);
      await entitlement(tx, a.organization_id!, "trainers");
      await assigned(tx, a, p.member_id);
      if (
        !(await one(
          tx,
          "SELECT id FROM trainers WHERE id=$1 AND organization_id=$2 AND active",
          [id, a.organization_id],
        ))
      )
        fail(404, "Trainer not found.");
      await tx.query(
        "INSERT INTO trainer_assignments(organization_id,trainer_id,member_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [a.organization_id, id, p.member_id],
      );
      await audit(tx, a.organization_id, a.id, "trainer.assigned", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/assigned-members", (req) =>
    run(req, "assigned:read", async (tx, a) => ({
      items: (
        await tx.query(
          "SELECT m.id,m.name,m.number FROM members m WHERE m.organization_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM trainer_assignments x JOIN trainers t ON t.id=x.trainer_id WHERE x.member_id=m.id AND t.user_id=$2)) ORDER BY m.name LIMIT 100",
          [a.organization_id, a.id, !!a.permission_overrides?.["trainer:all"]],
        )
      ).rows,
    })),
  );
  app.get("/api/workouts", (req) =>
    run(req, "workouts", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "workouts");
      return {
        items: (
          await tx.query(
            `SELECT w.*,m.name AS member_name FROM workouts w JOIN members m ON m.id=w.member_id WHERE w.organization_id=$1 AND ($2<>'TRAINER' OR $4::boolean OR EXISTS(SELECT 1 FROM trainer_assignments x JOIN trainers t ON t.id=x.trainer_id WHERE x.member_id=w.member_id AND t.user_id=$3)) ORDER BY w.created_at DESC LIMIT 100`,
            [
              a.organization_id,
              a.role,
              a.id,
              !!a.permission_overrides?.["trainer:all"],
            ],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/workouts", (req) =>
    run(req, "workouts", async (tx, a) => {
      const p = workoutInput.extend({ member_id: z.uuid() }).parse(req.body);
      await entitlement(tx, a.organization_id!, "workouts");
      await assigned(tx, a, p.member_id);
      const row = await one(
        tx,
        "INSERT INTO workouts(organization_id,member_id,name,exercises,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          a.organization_id,
          p.member_id,
          p.name,
          JSON.stringify(p.exercises),
          a.id,
        ],
      );
      await audit(tx, a.organization_id, a.id, "workout.created", row.id);
      return row;
    }),
  );
  app.get("/api/progress", (req) =>
    run(req, "progress", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "progress");
      return {
        items: (
          await tx.query(
            `SELECT b.*,m.name AS member_name FROM body_measurements b JOIN members m ON m.id=b.member_id WHERE b.organization_id=$1 AND ($2<>'TRAINER' OR $4::boolean OR EXISTS(SELECT 1 FROM trainer_assignments x JOIN trainers t ON t.id=x.trainer_id WHERE x.member_id=b.member_id AND t.user_id=$3)) ORDER BY b.measured_on DESC LIMIT 100`,
            [
              a.organization_id,
              a.role,
              a.id,
              !!a.permission_overrides?.["trainer:all"],
            ],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/progress", (req) =>
    run(req, "progress", async (tx, a) => {
      const p = z
        .object({
          member_id: z.uuid(),
          weight_kg: z.number().positive().max(600),
          height_cm: z.number().positive().max(300),
          body_fat: z.number().min(0).max(100).nullable().default(null),
          measured_on: z.iso.date(),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "progress");
      await assigned(tx, a, p.member_id);
      const row = await one(
        tx,
        "INSERT INTO body_measurements(organization_id,member_id,weight_kg,height_cm,body_fat,measured_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          a.organization_id,
          p.member_id,
          p.weight_kg,
          p.height_cm,
          p.body_fat,
          p.measured_on,
        ],
      );
      await audit(tx, a.organization_id, a.id, "progress.recorded", row.id);
      return row;
    }),
  );
  app.get("/api/appointments", (req) =>
    run(req, "appointments", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "appointments");
      return {
        items: (
          await tx.query(
            `SELECT p.*,m.name AS member_name,u.name AS trainer_name FROM appointments p JOIN members m ON m.id=p.member_id JOIN trainers t ON t.id=p.trainer_id JOIN users u ON u.id=t.user_id WHERE p.organization_id=$1 AND ($2<>'TRAINER' OR t.user_id=$3) ORDER BY p.starts_at DESC LIMIT 100`,
            [a.organization_id, a.role, a.id],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/appointments", (req) =>
    run(req, "appointments", async (tx, a) => {
      const p = z
        .object({
          member_id: z.uuid(),
          trainer_id: z.uuid(),
          starts_at: z.iso.datetime(),
          ends_at: z.iso.datetime(),
          notes: z.string().max(1000).default(""),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "appointments");
      await assigned(tx, a, p.member_id);
      if (new Date(p.ends_at) <= new Date(p.starts_at))
        fail(400, "End time must be after start time.");
      const t = await one(
        tx,
        "SELECT * FROM trainers WHERE id=$1 AND organization_id=$2 AND active FOR UPDATE",
        [p.trainer_id, a.organization_id],
      );
      if (!t) fail(404, "Trainer not found.");
      if (a.role === "TRAINER" && t.user_id !== a.id)
        fail(403, "You may only book your own sessions.");
      await tx.query(
        "SELECT id FROM members WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [p.member_id, a.organization_id],
      );
      if (
        await one(
          tx,
          "SELECT id FROM appointments WHERE organization_id=$1 AND (trainer_id=$2 OR member_id=$3) AND status='SCHEDULED' AND starts_at<$5::timestamptz AND ends_at>$4::timestamptz",
          [
            a.organization_id,
            p.trainer_id,
            p.member_id,
            p.starts_at,
            p.ends_at,
          ],
        )
      )
        fail(
          409,
          "Trainer or member already has an appointment during this time.",
        );
      const row = await one(
        tx,
        "INSERT INTO appointments(organization_id,member_id,trainer_id,starts_at,ends_at,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          a.organization_id,
          p.member_id,
          p.trainer_id,
          p.starts_at,
          p.ends_at,
          p.notes,
        ],
      );
      await audit(tx, a.organization_id, a.id, "appointment.created", row.id);
      return row;
    }),
  );
  app.patch("/api/appointments/:id", (req) =>
    run(req, "appointments", async (tx, a) => {
      const { id } = idSchema.parse(req.params),
        p = z
          .object({ status: z.enum(["COMPLETED", "CANCELLED"]) })
          .strict()
          .parse(req.body);
      await entitlement(tx, a.organization_id!, "appointments");
      const row = await one(
        tx,
        "UPDATE appointments p SET status=$1 WHERE p.id=$2 AND p.organization_id=$3 AND ($4<>'TRAINER' OR EXISTS(SELECT 1 FROM trainers t WHERE t.id=p.trainer_id AND t.user_id=$5)) RETURNING id",
        [p.status, id, a.organization_id, a.role, a.id],
      );
      if (!row) fail(404, "Appointment not found.");
      await audit(tx, a.organization_id, a.id, "appointment.updated", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/inventory", (req) =>
    run(req, "inventory", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "inventory");
      return {
        items: (
          await tx.query(
            "SELECT * FROM inventory WHERE organization_id=$1 ORDER BY name LIMIT 100",
            [a.organization_id],
          )
        ).rows,
      };
    }),
  );
  app.post("/api/inventory", (req) =>
    run(req, "inventory", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(150),
          sku: z.string().min(1).max(80),
          category: z.string().max(80).default(""),
          minimum_stock: z.number().int().min(0),
          purchase_paise: z.number().int().min(0),
          selling_paise: z.number().int().min(0),
          supplier: z.string().max(150).default(""),
        })
        .strict()
        .parse(req.body);
      await entitlement(tx, a.organization_id!, "inventory");
      const row = await one(
        tx,
        "INSERT INTO inventory(organization_id,name,sku,category,minimum_stock,purchase_paise,selling_paise,supplier) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [
          a.organization_id,
          p.name,
          p.sku,
          p.category,
          p.minimum_stock,
          p.purchase_paise,
          p.selling_paise,
          p.supplier,
        ],
      );
      await audit(tx, a.organization_id, a.id, "inventory.created", row.id);
      return row;
    }),
  );
  app.post("/api/inventory/:id/stock", (req) =>
    run(req, "inventory", async (tx, a) => {
      const { id } = idSchema.parse(req.params),
        p = z
          .object({
            delta: z
              .number()
              .int()
              .min(-100000)
              .max(100000)
              .refine((v) => v !== 0),
            reason: z.string().min(3).max(200),
          })
          .strict()
          .parse(req.body);
      await entitlement(tx, a.organization_id!, "inventory");
      const row = await one(
        tx,
        "UPDATE inventory SET quantity=quantity+$1 WHERE id=$2 AND organization_id=$3 AND quantity+$1>=0 RETURNING id",
        [p.delta, id, a.organization_id],
      );
      if (!row) fail(409, "Item not found or insufficient stock.");
      await tx.query(
        "INSERT INTO inventory_transactions(organization_id,inventory_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
        [a.organization_id, id, p.delta, p.reason, a.id],
      );
      await audit(tx, a.organization_id, a.id, "inventory.adjusted", id, p);
      return { ok: true };
    }),
  );
  app.get("/api/notifications", (req) =>
    run(req, "notifications", async (tx, a) => ({
      items: (
        await tx.query(
          "SELECT * FROM notifications WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
          [a.organization_id],
        )
      ).rows,
    })),
  );
  app.post("/api/notifications/:id/read", (req) =>
    run(req, "notifications", async (tx, a) => {
      await tx.query(
        "UPDATE notifications SET read_at=now() WHERE id=$1 AND organization_id=$2",
        [idSchema.parse(req.params).id, a.organization_id],
      );
      return { ok: true };
    }),
  );
  app.get("/api/reports", (req) =>
    run(req, "reports", async (tx, a) => {
      const p = z
        .object({ from: z.iso.date(), to: z.iso.date() })
        .parse(req.query);
      if (
        !a.features?.includes("payments") ||
        !a.features?.includes("attendance")
      )
        fail(403, "Report data is locked. Contact the Super Admin.");
      if (p.to < p.from) fail(400, "Invalid date range.");
      authorize(a, "payments");
      authorize(a, "attendance");
      return {
        revenue: (
          await tx.query(
            "SELECT method,count(*)::int AS payments,sum(amount_paise)::bigint AS revenue FROM payments WHERE organization_id=$1 AND status='COMPLETED' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date GROUP BY method",
            [a.organization_id, p.from, p.to],
          )
        ).rows,
        attendance: (
          await tx.query(
            "SELECT (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date AS day,count(*)::int AS visits FROM attendance WHERE organization_id=$1 AND (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date GROUP BY day ORDER BY day",
            [a.organization_id, p.from, p.to],
          )
        ).rows,
      };
    }),
  );
  app.get("/api/reports/:kind/csv", async (req, reply) => {
    const result = await run(req, "reports", async (tx, a) => {
      const { kind } = z
        .object({ kind: z.enum(["members", "payments", "attendance"]) })
        .parse(req.params);
      const queries = {
        members:
          "SELECT number,name,phone,email,active,created_at FROM members WHERE organization_id=$1 ORDER BY number LIMIT 50000",
        payments:
          "SELECT id,member_id,amount_paise,method,status,created_at FROM payments WHERE organization_id=$1 ORDER BY created_at LIMIT 50000",
        attendance:
          "SELECT member_id,checked_in_at,checked_out_at FROM attendance WHERE organization_id=$1 ORDER BY checked_in_at LIMIT 50000",
      };
      if (!a.features?.includes(kind))
        fail(403, "This export is locked. Contact the Super Admin.");
      authorize(a, kind === "members" ? "members:read" : kind);
      const rows = (await tx.query(queries[kind], [a.organization_id])).rows;
      await audit(tx, a.organization_id, a.id, "data.exported", kind);
      return { kind, rows };
    });
    const escape = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const keys = Object.keys(result.rows[0] ?? {});
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${result.kind}.csv"`,
      )
      .send(
        "\uFEFF" +
          [
            keys.map(escape).join(","),
            ...result.rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
          ].join("\r\n"),
      );
  });
}
