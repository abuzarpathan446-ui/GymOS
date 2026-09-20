import "dotenv/config";
import pg from "pg";
import { readFile, readdir, mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export interface Executor {
  query(
    sql: string,
    params?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface Database extends Executor {
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function connectDatabase(
  url = process.env.DATABASE_URL,
  memory = false,
): Promise<Database> {
  if (url && !memory) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    });
    return {
      query: (s, p) => pool.query(s, p),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(c);
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("DATABASE_URL is required in production");
  const { PGlite } = await import("@electric-sql/pglite");
  if (!memory) await mkdir(".local", { recursive: true });
  const lockPath = resolve(".local/database.lock");
  const lock = memory
    ? null
    : await open(lockPath, "wx").catch(() => {
        throw new Error(
          "Embedded database is already locked. Stop the other GymOS API. For a stale lock, verify its PID has stopped before removing .local/database.lock.",
        );
      });
  if (lock)
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      }),
    );
  const release = async () => {
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  };
  let embedded;
  try {
    embedded = new PGlite(memory ? undefined : resolve(".local/database"));
    await embedded.waitReady;
  } catch (error) {
    await release();
    throw error;
  }
  const query = async (target: any, s: string, p?: any[]) =>
    p === undefined
      ? ((await target.exec(s)).at(-1) ?? { rows: [] })
      : target.query(s, p);
  return {
    query: (s, p) => query(embedded, s, p),
    transaction: (fn) =>
      embedded.transaction((tx) => fn({ query: (s, p) => query(tx, s, p) })),
    close: async () => {
      try {
        await embedded.close();
      } finally {
        await release();
      }
    },
  };
}
export async function migrate(db: Database) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of (await readdir("database/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(482019)");
      if (
        (
          await tx.query("SELECT name FROM schema_migrations WHERE name=$1", [
            file,
          ])
        ).rows.length
      )
        return;
      // Migration SQL is a trusted checked-in file, never user input.
      const sql = await readFile(`database/migrations/${file}`, "utf8");
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
    });
  }
}
export async function context<T>(
  db: Database,
  org: string | null,
  platform: boolean,
  fn: (tx: Executor) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT set_config('app.organization_id',$1,true),set_config('app.platform',$2,true)",
      [org ?? "", String(platform)],
    );
    await tx.query("SELECT set_config('TimeZone','Asia/Kolkata',true)");
    return fn(tx);
  });
}
export async function one<T = any>(
  tx: Executor,
  sql: string,
  params: any[] = [],
): Promise<T | undefined> {
  return (await tx.query(sql, params)).rows[0];
}
export async function audit(
  tx: Executor,
  org: string | null,
  actor: string | null,
  action: string,
  id?: string,
  metadata: object = {},
) {
  await tx.query(
    "INSERT INTO audit_logs(organization_id,actor_id,action,resource_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [org, actor, action, id ?? null, JSON.stringify(metadata)],
  );
}
