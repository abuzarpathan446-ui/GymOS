import { connectDatabase, context, one } from "../apps/api/src/db.js";
import { hashPassword, passwordSchema } from "../apps/api/src/security.js";
if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL)
  throw new Error(
    "This helper only updates the local embedded development gym.",
  );
const password = passwordSchema.parse(process.env.SEED_PASSWORD);
const db = await connectDatabase();
try {
  await context(db, null, true, async (tx) => {
    const gym = await one(
      tx,
      "SELECT id FROM organizations WHERE slug='demo-gym'",
    );
    if (!gym) throw new Error("Run the development seed first");
    const member = await one(
      tx,
      "SELECT id,name,branch_id,user_id FROM members WHERE organization_id=$1 ORDER BY number LIMIT 1 FOR UPDATE",
      [gym.id],
    );
    if (!member) throw new Error("No demo member found");
    if (member.user_id) {
      console.log("Demo member already has a linked account.");
      return;
    }
    const account = await one(
      tx,
      "INSERT INTO users(organization_id,branch_id,name,email,password_hash,role,verified_at) VALUES($1,$2,$3,'member@gymos.test',$4,'MEMBER',now()) RETURNING id",
      [gym.id, member.branch_id, member.name, await hashPassword(password)],
    );
    await tx.query("UPDATE members SET user_id=$1 WHERE id=$2", [
      account.id,
      member.id,
    ]);
    console.log(
      "Demo member account created: member@gymos.test (uses SEED_PASSWORD).",
    );
  });
} finally {
  await db.close();
}
