import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  connectDatabase,
  migrate,
  context,
  one,
  type Database,
} from "../src/db.js";
import { createApp } from "../src/app.js";
import {
  hashPassword,
  verifyPassword,
  token,
  digest,
} from "../src/security.js";
import { snapshot, restore } from "../src/backup.js";
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://localhost:5173";
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  orgA: string,
  orgB: string,
  branchA: string,
  branchB: string;
let owner: any,
  other: any,
  reception: any,
  trainer: any,
  memberUser: any,
  admin: any;
const password = "Test-only-password-582!";
let memberId: string, planId: string, payment: any;
async function request(
  auth: any,
  url: string,
  method: any = "GET",
  payload?: any,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      cookie: auth?.cookie ?? "",
      "x-csrf-token": auth?.csrf ?? "",
      origin: "http://localhost:5173",
    },
  });
}
async function login(email: string, platform = false) {
  const r = await app.inject({
    method: "POST",
    url: platform
      ? "/api/admin/auth/login"
      : ["r@example.test", "t@example.test"].includes(email)
        ? "/api/staff/auth/login"
        : email === "m@example.test"
          ? "/api/member/auth/login"
          : "/api/auth/login",
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrf: r.json().user.csrf_token,
    user: r.json().user,
  };
}
before(async () => {
  db = await connectDatabase(undefined, true);
  await migrate(db);
  const hash = await hashPassword(password);
  await context(db, null, true, async (tx) => {
    orgA = (
      await one(
        tx,
        "INSERT INTO organizations(name,slug,email) VALUES('Gym A','gym-a','a@example.test') RETURNING id",
      )
    ).id;
    orgB = (
      await one(
        tx,
        "INSERT INTO organizations(name,slug,email) VALUES('Gym B','gym-b','b@example.test') RETURNING id",
      )
    ).id;
    branchA = (
      await one(
        tx,
        "INSERT INTO branches(organization_id,name) VALUES($1,'Main') RETURNING id",
        [orgA],
      )
    ).id;
    branchB = (
      await one(
        tx,
        "INSERT INTO branches(organization_id,name) VALUES($1,'Main') RETURNING id",
        [orgB],
      )
    ).id;
    for (const org of [orgA, orgB])
      await tx.query(
        "INSERT INTO subscriptions(organization_id,plan_id,status,renews_at) VALUES($1,'BUSINESS','ACTIVE',now()+interval '30 days')",
        [org],
      );
    for (const [email, role, org, branch] of [
      ["a@example.test", "OWNER", orgA, branchA],
      ["b@example.test", "OWNER", orgB, branchB],
      ["r@example.test", "RECEPTIONIST", orgA, branchA],
      ["t@example.test", "TRAINER", orgA, branchA],
      ["m@example.test", "MEMBER", orgA, branchA],
      ["s@example.test", "SUPER_ADMIN", null, null],
    ])
      await tx.query(
        "INSERT INTO users(name,email,role,organization_id,branch_id,password_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [role, email, role, org, branch, hash],
      );
  });
  app = await createApp(db);
  // Existing business-flow fixtures explicitly grant owner member administration.
  await db.query(`UPDATE users SET permission_overrides='{"members:create":true,"members:edit":true,"members:deactivate":true}' WHERE role='OWNER'`);
  owner = await login("a@example.test");
  other = await login("b@example.test");
  reception = await login("r@example.test");
  trainer = await login("t@example.test");
  memberUser = await login("m@example.test");
  admin = await login("s@example.test", true);
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("password hashing uses salted scrypt and rejects incorrect passwords", async () => {
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert(!a.includes(password));
  assert(await verifyPassword(password, a));
  assert(!(await verifyPassword("wrong", a)));
});
test("unauthenticated access, wrong credentials, origin and CSRF are denied", async () => {
  assert.equal((await app.inject("/api/members")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "a@example.test", password: "wrong" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/members",
        headers: { cookie: owner.cookie },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/members",
        headers: {
          cookie: owner.cookie,
          "x-csrf-token": owner.csrf,
          origin: "https://evil.test",
        },
        payload: {},
      })
    ).statusCode,
    403,
  );
});
test("platform and gym login boundaries and permission matrix", async () => {
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "s@example.test", password },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/auth/login",
        payload: { email: "a@example.test", password },
      })
    ).statusCode,
    401,
  );
  for (const a of [owner, reception, trainer, memberUser])
    assert.equal((await request(a, "/api/admin/gyms")).statusCode, 403);
  assert.equal((await request(admin, "/api/admin/gyms")).statusCode, 200);
  for (const a of [trainer, memberUser, admin])
    assert.equal((await request(a, "/api/members")).statusCode, 403);
  assert.equal((await request(reception, "/api/staff")).statusCode, 403);
});
test("registers members and rejects injected tenant IDs", async () => {
  let r = await request(owner, "/api/members", "POST", {
    name: "Alice Member",
    phone: "9000011111",
    organization_id: orgB,
  });
  assert.equal(r.statusCode, 400);
  r = await request(owner, "/api/members", "POST", {
    name: "Alice Member",
    phone: "9000011111",
  });
  assert.equal(r.statusCode, 200, r.body);
  memberId = r.json().member.id;
  assert.equal(r.json().member.organization_id, orgA);
  r = await request(owner, "/api/membership-plans", "POST", {
    name: "Monthly",
    duration_days: 30,
    price_paise: 100000,
    tax_bps: 1800,
    freeze_days: 7,
  });
  assert.equal(r.statusCode, 200, r.body);
  planId = r.json().plan.id;
});
test("tenant B cannot read, edit, regenerate QR or pay for tenant A member", async () => {
  assert.equal(
    (await request(other, `/api/members/${memberId}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await request(other, `/api/members/${memberId}`, "PATCH", {
        name: "Hacked",
        phone: "9000000000",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await request(other, `/api/members/${memberId}/qr`, "POST")).statusCode,
    404,
  );
  const list = await request(other, "/api/members");
  assert.equal(list.json().total, 0);
  const r = await request(other, "/api/payments", "POST", {
    member_id: memberId,
    plan_id: planId,
    starts_on: "2026-09-01",
    amount_paise: 118000,
    method: "CASH",
    idempotency_key: randomUUID(),
  });
  assert.equal(r.statusCode, 400);
});
test("payment validates amount and atomically creates membership, receipt and audit", async () => {
  const today = (await one(db, "SELECT CURRENT_DATE::text AS day")).day;
  const input = {
    member_id: memberId,
    plan_id: planId,
    starts_on: today,
    amount_paise: 118000,
    method: "CASH",
    idempotency_key: randomUUID(),
  };
  let r = await request(owner, "/api/payments", "POST", {
    ...input,
    amount_paise: 100,
  });
  assert.equal(r.statusCode, 400);
  r = await request(owner, "/api/payments", "POST", input);
  assert.equal(r.statusCode, 200, r.body);
  payment = r.json();
  assert.equal(payment.payment.amount_paise, 118000);
  assert(payment.invoice.id);
  r = await request(owner, "/api/payments", "POST", input);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().payment.id, payment.payment.id);
  assert(r.json().replayed);
  r = await request(owner, "/api/payments", "POST", {
    ...input,
    amount_paise: 999,
  });
  assert.equal(r.statusCode, 409);
  assert.equal(
    (
      await request(owner, "/api/payments", "POST", {
        ...input,
        idempotency_key: randomUUID(),
      })
    ).statusCode,
    409,
  );
  assert.equal((await request(owner, "/api/payments")).json().total, 1);
  const pdf = await request(owner, `/api/invoices/${payment.invoice.id}/pdf`);
  assert.equal(pdf.statusCode, 200);
  assert(pdf.rawPayload.subarray(0, 4).toString() === "%PDF");
  assert.equal(
    (await request(other, `/api/invoices/${payment.invoice.id}/pdf`))
      .statusCode,
    404,
  );
});
test("check-in verifies membership, QR tenant, duplicate protection and checkout", async () => {
  const qr = (
    await context(db, orgA, false, (tx) =>
      one(tx, "SELECT qr_token FROM members WHERE id=$1", [memberId]),
    )
  ).qr_token;
  assert.equal(
    (
      await request(other, "/api/attendance/check-in", "POST", {
        qr: `gymos:${qr}`,
      })
    ).statusCode,
    404,
  );
  let r = await request(reception, "/api/attendance/check-in", "POST", {
    qr: `gymos:${qr}`,
  });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().attendance.id;
  assert.equal(
    (
      await request(reception, "/api/attendance/check-in", "POST", {
        member_id: memberId,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await request(other, `/api/attendance/${id}/check-out`, "POST"))
      .statusCode,
    409,
  );
  r = await request(reception, `/api/attendance/${id}/check-out`, "POST");
  assert.equal(r.statusCode, 200);
  assert(r.json().attendance.checked_out_at);
  assert.equal(
    (await request(reception, `/api/attendance/${id}/check-out`, "POST"))
      .statusCode,
    409,
  );
  const m = await request(owner, "/api/members", "POST", {
    name: "No Membership",
    phone: "9000099999",
  });
  assert.equal(
    (
      await request(reception, "/api/attendance/check-in", "POST", {
        member_id: m.json().member.id,
      })
    ).statusCode,
    409,
  );
});
test("freeze blocks check-in and unfreeze restores eligibility", async () => {
  assert.equal(
    (
      await request(
        owner,
        `/api/memberships/${payment.membership.id}/freeze`,
        "POST",
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(reception, "/api/attendance/check-in", "POST", {
        member_id: memberId,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        owner,
        `/api/memberships/${payment.membership.id}/unfreeze`,
        "POST",
      )
    ).statusCode,
    200,
  );
});
test("renewal preserves the previous membership", async () => {
  const start = (
    await one(db, "SELECT ($1::date+1)::text AS day", [
      payment.membership.ends_on,
    ])
  ).day;
  const r = await request(owner, "/api/payments", "POST", {
    member_id: memberId,
    plan_id: planId,
    starts_on: start,
    amount_paise: 118000,
    method: "CASH",
    idempotency_key: randomUUID(),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await request(owner, `/api/members/${memberId}`)).json().memberships
      .length,
    2,
  );
});
test("subscription expiration blocks writes, leaves data readable; limits enforced", async () => {
  await context(db, null, true, (tx) =>
    tx.query(
      "UPDATE subscriptions SET renews_at=now()-interval '1 day' WHERE organization_id=$1",
      [orgA],
    ),
  );
  assert.equal(
    (
      await request(owner, "/api/members", "POST", {
        name: "Blocked Member",
        phone: "9000000001",
      })
    ).statusCode,
    403,
  );
  assert.equal((await request(owner, "/api/members")).statusCode, 200);
  await context(db, null, true, async (tx) => {
    await tx.query(
      "UPDATE subscriptions SET plan_id='BASIC',renews_at=now()+interval '30 days' WHERE organization_id=$1",
      [orgA],
    );
    await tx.query(
      "UPDATE subscription_plans SET member_limit=2 WHERE id='BASIC'",
    );
  });
  assert.equal(
    (
      await request(owner, "/api/members", "POST", {
        name: "Over Limit",
        phone: "9000000001",
      })
    ).statusCode,
    409,
  );
  assert.equal((await request(owner, "/api/inventory")).statusCode, 403);
  await context(db, null, true, (tx) =>
    tx.query(
      "UPDATE subscriptions SET plan_id='BUSINESS' WHERE organization_id=$1",
      [orgA],
    ),
  );
  assert.equal((await request(owner, "/api/inventory")).statusCode, 200);
});
test("immutable audit and invoice records reject modifications", async () => {
  await assert.rejects(
    context(db, null, true, (tx) =>
      tx.query("DELETE FROM audit_logs WHERE organization_id=$1", [orgA]),
    ),
    /immutable/,
  );
  await assert.rejects(
    context(db, null, true, (tx) =>
      tx.query("UPDATE invoices SET snapshot='{}' WHERE organization_id=$1", [
        orgA,
      ]),
    ),
    /immutable/,
  );
});
test("inventory adjustments preserve history and reject negative stock", async () => {
  const item = await request(owner, "/api/inventory", "POST", {
    name: "Protein bar",
    sku: "BAR-1",
    minimum_stock: 3,
    purchase_paise: 10000,
    selling_paise: 15000,
  });
  assert.equal(item.statusCode, 200, item.body);
  const id = item.json().id;
  assert.equal(
    (
      await request(owner, `/api/inventory/${id}/stock`, "POST", {
        delta: 5,
        reason: "Initial stock",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(owner, `/api/inventory/${id}/stock`, "POST", {
        delta: -6,
        reason: "Too many",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await request(owner, "/api/inventory")).json().items[0].quantity,
    5,
  );
  const logs = await context(db, orgA, false, (tx) =>
    one(
      tx,
      "SELECT count(*)::int AS n FROM inventory_transactions WHERE inventory_id=$1",
      [id],
    ),
  );
  assert.equal(logs.n, 1);
});
test("trainer scope and appointment double-booking are enforced", async () => {
  const t = await context(db, orgA, false, (tx) =>
    one(
      tx,
      "INSERT INTO trainers(organization_id,user_id) VALUES($1,$2) RETURNING id",
      [orgA, trainer.user.id],
    ),
  );
  const measurement = {
    member_id: memberId,
    weight_kg: 80,
    height_cm: 180,
    measured_on: "2026-09-19",
  };
  assert.equal(
    (await request(trainer, "/api/progress", "POST", measurement)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(owner, `/api/trainers/${t.id}/assign`, "POST", {
        member_id: memberId,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await request(trainer, "/api/progress", "POST", measurement)).statusCode,
    200,
  );
  const input = {
    member_id: memberId,
    trainer_id: t.id,
    starts_at: "2026-09-20T08:00:00Z",
    ends_at: "2026-09-20T09:00:00Z",
  };
  assert.equal(
    (await request(owner, "/api/appointments", "POST", input)).statusCode,
    200,
  );
  assert.equal(
    (
      await request(owner, "/api/appointments", "POST", {
        ...input,
        starts_at: "2026-09-20T08:30:00Z",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await request(other, "/api/appointments")).json().items.length,
    0,
  );
});
test("encrypted backup restores business records and refuses a nonempty destination", async () => {
  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await snapshot(db);
  assert(!encrypted.includes(Buffer.from("Alice Member")));
  const destination = await connectDatabase(undefined, true);
  try {
    await migrate(destination);
    await restore(destination, encrypted);
    const result = await context(destination, orgA, false, (tx) =>
      one(tx, "SELECT count(*)::int AS n FROM members"),
    );
    assert.equal(result.n, 2);
    assert.equal(
      (await one(destination, "SELECT count(*)::int AS n FROM sessions")).n,
      0,
    );
    const invoice = await context(destination, orgA, false, (tx) =>
      one(tx, "SELECT * FROM invoices WHERE id=$1", [payment.invoice.id]),
    );
    assert.equal(invoice.snapshot.member.name, "Alice Member");
    await assert.rejects(restore(destination, encrypted), /empty/);
    const corrupt = Buffer.from(encrypted);
    corrupt[corrupt.length - 1] ^= 1;
    await assert.rejects(restore(destination, corrupt));
  } finally {
    await destination.close();
  }
});
test("database RLS hides foreign tenant rows even without SQL tenant filters", async () => {
  await db.query("CREATE ROLE isolation_test NOLOGIN NOSUPERUSER NOBYPASSRLS");
  await db.query("GRANT SELECT, INSERT ON members TO isolation_test");
  await db.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE isolation_test");
    await tx.query(
      "SELECT set_config('app.organization_id',$1,true),set_config('app.platform','false',true)",
      [orgB],
    );
    assert.equal((await tx.query("SELECT id FROM members")).rows.length, 0);
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE isolation_test");
      await tx.query(
        "SELECT set_config('app.organization_id',$1,true),set_config('app.platform','false',true)",
        [orgB],
      );
      await tx.query(
        "INSERT INTO members(organization_id,branch_id,name,phone,qr_token) VALUES($1,$2,$3,$4,$5)",
        [orgA, branchA, "Evil", "12345678", token()],
      );
    }),
    /row-level security/,
  );
});
test("single-use password reset revokes sessions", async () => {
  const raw = token();
  await db.query(
    "INSERT INTO access_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'RESET',now()+interval '5 minutes')",
    [digest(raw), other.user.id],
  );
  let r = await app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { token: raw, password: "A-new-test-password-239" },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await request(other, "/api/auth/me")).statusCode, 401);
  r = await app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { token: raw, password: "A-new-test-password-239" },
  });
  assert.equal(r.statusCode, 400);
});
test("logout revokes server session", async () => {
  assert.equal(
    (await request(reception, "/api/auth/logout", "POST")).statusCode,
    200,
  );
  assert.equal((await request(reception, "/api/members")).statusCode, 401);
});
test("owner and platform dashboards and reports use persisted records", async () => {
  const dashboard = await request(owner, "/api/dashboard");
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  assert.equal(dashboard.json().metrics.total_members, 2);
  assert.equal(Number(dashboard.json().metrics.monthly_revenue), 236000);
  const platform = await request(admin, "/api/admin/dashboard");
  assert.equal(platform.statusCode, 200, platform.body);
  assert.equal(platform.json().metrics.total_gyms, 2);
  const reports = await request(
    owner,
    "/api/reports?from=2020-01-01&to=2030-12-31",
  );
  assert.equal(reports.statusCode, 200, reports.body);
  assert.equal(Number(reports.json().revenue[0].revenue), 236000);
  const csv = await request(owner, "/api/reports/members/csv");
  assert.equal(csv.statusCode, 200);
  assert(csv.body.includes("Alice Member"));
});
