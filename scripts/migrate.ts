import { connectDatabase, migrate } from "../apps/api/src/db.js";
const db = await connectDatabase(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
);
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.close();
}
