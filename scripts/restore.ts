import { readFile } from "node:fs/promises";
import { connectDatabase, migrate } from "../apps/api/src/db.js";
import { restore } from "../apps/api/src/backup.js";
if (!process.env.RESTORE_DATABASE_URL || !process.env.RESTORE_FILE)
  throw new Error(
    "Set RESTORE_DATABASE_URL and RESTORE_FILE. Destination must be an empty database.",
  );
if (process.env.RESTORE_DATABASE_URL === process.env.DATABASE_URL)
  throw new Error(
    "Restore to a separate database, verify it, then switch the deployment connection.",
  );
const db = await connectDatabase(process.env.RESTORE_DATABASE_URL);
try {
  await migrate(db);
  await restore(db, await readFile(process.env.RESTORE_FILE));
  console.log(
    "Restore completed. All sessions and pending access tokens were excluded. Verify records before switching traffic.",
  );
} finally {
  await db.close();
}
