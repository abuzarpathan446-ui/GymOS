import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { context, one, audit, type Database, type Executor } from "./db.js";
import {
  authorize,
  digest,
  fail,
  hashPassword,
  passwordSchema,
  publicActor,
  token,
  verifyPassword,
  type Actor,
  HttpError,
} from "./security.js";
import { registerBusiness } from "./business.js";
import { registerPlatform } from "./platform.js";
import {registerOwnerPayments} from './owner-payments.js';
import { registerOperations } from "./operations.js";
import { portals } from "../../shared/access.js";
import { registerMemberPortal } from "./member-portal.js";
import { accessPolicy, entitlement } from "./entitlements.js";
import { permissionFeature } from "../../shared/policy.js";
import { registerAccessManagement } from "./access-management.js";
import { registerFinances } from "./finances.js";
import { registerCoaching } from "./coaching.js";
import { registerWhatsApp } from "./whatsapp.js";
import { registerMemberPhoto } from "./member-photo.js";
import { endSessions } from "./access-management.js";
import { allowedOrigins } from './origins.js';

const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
const uuid = z.uuid();
export interface Services {
  db: Database;
  actor: (req: FastifyRequest) => Promise<Actor>;
  run: <T>(
    req: FastifyRequest,
    permission: string,
    fn: (tx: Executor, a: Actor) => Promise<T>,
  ) => Promise<T>;
}
export async function createApp(db: Database) {
  const trustedOrigins = allowedOrigins();
  const app = Fastify({
    logger:
      process.env.NODE_ENV !== "test"
        ? {
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "password",
              "token",
            ],
          }
        : false,
    trustProxy: process.env.TRUST_PROXY === "true",
    bodyLimit: 262144,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api")) reply.header("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        origin &&
        !trustedOrigins.has(origin)
      )
        fail(403, "Request origin is not allowed.");
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as any;
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        error: "Please check the submitted fields.",
        fields: e.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (e.code === "23505") {
      const field=e.constraint==='organizations_slug_key'?'slug':e.constraint==='users_email_key'?'email':null;
      if(field)return reply.code(409).send({error:'Please correct the highlighted field.',fields:[{path:field,message:field==='slug'?'This Gym ID is already in use. Choose a different one.':'This email is already used by an account. Use a different email.'}]});
      return reply.code(409).send({
        error:
          "This record already exists or conflicts with another operation.",
      });
    }
    if (["23503", "23514", "22P02"].includes(e.code))
      return reply
        .code(400)
        .send({ error: "Invalid record or related record." });
    const status =
      e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status === 500) req.log.error({ err: e }, "Request failed");
    reply.code(status).send({
      error:
        status >= 500 && !(e instanceof HttpError)
          ? "Something went wrong. Please retry."
          : e.message,
    });
  });
  const actor = async (req: FastifyRequest): Promise<Actor> => {
    const raw = req.cookies.gymos_session;
    if (!raw) fail(401, "Please sign in.");
    const a = await one<Actor>(
      db,
      `SELECT u.id,u.organization_id,u.branch_id,u.name,u.email,u.role,u.permission_overrides,s.csrf_token,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND NOT u.suspended`,
      [digest(raw)],
    );
    if (!a) fail(401, "Your session has expired. Please sign in.");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers["x-csrf-token"] !== a.csrf_token
    )
      fail(403, "Invalid security token. Refresh and retry.");
    if (a.organization_id)
      a.features = await context(db, a.organization_id, false, async (tx) => {
        const org = await one(
          tx,
          "SELECT status FROM organizations WHERE id=$1",
          [a.organization_id],
        );
        if (org?.status !== "ACTIVE")
          fail(403, "Your organization is suspended. Contact support.");
        return (await accessPolicy(tx, a.organization_id!)).features;
      });
    return a;
  };
  const run: Services["run"] = async (req, permission, fn) => {
    const a = await actor(req);
    authorize(a, permission);
    return context(
      db,
      a.organization_id,
      a.role === "SUPER_ADMIN",
      async (tx) => {
        if (a.organization_id) {
          const org = await one(
            tx,
            "SELECT status FROM organizations WHERE id=$1",
            [a.organization_id],
          );
          if (!org || org.status !== "ACTIVE")
            fail(403, "Your organization is suspended. Contact support.");
          const feature = permissionFeature[permission];
          if (feature) {
            if (req.method === "GET") {
              if (
                !(await accessPolicy(tx, a.organization_id)).features.includes(
                  feature,
                )
              )
                fail(
                  403,
                  `${feature.replaceAll("_", " ")} is unavailable. Please contact the Super Admin.`,
                );
            } else await entitlement(tx, a.organization_id, feature);
          }
        }
        return fn(tx, a);
      },
    );
  };
  const service = { db, actor, run };
  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", database: "ok" };
    } catch {
      return reply
        .code(503)
        .send({ status: "unhealthy", database: "unavailable" });
    }
  });
  const dummy = await hashPassword(token());
  for (const portal of [
    ...Object.values(portals),
    { ...portals.owner, endpoint: "/auth/login" },
  ])
    app.post(
      `/api${portal.endpoint}`,
      { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
      async (req, reply) => {
        const input = loginSchema.parse(req.body);
        const user = await one(db, "SELECT * FROM users WHERE email=$1", [
          input.email,
        ]);
        const matches = await verifyPassword(
          input.password,
          user?.password_hash ?? dummy,
        );
        if (
          !user ||
          !matches ||
          !user.active ||
          user.suspended ||
          !(portal.roles as readonly string[]).includes(user.role)
        )
          fail(401, "Email or password is incorrect.");
        if (user.organization_id)
          await context(db, user.organization_id, false, async (tx) => {
            const org = await one(
              tx,
              "SELECT status FROM organizations WHERE id=$1",
              [user.organization_id],
            );
            if (org?.status !== "ACTIVE")
              fail(403, "Your organization is suspended. Contact support.");
          });
        const raw = token(),
          csrf = token();
        await context(
          db,
          user.organization_id,
          user.role === "SUPER_ADMIN",
          async (tx) => {
            const current = await one(
              tx,
              "SELECT active,suspended FROM users WHERE id=$1 FOR UPDATE",
              [user.id],
            );
            if (!current?.active || current.suspended)
              fail(401, "This account is inactive.");
            await tx.query(
              "UPDATE login_history SET logged_out_at=LEAST(now(),expires_at),end_reason='NEW_LOGIN' WHERE user_id=$1 AND logged_out_at IS NULL",
              [user.id],
            );
            await tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
            await tx.query(
              "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+($4||' hours')::interval)",
              [
                digest(raw),
                user.id,
                csrf,
                String(Number(process.env.SESSION_HOURS) || 12),
              ],
            );
            await tx.query(
              "INSERT INTO login_history(organization_id,user_id,role,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+($5||' hours')::interval)",
              [
                user.organization_id,
                user.id,
                user.role,
                digest(raw),
                String(Number(process.env.SESSION_HOURS) || 12),
              ],
            );
            await audit(
              tx,
              user.organization_id,
              user.id,
              "auth.login",
              user.id,
              { portal: portal.endpoint },
            );
            if (user.organization_id)
              user.features = (
                await accessPolicy(tx, user.organization_id)
              ).features;
          },
        );
        reply.setCookie("gymos_session", raw, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: (Number(process.env.SESSION_HOURS) || 12) * 3600,
        });
        return { user: publicActor({ ...user, csrf_token: csrf }) };
      },
    );
  app.get("/api/auth/me", async (req) => ({
    user: publicActor(await actor(req)),
  }));
  app.post("/api/auth/logout", async (req, reply) => {
    const a = await actor(req);
    await context(
      db,
      a.organization_id,
      a.role === "SUPER_ADMIN",
      async (tx) => {
        await tx.query(
          "UPDATE login_history SET logged_out_at=LEAST(now(),expires_at),end_reason='LOGOUT' WHERE session_hash=$1 AND logged_out_at IS NULL",
          [a.token_hash],
        );
        await tx.query("DELETE FROM sessions WHERE token_hash=$1", [
          a.token_hash,
        ]);
        await audit(tx, a.organization_id, a.id, "auth.logout", a.id);
      },
    );
    reply.clearCookie("gymos_session", { path: "/" });
    return { ok: true };
  });
  app.post(
    "/api/auth/forgot-password",
    { config: { rateLimit: { max: 4, timeWindow: "15 minutes" } } },
    async (req) => {
      const { email } = z
        .object({ email: z.email().transform((v) => v.toLowerCase()) })
        .strict()
        .parse(req.body);
      if (!process.env.SMTP_HOST)
        fail(
          503,
          "Password recovery email is not configured. Contact your administrator.",
        );
      const user = await one(
        db,
        "SELECT id,organization_id FROM users WHERE email=$1 AND active",
        [email],
      );
      if (user)
        await db.transaction(async (tx) => {
          const raw = token();
          await tx.query(
            "INSERT INTO access_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'RESET',now()+interval '30 minutes')",
            [digest(raw), user.id],
          );
          await tx.query(
            "INSERT INTO outbox(organization_id,kind,payload) VALUES($1,'EMAIL',$2)",
            [
              user.organization_id,
              JSON.stringify({
                to: email,
                subject: "Reset your GymOS password",
                text: `Reset your password: ${process.env.APP_ORIGIN}/reset-password#${raw}`,
              }),
            ],
          );
        });
      return {
        message: "If the account exists, a recovery email has been queued.",
      };
    },
  );
  app.post(
    "/api/auth/reset-password",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (req) => {
      const input = z
        .object({
          token: z.string().min(30).max(100),
          password: passwordSchema,
        })
        .strict()
        .parse(req.body);
      const password = await hashPassword(input.password);
      await db.transaction(async (tx) => {
        const access = await one(
          tx,
          "SELECT * FROM access_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND purpose IN ('INVITE','RESET','SETUP') FOR UPDATE",
          [digest(input.token)],
        );
        if (!access) fail(400, "This link is invalid or expired.");
        await tx.query(
          "UPDATE users SET password_hash=$1,verified_at=CASE WHEN $3='SETUP' THEN verified_at ELSE now() END WHERE id=$2 AND active",
          [password, access.user_id, access.purpose],
        );
        await tx.query(
          "UPDATE access_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
          [access.user_id],
        );
        const resetUser = await one(
          tx,
          "SELECT organization_id,role FROM users WHERE id=$1",
          [access.user_id],
        );
        await tx.query(
          "SELECT set_config('app.organization_id',$1,true),set_config('app.platform',$2,true)",
          [
            resetUser.organization_id ?? "",
            String(resetUser.role === "SUPER_ADMIN"),
          ],
        );
        await endSessions(tx, access.user_id, "PASSWORD_RESET");
        await audit(
          tx,
          resetUser.organization_id,
          access.user_id,
          "auth.password_reset",
          access.user_id,
        );
      });
      return { ok: true };
    },
  );
  app.get("/api/settings", (req) =>
    run(req, "settings", async (tx, a) => ({
      organization: await one(tx, "SELECT * FROM organizations WHERE id=$1", [
        a.organization_id,
      ]),
      branches: (
        await tx.query("SELECT * FROM branches WHERE organization_id=$1", [
          a.organization_id,
        ])
      ).rows,
    })),
  );
  app.patch("/api/settings", (req) =>
    run(req, "settings", async (tx, a) => {
      const p = z
        .object({
          name: z.string().min(2).max(150),
          phone: z.string().max(30),
          address: z.string().max(500),
          email: z.email(),
          inactive_days: z.number().int().min(1).max(365).default(14),
          reminder_days: z
            .array(z.number().int().min(0).max(90))
            .max(10)
            .default([30, 7, 3, 1, 0]),
        })
        .strict()
        .parse(req.body);
      await tx.query(
        "UPDATE organizations SET name=$1,phone=$2,address=$3,email=$4,settings=settings || $5::jsonb WHERE id=$6",
        [
          p.name,
          p.phone,
          p.address,
          p.email,
          JSON.stringify({
            inactive_days: p.inactive_days,
            reminder_days: p.reminder_days,
          }),
          a.organization_id,
        ],
      );
      await audit(
        tx,
        a.organization_id,
        a.id,
        "settings.updated",
        a.organization_id!,
      );
      return { ok: true };
    }),
  );
  app.get("/api/audit-logs", (req) =>
    run(req, "audit", async (tx, a) => ({
      items: (
        await tx.query(
          "SELECT action,resource_id,metadata,created_at FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100",
          [a.organization_id],
        )
      ).rows,
    })),
  );
  await registerBusiness(app, service);
  await registerPlatform(app, service);
  await registerOwnerPayments(app,service);
  await registerOperations(app, service);
  await registerMemberPortal(app, service);
  await registerAccessManagement(app, service);
  await registerFinances(app, service);
  await registerCoaching(app, service);
  await registerWhatsApp(app, service);
  await registerMemberPhoto(app, service);
  return app;
}
