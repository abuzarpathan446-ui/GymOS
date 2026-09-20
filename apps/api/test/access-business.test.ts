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
import { hashPassword } from "../src/security.js";
import { snapshot, restore } from "../src/backup.js";
process.env.NODE_ENV = "test";
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  admin: any,
  owner: any,
  reception: any,
  trainer: any,
  member: any,
  other: any,
  org: string,
  branch: string,
  memberId: string,
  trainerId: string,
  membership: string;
const password = "Only-a-test-password-852!",
  overrides: any = {
    features: { expenses: true },
    limits: { member: 3, staff: 6, TRAINER: 1, RECEPTIONIST: 1, MANAGER: 1 },
  };
let remote = 0;
async function call(a: any, url: string, method: any = "GET", payload?: any) {
  return app.inject({
    url,
    method,
    payload,
    remoteAddress: `10.20.${Math.floor(remote / 250)}.${(++remote % 250) + 1}`,
    headers: { cookie: a?.cookie ?? "", "x-csrf-token": a?.csrf ?? "" },
  });
}
async function login(email: string, portal: string) {
  const r = await call(null, `/api/${portal}/auth/login`, "POST", {
    email,
    password,
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrf: r.json().user.csrf_token,
    user: r.json().user,
  };
}
async function policy() {
  const r = await call(
    admin,
    `/api/admin/gyms/${org}/access`,
    "PUT",
    overrides,
  );
  assert.equal(r.statusCode, 200, r.body);
}
before(async () => {
  db = await connectDatabase(undefined, true);
  await migrate(db);
  const hash = await hashPassword(password);
  await context(db, null, true, async (tx) => {
    org = (
      await one(
        tx,
        "INSERT INTO organizations(name,slug,email) VALUES('Access Gym','access-gym','access@test.com') RETURNING id",
      )
    ).id;
    branch = (
      await one(
        tx,
        "INSERT INTO branches(organization_id,name) VALUES($1,'Main') RETURNING id",
        [org],
      )
    ).id;
    const orgB = (
      await one(
        tx,
        "INSERT INTO organizations(name,slug,email) VALUES('Other Gym','access-other','other@test.com') RETURNING id",
      )
    ).id;
    for (const o of [org, orgB])
      await tx.query(
        "INSERT INTO subscriptions(organization_id,plan_id,status,renews_at) VALUES($1,'BUSINESS','ACTIVE',now()+interval '90 days')",
        [o],
      );
    for (const [role, email, o] of [
      ["SUPER_ADMIN", "admin@access.test", null],
      ["OWNER", "owner@access.test", org],
      ["RECEPTIONIST", "reception@access.test", org],
      ["TRAINER", "trainer@access.test", org],
      ["MEMBER", "member@access.test", org],
      ["OWNER", "other@access.test", orgB],
    ])
      await tx.query(
        "INSERT INTO users(name,email,role,organization_id,branch_id,password_hash) VALUES($1,$2,$1,$3,$4,$5)",
        [role, email, o, o === org ? branch : null, hash],
      );
    trainerId = (
      await one(
        tx,
        "INSERT INTO trainers(organization_id,user_id) SELECT organization_id,id FROM users WHERE role='TRAINER' RETURNING id",
      )
    ).id;
  });
  app = await createApp(db);
  admin = await login("admin@access.test", "admin");
  owner = await login("owner@access.test", "owner");
  reception = await login("reception@access.test", "staff");
  trainer = await login("trainer@access.test", "staff");
  member = await login("member@access.test", "member");
  other = await login("other@access.test", "owner");
  await policy();
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("owner defaults to read-only members and cannot elevate role, subscription or controls", async () => {
  assert.equal(
    (
      await call(owner, "/api/members", "POST", {
        name: "Not allowed",
        phone: "9000000000",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(owner, "/api/subscription/cancel", "POST")).statusCode,
    403,
  );
  assert.equal(
    (await call(owner, `/api/admin/gyms/${org}/access`, "PUT", overrides))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call(owner, "/api/staff", "POST", {
        name: "Forbidden Owner",
        email: "bad@access.test",
        role: "OWNER",
        delivery: "LINK",
      })
    ).statusCode,
    400,
  );
  const grant = await call(
    admin,
    `/api/admin/owners/${owner.user.id}`,
    "PATCH",
    {
      name: "Owner",
      email: "owner@access.test",
      status: "ACTIVE",
      permissions: {
        "members:create": true,
        "members:edit": false,
        "members:deactivate": false,
      },
    },
  );
  assert.equal(grant.statusCode, 200, grant.body);
  const r = await call(owner, "/api/members", "POST", {
    name: "First Member",
    phone: "9000000000",
  });
  assert.equal(r.statusCode, 200, r.body);
  memberId = r.json().member.id;
  assert.equal(
    (
      await call(owner, `/api/members/${memberId}`, "PATCH", {
        name: "Blocked edit",
        phone: "9000000000",
      })
    ).statusCode,
    403,
  );
  await context(db, org, false, (tx) =>
    tx.query("UPDATE members SET user_id=$2 WHERE id=$1", [
      memberId,
      member.user.id,
    ]),
  );
});
test("member and role quotas cover invitation, reactivation, concurrent creation and lowered limits", async () => {
  for (const role of ["TRAINER", "RECEPTIONIST"])
    assert.equal(
      (
        await call(owner, "/api/staff", "POST", {
          name: "Extra staff",
          email: `extra-${role}@access.test`,
          role,
          delivery: "LINK",
        })
      ).statusCode,
      409,
    );
  const r = await call(owner, "/api/staff", "POST", {
    name: "Admin staff",
    email: "manager@access.test",
    role: "MANAGER",
    delivery: "LINK",
  });
  assert.equal(r.statusCode, 200, r.body);
  const staff = (await call(owner, "/api/staff"))
    .json()
    .items.find((u: any) => u.email === "manager@access.test");
  assert.equal(
    (await call(owner, `/api/staff/${staff.id}`, "PATCH", { active: false }))
      .statusCode,
    200,
  );
  overrides.limits.MANAGER = 0;
  await policy();
  assert.equal(
    (await call(owner, `/api/staff/${staff.id}`, "PATCH", { active: true }))
      .statusCode,
    409,
  );
  overrides.limits.member = 2;
  await policy();
  const results = await Promise.all(
    [1, 2].map((n) =>
      call(reception, "/api/members", "POST", {
        name: `Concurrent ${n}`,
        phone: "9000000001",
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  overrides.limits.member = 1;
  await policy();
  assert.equal((await call(owner, "/api/members")).json().total, 2);
  assert.equal(
    (
      await call(reception, "/api/members", "POST", {
        name: "Over quota",
        phone: "9000000001",
      })
    ).statusCode,
    409,
  );
  overrides.limits.member = 10;
  await policy();
});
test("manual feature locks block direct APIs, nested data, exports and member portal immediately", async () => {
  overrides.features.members = false;
  await policy();
  assert.equal((await call(owner, "/api/members")).statusCode, 403);
  assert.equal(
    (
      await call(reception, "/api/members", "POST", {
        name: "Blocked",
        phone: "9000000001",
      })
    ).statusCode,
    403,
  );
  assert.equal((await call(owner, "/api/reports/members/csv")).statusCode, 403);
  overrides.features.members = true;
  overrides.features.member_portal = false;
  await policy();
  assert.equal((await call(member, "/api/member/dashboard")).statusCode, 403);
  overrides.features.member_portal = true;
  overrides.features.payments = false;
  await policy();
  assert.equal((await call(owner, "/api/payments")).statusCode, 403);
  assert.equal(
    (await call(owner, `/api/members/${memberId}`)).json().payments.length,
    0,
  );
  assert.equal(
    (await call(owner, "/api/dashboard")).json().metrics.monthly_revenue,
    undefined,
  );
  overrides.features.payments = true;
  await policy();
});
test("partial payments, deadline, receipt and installments are atomic, idempotent and never overpaid", async () => {
  const plan = await call(owner, "/api/membership-plans", "POST", {
    name: "Annual",
    duration_days: 365,
    price_paise: 1000000,
  });
  assert.equal(plan.statusCode, 200, plan.body);
  const r = await call(reception, "/api/payments", "POST", {
    member_id: memberId,
    plan_id: plan.json().plan.id,
    starts_on: "2026-09-01",
    amount_paise: 400000,
    payment_deadline: "2026-09-30",
    method: "CASH",
    idempotency_key: randomUUID(),
  });
  assert.equal(r.statusCode, 200, r.body);
  membership = r.json().membership.id;
  let balances = (
    await call(owner, `/api/balances?member_id=${memberId}`)
  ).json().items;
  assert.equal(Number(balances[0].pending_paise), 600000);
  const p = {
    amount_paise: 200000,
    method: "CASH",
    idempotency_key: randomUUID(),
  };
  const installment = await call(
    reception,
    `/api/memberships/${membership}/payments`,
    "POST",
    p,
  );
  assert.equal(installment.statusCode, 200, installment.body);
  assert.equal(
    (
      await call(
        reception,
        `/api/memberships/${membership}/payments`,
        "POST",
        p,
      )
    ).json().replayed,
    true,
  );
  assert.equal(
    (
      await call(other, `/api/memberships/${membership}/payments`, "POST", {
        ...p,
        idempotency_key: randomUUID(),
      })
    ).statusCode,
    404,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      call(reception, `/api/memberships/${membership}/payments`, "POST", {
        ...p,
        amount_paise: 300000,
        idempotency_key: randomUUID(),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  balances = (await call(owner, `/api/balances?member_id=${memberId}`)).json()
    .items;
  assert.equal(Number(balances[0].paid_paise), 900000);
  assert.equal(Number(balances[0].pending_paise), 100000);
  assert.equal(
    (
      await call(
        reception,
        `/api/memberships/${membership}/payment-deadline`,
        "PATCH",
        { payment_deadline: "2000-01-01" },
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call(owner, `/api/balances?member_id=${memberId}`)).json().items[0]
      .payment_status,
    "OVERDUE",
  );
  assert.equal(
    (await call(owner, `/api/invoices/${installment.json().invoice.id}/pdf`))
      .statusCode,
    200,
  );
  assert.equal(
    (await call(member, "/api/member/payments")).json().items.length,
    3,
  );
});
test("expenses and profit use saved values; trainers cannot read financial information", async () => {
  const r = await call(owner, "/api/expenses", "POST", {
    description: "Equipment maintenance",
    category: "Maintenance",
    amount_paise: 1000000,
    spent_on: "2026-09-01",
  });
  assert.equal(r.statusCode, 200, r.body);
  const summary = await call(owner, "/api/financial-summary");
  assert.equal(summary.statusCode, 200, summary.body);
  assert.equal(summary.json().periods[0].profit_paise, -100000);
  for (const path of [
    "/api/expenses",
    "/api/payments",
    "/api/balances",
    "/api/financial-summary",
    "/api/dashboard",
    `/api/members/${memberId}`,
  ])
    assert.equal((await call(trainer, path)).statusCode, 403, path);
  assert.equal((await call(other, "/api/balances")).json().items.length, 0);
});
test("staff login/logout attendance and audit are persisted and sessions revoked", async () => {
  const list = await call(owner, "/api/staff/activity");
  assert.equal(list.statusCode, 200, list.body);
  assert(
    list.json().items.some((r: any) => r.role === "RECEPTIONIST" && r.online),
  );
  assert.equal(
    (await call(reception, "/api/auth/logout", "POST")).statusCode,
    200,
  );
  assert.equal((await call(reception, "/api/auth/me")).statusCode, 401);
  const rows = (await call(owner, "/api/staff/activity")).json().items;
  const row = rows.find((r: any) => r.role === "RECEPTIONIST");
  assert.equal(row.online, false);
  assert(row.logged_out_at);
  assert(row.seconds >= 0);
  reception = await login("reception@access.test", "staff");
  const detail = await call(
    admin,
    `/api/admin/gyms/${org}/details?section=activity`,
  );
  assert.equal(detail.statusCode, 200, detail.body);
  assert(detail.json().items.some((r: any) => r.action === "auth.logout"));
});
test("assigned trainers edit workouts; members can only create and edit their own plans when enabled", async () => {
  assert.equal(
    (await call(trainer, `/api/assigned-members/${memberId}`)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(owner, `/api/trainers/${trainerId}/assign`, "POST", {
        member_id: memberId,
      })
    ).statusCode,
    200,
  );
  const detail = await call(trainer, `/api/assigned-members/${memberId}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert(!detail.body.includes("fee_paise"));
  const p = {
    name: "Strength plan",
    exercises: [
      {
        day: "Monday",
        muscle_group: "Chest",
        name: "Bench press",
        sets: 4,
        reps: "10",
        weight: "20 kg",
        rest_seconds: 90,
        notes: "Controlled movement",
      },
    ],
  };
  const create = await call(trainer, "/api/workouts", "POST", {
    member_id: memberId,
    ...p,
  });
  assert.equal(create.statusCode, 200, create.body);
  assert.equal(
    (
      await call(trainer, `/api/workouts/${create.json().id}`, "PUT", {
        ...p,
        name: "Updated strength",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call(member, "/api/member/workouts", "POST", p)).statusCode,
    403,
  );
  overrides.features.member_workouts = true;
  await policy();
  const own = await call(member, "/api/member/workouts", "POST", p);
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(
    (await call(member, `/api/member/workouts/${create.json().id}`, "PUT", p))
      .statusCode,
    404,
  );
  assert.equal(
    (await call(member, `/api/member/workouts/${own.json().id}`, "PUT", p))
      .statusCode,
    200,
  );
  assert.equal((await call(member, "/api/member/attendance")).statusCode, 200);
});
test("WhatsApp is locked by default and preparation never claims delivery", async () => {
  assert.equal(
    (
      await call(reception, `/api/members/${memberId}/whatsapp`, "POST", {
        type: "PENDING",
      })
    ).statusCode,
    403,
  );
  overrides.features.whatsapp_chat = true;
  await policy();
  const r = await call(reception, `/api/members/${memberId}/whatsapp`, "POST", {
    type: "PENDING",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().sent, false);
  assert.equal(r.json().status, "PREPARED");
  assert(r.json().message.includes("1000.00"));
  assert(r.json().url.startsWith("https://wa.me/91"));
  assert.equal(
    (
      await call(other, `/api/members/${memberId}/whatsapp`, "POST", {
        type: "PENDING",
      })
    ).statusCode,
    403,
  );
});
test("staff permission edits cannot escalate trainer privileges and take effect immediately", async () => {
  const payload = {
    name: "Reception",
    email: "reception@access.test",
    permissions: { payments: false },
  };
  assert.equal(
    (
      await call(
        owner,
        `/api/staff/${reception.user.id}/access`,
        "PUT",
        payload,
      )
    ).statusCode,
    200,
  );
  assert.equal((await call(reception, "/api/payments")).statusCode, 403);
  assert.equal(
    (
      await call(reception, `/api/members/${memberId}/whatsapp`, "POST", {
        type: "PENDING",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(reception, `/api/members/${memberId}`)).json().payments.length,
    0,
  );
  assert.equal(
    (
      await call(owner, `/api/staff/${trainer.user.id}/access`, "PUT", {
        name: "Trainer",
        email: "trainer@access.test",
        permissions: { payments: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        reception,
        `/api/staff/${reception.user.id}/access`,
        "PUT",
        payload,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(owner, `/api/staff/${reception.user.id}/access`, "PUT", {
        ...payload,
        permissions: { payments: true },
      })
    ).statusCode,
    200,
  );
});
test("access requests, admin details and owner suspension preserve tenant boundaries", async () => {
  assert.equal(
    (
      await call(owner, "/api/access/requests", "POST", {
        resource: "member",
        requested_limit: 200,
        notes: "Growing the gym",
      })
    ).statusCode,
    200,
  );
  const requests = (await call(admin, "/api/admin/access-requests")).json()
    .items;
  assert.equal(requests[0].requested_limit, 200);
  for (const section of [
    "overview",
    "users",
    "members",
    "payments",
    "activity",
    "logins",
  ]) {
    const r = await call(
      admin,
      `/api/admin/gyms/${org}/details?section=${section}`,
    );
    assert.equal(r.statusCode, 200, r.body);
    assert(!r.body.includes("password_hash"));
  }
  assert.equal(
    (await call(other, `/api/admin/gyms/${org}/details`)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(admin, `/api/admin/owners/${owner.user.id}`, "PATCH", {
        name: "Owner",
        email: "owner@access.test",
        status: "SUSPENDED",
        permissions: {},
      })
    ).statusCode,
    200,
  );
  assert.equal((await call(owner, "/api/auth/me")).statusCode, 401);
  assert.equal(
    (
      await call(null, "/api/owner/auth/login", "POST", {
        email: "owner@access.test",
        password,
      })
    ).statusCode,
    401,
  );
});
test("new tables enforce RLS and encrypted restore retains overrides, balances, expenses and activity", async () => {
  await db.query(
    "CREATE ROLE new_table_isolation NOLOGIN NOSUPERUSER NOBYPASSRLS",
  );
  await db.query(
    "GRANT SELECT ON expenses,access_requests,login_history TO new_table_isolation",
  );
  await db.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE new_table_isolation");
    await tx.query(
      "SELECT set_config('app.organization_id',$1,true),set_config('app.platform','false',true)",
      [other.user.organization_id],
    );
    for (const table of ["expenses", "access_requests"])
      assert.equal((await tx.query(`SELECT * FROM ${table}`)).rows.length, 0);
    assert(
      (await tx.query("SELECT organization_id FROM login_history")).rows.every(
        (r) => r.organization_id === other.user.organization_id,
      ),
    );
  });
  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await snapshot(db),
    destination = await connectDatabase(undefined, true);
  try {
    await migrate(destination);
    await restore(destination, encrypted);
    await context(destination, null, true, async (tx) => {
      assert.equal(
        (
          await one(
            tx,
            "SELECT access_overrides FROM organizations WHERE id=$1",
            [org],
          )
        ).access_overrides.limits.member,
        10,
      );
      assert.equal(
        (await one(tx, "SELECT count(*)::int AS n FROM expenses")).n,
        1,
      );
      assert.equal(
        (await one(tx, "SELECT count(*)::int AS n FROM access_requests")).n,
        1,
      );
      assert.equal(
        (
          await one(tx, "SELECT fee_paise FROM memberships WHERE id=$1", [
            membership,
          ])
        ).fee_paise,
        1000000,
      );
      assert.equal(
        (
          await one(
            tx,
            "SELECT count(*)::int AS n FROM login_history WHERE logged_out_at IS NULL",
          )
        ).n,
        0,
      );
    });
  } finally {
    await destination.close();
  }
});
