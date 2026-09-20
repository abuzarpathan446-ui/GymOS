import { connectDatabase, migrate, context, one } from "../apps/api/src/db.js";
import {
  hashPassword,
  passwordSchema,
  token,
} from "../apps/api/src/security.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Development seeds are prohibited in production");
const password = passwordSchema.parse(process.env.SEED_PASSWORD);
const db = await connectDatabase();
try {
  await migrate(db);
  const hash = await hashPassword(password);
  await context(db, null, true, async (tx) => {
    if (await one(tx, "SELECT id FROM organizations WHERE slug='demo-gym'"))
      throw new Error("Demo gym already exists; seed makes no changes");
    await tx.query(
      "INSERT INTO users(name,email,password_hash,role,verified_at) VALUES('Platform Admin','admin@gymos.test',$1,'SUPER_ADMIN',now())",
      [hash],
    );
    const org = await one(
      tx,
      "INSERT INTO organizations(name,slug,email,address,phone) VALUES('Iron & Intent','demo-gym','owner@gymos.test','Aurangabad, Maharashtra','+919876543210') RETURNING id",
    );
    const branch = await one(
      tx,
      "INSERT INTO branches(organization_id,name) VALUES($1,'Main studio') RETURNING id",
      [org.id],
    );
    await tx.query(
      "INSERT INTO subscriptions(organization_id,plan_id,status,renews_at) VALUES($1,'BUSINESS','TRIAL',now()+interval '14 days')",
      [org.id],
    );
    const accounts = [
      ["Aarav Shah", "owner", "OWNER"],
      ["Mira Patel", "manager", "MANAGER"],
      ["Riya Deshmukh", "reception", "RECEPTIONIST"],
      ["Kabir Khan", "trainer1", "TRAINER"],
      ["Neha Rao", "trainer2", "TRAINER"],
    ];
    let owner = "";
    const trainers: string[] = [];
    for (const [name, login, role] of accounts) {
      const u = await one(
        tx,
        "INSERT INTO users(organization_id,branch_id,name,email,password_hash,role,verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id",
        [org.id, branch.id, name, `${login}@gymos.test`, hash, role],
      );
      if (role === "OWNER") owner = u.id;
      if (role === "TRAINER") {
        const t = await one(
          tx,
          "INSERT INTO trainers(organization_id,user_id,specialization) VALUES($1,$2,$3) RETURNING id",
          [org.id, u.id, "Strength & conditioning"],
        );
        trainers.push(t.id);
      }
    }
    const plan = await one(
      tx,
      "INSERT INTO membership_plans(organization_id,name,duration_days,price_paise,freeze_days) VALUES($1,'Monthly unlimited',30,150000,7) RETURNING id",
      [org.id],
    );
    await tx.query(
      "INSERT INTO membership_plans(organization_id,name,duration_days,price_paise,freeze_days) VALUES($1,'Quarterly unlimited',90,400000,14)",
      [org.id],
    );
    const names = [
      "Aditya Kulkarni",
      "Ananya Sharma",
      "Arjun Mehta",
      "Diya Shah",
      "Ishaan Patil",
      "Kavya Joshi",
      "Rohan Verma",
      "Saanvi Desai",
      "Vihaan Gupta",
      "Zoya Khan",
      "Dev Nair",
      "Ira Singh",
      "Kunal Rao",
      "Meera Jain",
      "Nikhil Kumar",
      "Priya Patel",
      "Rahul Das",
      "Sara Ali",
      "Tanvi Shah",
      "Yash More",
    ];
    for (let i = 0; i < names.length; i++) {
      const m = await one(
        tx,
        "INSERT INTO members(organization_id,branch_id,name,phone,email,qr_token) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,number",
        [
          org.id,
          branch.id,
          names[i],
          `900000${String(i).padStart(4, "0")}`,
          `member${i + 1}@example.test`,
          token(),
        ],
      );
      const s = await one(
        tx,
        "INSERT INTO memberships(organization_id,member_id,plan_id,starts_on,ends_on) VALUES($1,$2,$3,CURRENT_DATE-$4::int,CURRENT_DATE+29-$4::int) RETURNING *",
        [org.id, m.id, plan.id, i + 10],
      );
      if (i === 0) {
        const account = await one(
          tx,
          "INSERT INTO users(organization_id,branch_id,name,email,password_hash,role,verified_at) VALUES($1,$2,$3,'member@gymos.test',$4,'MEMBER',now()) RETURNING id",
          [org.id, branch.id, names[i], hash],
        );
        await tx.query("UPDATE members SET user_id=$1 WHERE id=$2", [
          account.id,
          m.id,
        ]);
      }
      const p = await one(
        tx,
        "INSERT INTO payments(organization_id,member_id,membership_id,amount_paise,subtotal_paise,discount_paise,tax_paise,method,received_by,idempotency_key,request_hash) VALUES($1,$2,$3,150000,150000,0,0,'CASH',$4,gen_random_uuid(),'seed') RETURNING *",
        [org.id, m.id, s.id, owner],
      );
      await tx.query(
        "INSERT INTO invoices(organization_id,payment_id,snapshot) VALUES($1,$2,$3)",
        [
          org.id,
          p.id,
          JSON.stringify({
            gym: {
              name: "Iron & Intent",
              address: "Aurangabad, Maharashtra",
              email: "owner@gymos.test",
            },
            member: { name: names[i], number: m.number },
            plan: "Monthly unlimited",
            payment: p,
            membership: s,
          }),
        ],
      );
      await tx.query(
        "INSERT INTO trainer_assignments(organization_id,trainer_id,member_id) VALUES($1,$2,$3)",
        [org.id, trainers[i % 2], m.id],
      );
      if (i < 12)
        await tx.query(
          "INSERT INTO attendance(organization_id,member_id,recorded_by,checked_in_at,checked_out_at) VALUES($1,$2,$3,now()-interval '2 hours',$4)",
          [org.id, m.id, owner, i < 5 ? null : new Date().toISOString()],
        );
      if (i < 4)
        await tx.query(
          "INSERT INTO appointments(organization_id,member_id,trainer_id,starts_at,ends_at) VALUES($1,$2,$3,now()+($4||' days')::interval,now()+($4||' days')::interval+interval '1 hour')",
          [org.id, m.id, trainers[i % 2], String(i + 1)],
        );
    }
    for (const name of ["Aditi Jain", "Vikram Rao", "Sahil Shah"])
      await tx.query(
        "INSERT INTO leads(organization_id,name,phone) VALUES($1,$2,$3)",
        [org.id, name, "9000012345"],
      );
    await tx.query(
      "INSERT INTO audit_logs(organization_id,actor_id,action) VALUES($1,$2,'development.seeded')",
      [org.id, owner],
    );
  });
  console.log(
    "Development gym created: owner@gymos.test, admin@gymos.test. Password is your SEED_PASSWORD.",
  );
} finally {
  await db.close();
}
