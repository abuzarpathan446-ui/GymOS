import { connectDatabase } from "../apps/api/src/db.js";
import { backup } from "../apps/api/src/backup.js";
const db = await connectDatabase();
try {
  console.log("Encrypted backup written:", await backup(db));
} finally {
  await db.close();
}
