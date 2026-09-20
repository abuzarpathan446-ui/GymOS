import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  connectDatabase,
  migrate,
  context,
  one,
  audit,
} from "../apps/api/src/db.js";
import { hashPassword } from "../apps/api/src/security.js";
import { endSessions } from "../apps/api/src/access-management.js";
// Local maintenance only. Never expose this script as an HTTP endpoint.
// Stop the API before using an embedded database. The one-use input file is removed before opening it.
const email = z.email().parse(process.argv[2]).toLowerCase();
const secretPath = resolve(z.string().min(1).parse(process.argv[3]));
let password = (await readFile(secretPath, "utf8")).trimEnd();
await unlink(secretPath);
// Trusted operator bootstrap supports the explicitly selected administrator credential.
z.string().min(10).max(128).parse(password);
const hash = await hashPassword(password);
password = "";
const db = await connectDatabase().catch(() => {
  console.error(
    "Database could not open. Stop all GymOS API processes before retrying.",
  );
  process.exit(1);
});
try {
  await migrate(db);
  await context(db, null, true, async (tx) => {
    const existing = await one(
      tx,
      "SELECT id,role FROM users WHERE email=$1 FOR UPDATE",
      [email],
    );
    if (existing && existing.role !== "SUPER_ADMIN")
      throw new Error("Email already belongs to a non-platform account.");
    const user = existing
      ? await one(
          tx,
          "UPDATE users SET password_hash=$2,active=true,suspended=false WHERE id=$1 RETURNING id",
          [existing.id, hash],
        )
      : await one(
          tx,
          "INSERT INTO users(name,email,role,password_hash,verified_at) VALUES('Abuzar Pathan',$1,'SUPER_ADMIN',$2,now()) RETURNING id",
          [email, hash],
        );
    await endSessions(tx, user.id, "ADMIN_CREDENTIAL_CHANGED");
    await audit(
      tx,
      null,
      user.id,
      existing
        ? "platform_admin.credentials_changed"
        : "platform_admin.created",
      user.id,
    );
  });
  console.log(
    "Super Admin configured securely. One-use password input removed.",
  );
} finally {
  await db.close();
}
