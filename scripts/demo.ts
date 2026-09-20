import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
if (process.env.NODE_ENV === "production")
  throw new Error("Demo setup is development-only");
try {
  await readFile(".env");
  throw new Error(
    "An .env already exists. Set SEED_PASSWORD there and run npm run db:seed manually.",
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const password = randomBytes(20).toString("base64url");
const example = await readFile(".env.example", "utf8");
await writeFile(
  ".env",
  example
    .replace(/^SEED_PASSWORD=$/m, `SEED_PASSWORD=${password}`)
    .replace(
      /^BACKUP_ENCRYPTION_KEY=$/m,
      `BACKUP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    ),
  { flag: "wx", mode: 0o600 },
);
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/demo-access.txt",
  `Local development only\nLogin chooser: http://localhost:5173/login\nAdmin: admin@gymos.test (/admin/login)\nOwner: owner@gymos.test (/owner/login)\nManager: manager@gymos.test (/staff/login)\nFront desk: reception@gymos.test (/staff/login)\nTrainer: trainer1@gymos.test (/staff/login)\nMember: member@gymos.test (/member/login)\nPassword: ${password}\n`,
  { mode: 0o600 },
);
process.env.SEED_PASSWORD = password;
await import("./seed.js");
console.log(
  "Local credentials saved to .local/demo-access.txt. Start with npm run dev.",
);
