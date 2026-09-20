import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  connectDatabase,
  migrate,
  context,
  one,
  type Database,
} from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword, token } from "../src/security.js";
import { portals, homeForRole } from "../../shared/access.js";
process.env.NODE_ENV = "test";
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  org: string,
  foreignOrg: string,
  firstMember: string,
  secondMember: string,
  foreignMember: string,
  inviteMember: string;
const password = "Portal-tests-only-9876!";
const roles = [
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
  "RECEPTIONIST",
  "TRAINER",
  "MEMBER",
];
const sessions: Record<string, any> = {};
let address = 1;
async function login(
  role: string,
  endpoint: string,
  email = `${role.toLowerCase()}@portal.test`,
) {
  return app.inject({
    method: "POST",
    url: `/api${endpoint}`,
    payload: { email, password },
    remoteAddress: `10.20.0.${address++}`,
  });
}
async function request(
  role: string,
  url: string,
  method: any = "GET",
  payload?: any,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      cookie: sessions[role]?.cookie ?? "",
      "x-csrf-token": sessions[role]?.csrf ?? "",
    },
  });
}
before(async () => {
  db = await connectDatabase(undefined, true);
  await migrate(db);
  const hash = await hashPassword(password);
  await context(db, null, true, async (tx) => {
    for (const [slug, foreign] of [
      ["portal-gym", false],
      ["foreign-gym", true],
    ] as const) {
      const gym = await one(
        tx,
        "INSERT INTO organizations(name,slug,email) VALUES($1,$1,$2) RETURNING id",
        [slug, `${slug}@example.test`],
      );
      if (foreign) foreignOrg = gym.id;
      else org = gym.id;
      const branch = await one(
        tx,
        "INSERT INTO branches(organization_id,name) VALUES($1,'Main') RETURNING id",
        [gym.id],
      );
      await tx.query(
        "INSERT INTO subscriptions(organization_id,plan_id,status,renews_at) VALUES($1,'BUSINESS','ACTIVE',now()+interval '30 days')",
        [gym.id],
      );
      for (const role of foreign ? ["MEMBER"] : roles) {
        const user = await one(
          tx,
          "INSERT INTO users(name,email,role,organization_id,branch_id,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [
            `${role} Person`,
            foreign
              ? "foreign@portal.test"
              : `${role.toLowerCase()}@portal.test`,
            role,
            role === "SUPER_ADMIN" ? null : gym.id,
            role === "SUPER_ADMIN" ? null : branch.id,
            hash,
          ],
        );
        if (role === "MEMBER") {
          const m = await one(
            tx,
            "INSERT INTO members(organization_id,branch_id,name,phone,email,qr_token,user_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
            [
              gym.id,
              branch.id,
              foreign ? "Foreign Member" : "My Member",
              "9000000000",
              foreign ? "foreign@portal.test" : "member@portal.test",
              token(),
              user.id,
              "PRIVATE STAFF NOTES",
            ],
          );
          if (foreign) foreignMember = m.id;
          else firstMember = m.id;
          await tx.query(
            "INSERT INTO workouts(organization_id,member_id,name,exercises,created_by) VALUES($1,$2,$3,$4,$5)",
            [
              gym.id,
              m.id,
              foreign ? "Foreign workout" : "My workout",
              "[]",
              user.id,
            ],
          );
        }
      }
      if (!foreign) {
        const u = await one(
          tx,
          "INSERT INTO users(name,email,role,organization_id,branch_id,password_hash) VALUES('Another member','second@portal.test','MEMBER',$1,$2,$3) RETURNING id",
          [org, branch.id, hash],
        );
        const m = await one(
          tx,
          "INSERT INTO members(organization_id,branch_id,name,phone,qr_token,user_id) VALUES($1,$2,'Another Member','9000000001',$3,$4) RETURNING id",
          [org, branch.id, token(), u.id],
        );
        secondMember = m.id;
        await tx.query(
          "INSERT INTO workouts(organization_id,member_id,name,exercises,created_by) VALUES($1,$2,'Private other workout','[]',$3)",
          [org, secondMember, u.id],
        );
        inviteMember = (
          await one(
            tx,
            "INSERT INTO members(organization_id,branch_id,name,phone,email,qr_token) VALUES($1,$2,'Invite Me','9000000002','invite@portal.test',$3) RETURNING id",
            [org, branch.id, token()],
          )
        ).id;
      }
    }
  });
  app = await createApp(db);
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("all six roles can only sign in through their correct one of four portals", async () => {
  for (const portal of Object.values(portals))
    for (const role of roles) {
      const result = await login(role, portal.endpoint);
      const allowed = (portal.roles as readonly string[]).includes(role);
      assert.equal(
        result.statusCode,
        allowed ? 200 : 401,
        `${role} on ${portal.title}: ${result.body}`,
      );
      if (allowed)
        sessions[role] = {
          cookie: result.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
          csrf: result.json().user.csrf_token,
        };
    }
  for (const role of [
    "TRAINER",
    "RECEPTIONIST",
    "MANAGER",
    "MEMBER",
    "SUPER_ADMIN",
  ])
    assert.equal((await login(role, "/auth/login")).statusCode, 401);
  assert.equal(homeForRole("MEMBER"), "/member/dashboard");
  assert.equal(homeForRole("TRAINER"), "/workouts");
});
test("member pages expose only the linked member and exclude staff-private profile fields", async () => {
  const dashboard = await request("MEMBER", "/api/member/dashboard");
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  assert.equal(dashboard.json().member.id, firstMember);
  assert(!dashboard.body.includes("PRIVATE STAFF NOTES"));
  assert(!dashboard.body.includes("qr_token"));
  const workouts = await request("MEMBER", "/api/member/workouts");
  assert.equal(workouts.json().items.length, 1);
  assert.equal(workouts.json().items[0].name, "My workout");
  for (const section of [
    "membership",
    "attendance",
    "progress",
    "payments",
    "appointments",
  ])
    assert.equal(
      (await request("MEMBER", `/api/member/${section}`)).statusCode,
      200,
    );
  const qr = await request("MEMBER", "/api/member/qr");
  assert.match(qr.json().qr, /^data:image\/png;base64,/);
  for (const id of [secondMember, foreignMember]) {
    assert.equal(
      (await request("MEMBER", `/api/member/workouts?member_id=${id}`))
        .statusCode,
      400,
    );
    assert.equal(
      (await request("MEMBER", `/api/members/${id}`)).statusCode,
      403,
    );
  }
  assert.equal((await request("MEMBER", "/api/payments")).statusCode, 403);
  assert.equal((await request("MEMBER", "/api/admin/gyms")).statusCode, 403);
  assert.equal(
    (await request("MEMBER", "/api/member/workouts?page=0")).statusCode,
    400,
  );
});
test("staff, owner and platform sessions cannot use member self-service routes", async () => {
  for (const role of roles.filter((r) => r !== "MEMBER"))
    assert.equal(
      (await request(role, "/api/member/dashboard")).statusCode,
      403,
    );
});
test("member identity remains isolated across organizations", async () => {
  const result = await login(
    "MEMBER",
    portals.member.endpoint,
    "foreign@portal.test",
  );
  assert.equal(result.statusCode, 200, result.body);
  const response = await app.inject({
    url: "/api/member/workouts",
    headers: {
      cookie: result.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().items[0].name, "Foreign workout");
});
test("member account deactivation and feature restrictions are checked on every read", async () => {
  await context(db, org, false, (tx) =>
    tx.query("UPDATE members SET active=false WHERE id=$1", [firstMember]),
  );
  assert.equal(
    (await request("MEMBER", "/api/member/dashboard")).statusCode,
    403,
  );
  await context(db, org, false, async (tx) => {
    await tx.query("UPDATE members SET active=true WHERE id=$1", [firstMember]);
    await tx.query(
      "UPDATE subscriptions SET plan_id='BASIC' WHERE organization_id=$1",
      [org],
    );
  });
  assert.equal(
    (await request("MEMBER", "/api/member/dashboard")).statusCode,
    403,
  );
  await context(db, org, false, (tx) =>
    tx.query(
      "UPDATE subscriptions SET plan_id='BUSINESS' WHERE organization_id=$1",
      [org],
    ),
  );
  assert.equal(
    (await request("MEMBER", "/api/member/dashboard")).statusCode,
    200,
  );
});
test("member invitations reject unauthorized roles and foreign tenants, with no fake email success", async () => {
  assert.equal(
    (
      await request(
        "TRAINER",
        `/api/members/${inviteMember}/portal-invitation`,
        "POST",
        {},
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "OWNER",
        `/api/members/${foreignMember}/portal-invitation`,
        "POST",
        {},
      )
    ).statusCode,
    404,
  );
  const host = process.env.SMTP_HOST,
    from = process.env.EMAIL_FROM;
  delete process.env.SMTP_HOST;
  try {
    assert.equal(
      (
        await request(
          "OWNER",
          `/api/members/${inviteMember}/portal-invitation`,
          "POST",
          {},
        )
      ).statusCode,
      503,
    );
    process.env.SMTP_HOST = "unused.test";
    process.env.EMAIL_FROM = "invites@example.test";
    const result = await request(
      "OWNER",
      `/api/members/${inviteMember}/portal-invitation`,
      "POST",
      {},
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().status, "QUEUED");
    const record = await context(db, org, false, (tx) =>
      one(
        tx,
        "SELECT u.role,u.organization_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.id=$1",
        [inviteMember],
      ),
    );
    assert.equal(record.role, "MEMBER");
    assert.equal(record.organization_id, org);
    assert.equal(
      (
        await request(
          "OWNER",
          `/api/members/${inviteMember}/portal-invitation`,
          "POST",
          {},
        )
      ).statusCode,
      409,
    );
  } finally {
    if (host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = host;
    if (from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = from;
  }
});
