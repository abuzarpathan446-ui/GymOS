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
import { hashPassword, digest, verifyPassword } from "../src/security.js";
import {randomUUID,randomBytes} from 'node:crypto';
import {snapshot,restore} from '../src/backup.js';
process.env.NODE_ENV = "test";
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  admin: any,
  owner: any,
  reception: any,
  trainer: any,
  member: any,
  gym: string,
  otherGym: string;
const password = "Hierarchy-test-password-193!";
let address = 1;
async function call(
  auth: any,
  url: string,
  method: any = "GET",
  payload?: any,
) {
  return app.inject({
    url,
    method,
    payload,
    remoteAddress: `10.30.0.${address++}`,
    headers: { cookie: auth?.cookie ?? "", "x-csrf-token": auth?.csrf ?? "" },
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
async function activate(setup: any) {
  assert.equal(setup.status, "LINK_CREATED");
  assert(setup.setup_url.includes("/reset-password#"));
  const token = new URL(setup.setup_url).hash.slice(1);
  const r = await call(null, "/api/auth/reset-password", "POST", {
    token,
    password,
  });
  assert.equal(r.statusCode, 200, r.body);
  return token;
}
before(async () => {
  db = await connectDatabase(undefined, true);
  await migrate(db);
  await db.query(
    "INSERT INTO users(name,email,role,password_hash) VALUES('Administrator','admin@hierarchy.test','SUPER_ADMIN',$1)",
    [await hashPassword(password)],
  );
  app = await createApp(db);
  admin = await login("admin@hierarchy.test", "admin");
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("Owner form identifies invalid Gym IDs and normalizes readable names", async () => {
  const payload = {name:'Validation Gym',slug:'Gym@!',owner_name:'Validation Owner',email:'validation@hierarchy.test',plan_id:'BASIC',delivery:'LINK'};
  const invalid = await call(admin,'/api/admin/gyms','POST',payload);
  assert.equal(invalid.statusCode,400,invalid.body);
  assert(invalid.json().fields.some((f:any)=>f.path==='slug' && f.message.includes('Example: iron-fitness')));
  const valid = await call(admin,'/api/admin/gyms','POST',{...payload,slug:' Validation Gym '});
  assert.equal(valid.statusCode,200,valid.body);
  assert.equal(valid.json().organization.slug,'validation-gym');
  const duplicate = await call(admin,'/api/admin/gyms','POST',{...payload,slug:'validation-gym',email:'duplicate@hierarchy.test'});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  assert.equal(duplicate.json().fields[0].path,'slug');
});

test("Super Admin creates owner accounts without SMTP for new and existing gyms", async () => {
  const result = await call(admin, "/api/admin/gyms", "POST", {
    name: "Hierarchy Gym",
    slug: "hierarchy-gym",
    owner_name: "First Owner",
    email: "owner@hierarchy.test",
    plan_id: "BUSINESS",
    delivery: "LINK",
  });
  assert.equal(result.statusCode, 200, result.body);
  const setup = result.json();
  gym = setup.organization.id;
  const pending = await one(
    db,
    "SELECT password_hash FROM users WHERE email=$1",
    ["owner@hierarchy.test"],
  );
  assert.equal(pending.password_hash, null);
  const raw = await activate(setup);
  owner = await login("owner@hierarchy.test", "owner");
  assert.equal(owner.user.role, "OWNER");
  assert.equal(owner.user.organization_id, gym);
  assert.equal(
    (
      await one(db, "SELECT verified_at FROM users WHERE id=$1", [
        owner.user.id,
      ])
    ).verified_at,
    null,
    "Manually shared link must not claim email verification",
  );
  assert.equal(
    (
      await call(null, "/api/auth/reset-password", "POST", {
        token: raw,
        password,
      })
    ).statusCode,
    400,
    "Setup links are single-use",
  );
  const second = await call(admin, `/api/admin/gyms/${gym}/owners`, "POST", {
    name: "Second Owner",
    email: "owner2@hierarchy.test",
    delivery: "LINK",
  });
  assert.equal(second.statusCode, 200, second.body);
  await activate(second.json());
  assert.equal(
    (await login("owner2@hierarchy.test", "owner")).user.organization_id,
    gym,
  );
  const outbox = await one(
    db,
    "SELECT count(*)::int AS n FROM outbox WHERE kind='EMAIL'",
  );
  assert.equal(outbox.n, 0, "Manual setup must not queue an email");
  const stored = await one(
    db,
    "SELECT token_hash FROM access_tokens WHERE user_id=$1",
    [owner.user.id],
  );
  assert.equal(stored.token_hash, digest(raw));
});
test("owner creates trainer, receptionist and manager accounts in their own gym", async () => {
  for (const role of ["TRAINER", "RECEPTIONIST", "MANAGER"]) {
    const email = `${role.toLowerCase()}@hierarchy.test`;
    const r = await call(owner, "/api/staff", "POST", {
      name: `New ${role}`,
      email,
      role,
      delivery: "LINK",
    });
    assert.equal(r.statusCode, 200, r.body);
    await activate(r.json());
    const auth = await login(email, "staff");
    assert.equal(auth.user.role, role);
    assert.equal(auth.user.organization_id, gym);
    if (role === "TRAINER") trainer = auth;
    if (role === "RECEPTIONIST") reception = auth;
  }
  const profile = await context(db, gym, false, (tx) =>
    one(tx, "SELECT user_id FROM trainers WHERE user_id=$1", [trainer.user.id]),
  );
  assert.equal(profile.user_id, trainer.user.id);
  for (const role of ["OWNER", "SUPER_ADMIN", "MEMBER"])
    assert.equal(
      (
        await call(owner, "/api/staff", "POST", {
          name: "Attempted escalation",
          email: "escalation@hierarchy.test",
          role,
          delivery: "LINK",
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await call(owner, `/api/admin/gyms/${gym}/owners`, "POST", {
        name: "Unauthorized Owner",
        email: "unauthorized@hierarchy.test",
        delivery: "LINK",
      })
    ).statusCode,
    403,
  );
});
test("reception registers a member and creates their login without staff privileges", async () => {
  const registered = await call(reception, "/api/members", "POST", {
    name: "New Member",
    phone: "9000001234",
    email: "member@hierarchy.test",
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const id = registered.json().member.id;
  const result = await call(
    reception,
    `/api/members/${id}/portal-invitation`,
    "POST",
    { delivery: "LINK" },
  );
  assert.equal(result.statusCode, 200, result.body);
  await activate(result.json());
  member = await login("member@hierarchy.test", "member");
  const dashboard = await call(member, "/api/member/dashboard");
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  assert.equal(dashboard.json().member.id, id);
  assert(!reception.user.permissions.includes("staff"));
  assert(reception.user.permissions.includes("members:account"));
  for (const auth of [reception, trainer, member])
    assert.equal(
      (
        await call(auth, "/api/staff", "POST", {
          name: "Forbidden",
          email: "forbidden@hierarchy.test",
          role: "OWNER",
          delivery: "LINK",
        })
      ).statusCode,
      403,
    );
  assert.equal(
    (
      await call(trainer, `/api/members/${id}/portal-invitation`, "POST", {
        delivery: "LINK",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(reception, `/api/members/${id}/portal-invitation`, "POST", {
        delivery: "LINK",
      })
    ).statusCode,
    409,
  );
});
test("tenant injection and cross-gym account creation are rejected", async () => {
  const result = await call(admin, "/api/admin/gyms", "POST", {
    name: "Other Gym",
    slug: "other-hierarchy-gym",
    owner_name: "Other Owner",
    email: "other@hierarchy.test",
    plan_id: "BUSINESS",
    delivery: "LINK",
  });
  assert.equal(result.statusCode, 200, result.body);
  otherGym = result.json().organization.id;
  await activate(result.json());
  const other = await login("other@hierarchy.test", "owner");
  assert.equal((await call(admin,`/api/admin/owners/${other.user.id}`,'PATCH',{name:'Other Owner',email:'other@hierarchy.test',status:'ACTIVE',permissions:{'members:create':true}})).statusCode,200);
  const registered = await call(other, "/api/members", "POST", {
    name: "Other Member",
    phone: "9000004321",
    email: "othermember@hierarchy.test",
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const id = registered.json().member.id;
  assert.equal(
    (
      await call(reception, `/api/members/${id}/portal-invitation`, "POST", {
        delivery: "LINK",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(owner, "/api/staff", "POST", {
        name: "Injected Tenant",
        email: "injected@hierarchy.test",
        role: "TRAINER",
        organization_id: otherGym,
        delivery: "LINK",
      })
    ).statusCode,
    400,
  );
  const linked = await context(db, otherGym, false, (tx) =>
    one(tx, "SELECT user_id FROM members WHERE id=$1", [id]),
  );
  assert.equal(linked.user_id, null);
});
test("account failures roll back and do not leak setup tokens into audits", async () => {
  const countBefore = (await one(db, "SELECT count(*)::int AS n FROM users")).n;
  const duplicate = await call(owner, "/api/staff", "POST", {
    name: "Duplicate",
    email: "trainer@hierarchy.test",
    role: "TRAINER",
    delivery: "LINK",
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM users")).n,
    countBefore,
  );
  const logs = await context(db, null, true, (tx) =>
    tx.query("SELECT metadata FROM audit_logs"),
  );
  for (const row of logs.rows) {
    assert(!JSON.stringify(row.metadata).includes("setup_url"));
    assert(!JSON.stringify(row.metadata).includes("password"));
  }
  await context(db, null, true, (tx) =>
    tx.query("UPDATE subscription_plans SET staff_limit=1 WHERE id='BUSINESS'"),
  );
  assert.equal(
    (
      await call(owner, "/api/staff", "POST", {
        name: "Over limit",
        email: "limit@hierarchy.test",
        role: "TRAINER",
        delivery: "LINK",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM users")).n,
    countBefore,
  );
});

test('Only Super Admin can assign and reset owner passwords; secrets and old access remain protected', async()=>{
  const created=await call(admin,'/api/admin/gyms','POST',{name:'Password Gym',slug:'password-gym',owner_name:'Password Owner',email:'password@hierarchy.test',plan_id:'BASIC',password});
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().status,'PASSWORD_SET');
  assert(!created.body.includes(password));
  assert(!created.json().setup_url);
  const session=await login('password@hierarchy.test','owner');
  const row=await one(db,'SELECT password_hash FROM users WHERE id=$1',[session.user.id]);
  assert.notEqual(row.password_hash,password);
  assert(await verifyPassword(password,row.password_hash));
  const url=`/api/admin/owners/${session.user.id}/password`;
  const replacement='Replacement-owner-pass-993!';
  for(const actor of [owner,reception,trainer,member])assert.equal((await call(actor,url,'PUT',{password:replacement})).statusCode,403);
  assert.equal((await call(null,url,'PUT',{password:replacement})).statusCode,401);
  assert.equal((await call(admin,url,'PUT',{password:'short'})).statusCode,400);
  assert.equal((await call(admin,`/api/admin/owners/${trainer.user.id}/password`,'PUT',{password:replacement})).statusCode,404);
  await db.query("INSERT INTO access_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'SETUP',now()+interval '1 hour')",[digest('old-password-setup'),session.user.id]);
  const reset=await call(admin,url,'PUT',{password:replacement});
  assert.equal(reset.statusCode,200,reset.body);
  assert(!reset.body.includes(replacement));
  assert.equal((await call(session,'/api/auth/me')).statusCode,401);
  assert.equal((await call(null,'/api/owner/auth/login','POST',{email:'password@hierarchy.test',password})).statusCode,401);
  assert.equal((await call(null,'/api/owner/auth/login','POST',{email:'password@hierarchy.test',password:replacement})).statusCode,200);
  assert.equal((await one(db,'SELECT count(*)::int AS n FROM access_tokens WHERE user_id=$1 AND consumed_at IS NULL',[session.user.id])).n,0);
  const logs=await db.query("SELECT metadata FROM audit_logs WHERE resource_id=$1",[session.user.id]);
  assert(!JSON.stringify(logs.rows).includes(replacement));
  const additional=await call(admin,`/api/admin/gyms/${created.json().organization.id}/owners`,'POST',{name:'Additional Owner',email:'additional-password@hierarchy.test',password});
  assert.equal(additional.statusCode,200,additional.body);
  assert.equal((await login('additional-password@hierarchy.test','owner')).user.role,'OWNER');
});

test('Platform owner receipts are atomic, private, deduplicated and survive access revocation and restore',async()=>{
  const payment={amount_paise:149900,paid_on:'2026-09-20',method:'UPI',reference:'test-owner-receipt',notes:'September GymOS subscription',idempotency_key:randomUUID()};
  const account={name:'Billing Gym',slug:'billing-gym',owner_name:'Billing Owner',email:'billing@hierarchy.test',plan_id:'PRO',password};
  const bad=await call(admin,'/api/admin/gyms','POST',{...account,initial_payment:{...payment,amount_paise:-1}});
  assert.equal(bad.statusCode,400);
  assert(!(await one(db,"SELECT id FROM organizations WHERE slug='billing-gym'")));
  const created=await call(admin,'/api/admin/gyms','POST',{...account,initial_payment:payment});
  assert.equal(created.statusCode,200,created.body);
  const billingOwner=await login(account.email,'owner');
  const org=created.json().organization.id;
  let list=await call(admin,'/api/admin/owner-payments?q=Billing');
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().summary.count,1);
  assert.equal(Number(list.json().summary.collected_paise),149900);
  const installment={...payment,amount_paise:50000,idempotency_key:randomUUID(),owner_id:billingOwner.user.id};
  for(const a of [owner,reception,trainer,member,billingOwner]){
    assert.equal((await call(a,'/api/admin/owner-payments')).statusCode,403);
    assert.equal((await call(a,'/api/admin/owner-payments','POST',installment)).statusCode,403);
    assert.equal((await call(a,'/api/admin/owner-payments/accounts')).statusCode,403);
  }
  const writes=await Promise.all([call(admin,'/api/admin/owner-payments','POST',installment),call(admin,'/api/admin/owner-payments','POST',installment)]);
  assert(writes.every(r=>r.statusCode===200),writes.map(r=>r.body).join());
  assert.equal(writes[0].json().id,writes[1].json().id);
  assert.equal((await call(admin,'/api/admin/owner-payments','POST',{...installment,amount_paise:90000})).statusCode,409);
  assert.equal((await call(admin,'/api/admin/gyms','POST',{...account,slug:'billing-rollback',email:'rollback-billing@hierarchy.test',initial_payment:payment})).statusCode,409);
  assert(!(await one(db,"SELECT id FROM organizations WHERE slug='billing-rollback'")));
  await db.query("INSERT INTO access_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'SETUP',now()+interval '1 day')",[digest('revoke-owner-setup'),billingOwner.user.id]);
  const revoke={name:billingOwner.user.name,email:account.email,status:'DEACTIVATED',permissions:{}};
  assert.equal((await call(owner,`/api/admin/owners/${billingOwner.user.id}`,'PATCH',revoke)).statusCode,403);
  assert.equal((await call(admin,`/api/admin/owners/${billingOwner.user.id}`,'PATCH',revoke)).statusCode,200);
  assert.equal((await call(billingOwner,'/api/auth/me')).statusCode,401);
  assert.equal((await call(null,'/api/owner/auth/login','POST',{email:account.email,password})).statusCode,401);
  assert.equal((await one(db,'SELECT count(*)::int AS n FROM access_tokens WHERE user_id=$1 AND consumed_at IS NULL',[billingOwner.user.id])).n,0);
  list=await call(admin,'/api/admin/owner-payments?q=Billing');
  assert.equal(list.json().summary.count,2);
  assert.equal(Number(list.json().summary.collected_paise),199900);
  assert.equal((await one(db,'SELECT id FROM organizations WHERE id=$1',[org])).id,org);
  await db.query('CREATE ROLE gymos_billing_rls NOLOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO gymos_billing_rls');
  await db.query('GRANT SELECT ON owner_payments TO gymos_billing_rls');
  await db.query('SET ROLE gymos_billing_rls');
  try{await context(db,org,false,async tx=>assert.equal((await tx.query('SELECT * FROM owner_payments')).rows.length,0));}finally{await db.query('RESET ROLE');}
  await assert.rejects(context(db,null,true,tx=>tx.query('DELETE FROM owner_payments WHERE organization_id=$1',[org])),/immutable/);
  const previousKey=process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const target=await connectDatabase(undefined,true);
  try{await migrate(target);await restore(target,await snapshot(db));assert.equal((await one(target,'SELECT count(*)::int AS n FROM owner_payments')).n,2);}finally{await target.close();if(previousKey===undefined)delete process.env.BACKUP_ENCRYPTION_KEY;else process.env.BACKUP_ENCRYPTION_KEY=previousKey;}
});
