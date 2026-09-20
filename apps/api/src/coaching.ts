import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, audit, type Executor } from "./db.js";
import { fail, type Actor } from "./security.js";
import { entitlement } from "./entitlements.js";
import type { Services } from "./app.js";
export const workoutInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    exercises: z
      .array(
        z
          .object({
            day: z.string().min(1).max(30),
            muscle_group: z.string().max(100).default(""),
            name: z.string().trim().min(1).max(100),
            sets: z.number().int().min(1).max(50),
            reps: z.string().min(1).max(30),
            weight: z.string().max(30).default(""),
            rest_seconds: z.number().int().min(0).max(3600).default(60),
            notes: z.string().max(500).default(""),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export async function checkAssignment(
  tx: Executor,
  a: Actor,
  memberId: string,
) {
  const m = await one(
    tx,
    "SELECT id FROM members WHERE id=$1 AND organization_id=$2",
    [memberId, a.organization_id],
  );
  if (!m) fail(404, "Member not found.");
  if (
    a.role === "TRAINER" &&
    !a.permission_overrides?.["trainer:all"] &&
    !(await one(
      tx,
      "SELECT t.id FROM trainer_assignments x JOIN trainers t ON t.id=x.trainer_id JOIN users u ON u.id=t.user_id WHERE x.organization_id=$1 AND x.member_id=$2 AND t.user_id=$3 AND t.active AND u.active",
      [a.organization_id, memberId, a.id],
    ))
  )
    fail(403, "This member is not assigned to you.");
}
export async function registerCoaching(
  app: FastifyInstance,
  { run }: Services,
) {
  app.put("/api/workouts/:id", (req) =>
    run(req, "workouts", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = workoutInput.parse(req.body);
      const row = await one(
        tx,
        "SELECT member_id FROM workouts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [id, a.organization_id],
      );
      if (!row) fail(404, "Workout not found.");
      await checkAssignment(tx, a, row.member_id);
      await tx.query(
        "UPDATE workouts SET name=$3,exercises=$4 WHERE id=$1 AND organization_id=$2",
        [id, a.organization_id, p.name, JSON.stringify(p.exercises)],
      );
      await audit(tx, a.organization_id, a.id, "workout.updated", id);
      return { ok: true };
    }),
  );
  app.get("/api/assigned-members/:id", (req) =>
    run(req, "assigned:read", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await checkAssignment(tx, a, id);
      return {
        member: await one(
          tx,
          "SELECT id,name,number FROM members WHERE id=$1 AND organization_id=$2",
          [id, a.organization_id],
        ),
        memberships: (
          await tx.query(
            "SELECT starts_on,ends_on,status FROM memberships WHERE member_id=$1 AND organization_id=$2 ORDER BY starts_on DESC LIMIT 25",
            [id, a.organization_id],
          )
        ).rows,
        attendance: a.features?.includes("attendance")
          ? (
              await tx.query(
                "SELECT checked_in_at,checked_out_at FROM attendance WHERE member_id=$1 AND organization_id=$2 ORDER BY checked_in_at DESC LIMIT 31",
                [id, a.organization_id],
              )
            ).rows
          : [],
      };
    }),
  );
  app.patch("/api/staff/:id/trainer-access", (req) =>
    run(req, "staff", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = z.object({ all_members: z.boolean() }).strict().parse(req.body);
      const row = await one(
        tx,
        "UPDATE users SET permission_overrides=jsonb_set(permission_overrides,'{trainer:all}',$3::jsonb) WHERE id=$1 AND organization_id=$2 AND role='TRAINER' RETURNING id",
        [id, a.organization_id, JSON.stringify(p.all_members)],
      );
      if (!row) fail(404, "Trainer not found.");
      await audit(tx, a.organization_id, a.id, "trainer.access_changed", id, p);
      return { ok: true };
    }),
  );
  app.post("/api/member/workouts", (req) =>
    run(req, "self:read", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "member_workouts");
      await entitlement(tx, a.organization_id!, "workouts");
      const p = workoutInput.parse(req.body),
        m = await one(
          tx,
          "SELECT id FROM members WHERE user_id=$1 AND organization_id=$2 AND active",
          [a.id, a.organization_id],
        );
      if (!m) fail(403, "Member access is inactive.");
      const row = await one(
        tx,
        "INSERT INTO workouts(organization_id,member_id,name,exercises,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [a.organization_id, m.id, p.name, JSON.stringify(p.exercises), a.id],
      );
      await audit(tx, a.organization_id, a.id, "workout.created", row.id);
      return row;
    }),
  );
  app.put("/api/member/workouts/:id", (req) =>
    run(req, "self:read", async (tx, a) => {
      await entitlement(tx, a.organization_id!, "member_workouts");
      await entitlement(tx, a.organization_id!, "workouts");
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        p = workoutInput.parse(req.body);
      const row = await one(
        tx,
        "UPDATE workouts w SET name=$4,exercises=$5 WHERE w.id=$1 AND w.organization_id=$2 AND w.created_by=$3 AND EXISTS(SELECT 1 FROM members m WHERE m.id=w.member_id AND m.organization_id=$2 AND m.user_id=$3 AND m.active) RETURNING id",
        [id, a.organization_id, a.id, p.name, JSON.stringify(p.exercises)],
      );
      if (!row) fail(404, "Your own workout was not found.");
      await audit(tx, a.organization_id, a.id, "workout.updated", id);
      return { ok: true };
    }),
  );
}
