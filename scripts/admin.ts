import { connectDatabase, context, audit, one } from "../apps/api/src/db.js";
import { hashPassword, passwordSchema } from "../apps/api/src/security.js";
import { z } from "zod";
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
const db = await connectDatabase();
try {
  await context(db, null, true, async (tx) => {
    const u = await one(
      tx,
      "INSERT INTO users(name,email,password_hash,role,verified_at) VALUES('Platform administrator',$1,$2,'SUPER_ADMIN',now()) RETURNING id",
      [email, await hashPassword(password)],
    );
    await audit(tx, null, u.id, "platform_admin.created", u.id);
  });
  console.log("Platform administrator created.");
} finally {
  await db.close();
}
