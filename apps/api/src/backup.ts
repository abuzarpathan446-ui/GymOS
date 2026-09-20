import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { context, one, type Database } from "./db.js";
const tables = [
  "subscription_plans",
  "organizations",
  "branches",
  "users",
  "subscriptions",
  "members",
  "membership_plans",
  "memberships",
  "payments",
  "invoices",
  "attendance",
  "leads",
  "trainers",
  "trainer_assignments",
  "workouts",
  "body_measurements",
  "appointments",
  "inventory",
  "inventory_transactions",
  "notifications",
  "automation_rules",
  "message_logs",
  "audit_logs",
  "login_history",
  "access_requests",
  "expenses",
  "owner_payments",
] as const;
const key = () => {
  const k = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must contain 32 base64-encoded bytes",
    );
  return k;
};
export async function snapshot(db: Database): Promise<Buffer> {
  const encryptionKey = key();
  const data = await context(db, null, true, async (tx) => {
    // Block concurrent writes for a consistent portable snapshot. Keep backup scheduling off peak.
    for (const table of tables)
      await tx.query(`LOCK TABLE "${table}" IN SHARE MODE`);
    const records: Record<string, any[]> = {};
    for (const table of tables)
      records[table] = (await tx.query(`SELECT * FROM "${table}"`)).rows;
    return {
      format: "gymos-backup",
      version: 1,
      created_at: new Date().toISOString(),
      records,
    };
  });
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from("GYMOSB01"),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export async function restore(db: Database, encrypted: Buffer) {
  if (encrypted.subarray(0, 8).toString() !== "GYMOSB01")
    throw new Error("Unknown backup format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    encrypted.subarray(8, 20),
  );
  decipher.setAuthTag(encrypted.subarray(20, 36));
  const data = JSON.parse(
    Buffer.concat([
      decipher.update(encrypted.subarray(36)),
      decipher.final(),
    ]).toString("utf8"),
  );
  if (
    data.format !== "gymos-backup" ||
    data.version !== 1 ||
    Object.keys(data.records).some(
      (k) => !(tables as readonly string[]).includes(k),
    ) ||
    tables
      .filter(
        (k) => !["login_history", "access_requests", "expenses", "owner_payments"].includes(k),
      )
      .some((k) => !Array.isArray(data.records[k]))
  )
    throw new Error("Invalid backup structure");
  for (const name of ["login_history", "access_requests", "expenses", "owner_payments"])
    data.records[name] ??= [];
  for (const membership of data.records.memberships)
    if (membership.fee_paise === undefined)
      membership.fee_paise = data.records.payments
        .filter(
          (p: any) =>
            p.membership_id === membership.id && p.status === "COMPLETED",
        )
        .reduce((n: number, p: any) => n + Number(p.amount_paise), 0);
  await context(db, null, true, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(482020)");
    if (
      (
        await one(
          tx,
          "SELECT (SELECT count(*) FROM organizations)+(SELECT count(*) FROM users) AS n",
        )
      ).n != 0
    )
      throw new Error(
        "Restore requires an empty, migrated destination database",
      );
    await tx.query("DELETE FROM subscription_plans");
    for (const table of tables) {
      const columns = (
        await tx.query(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [table],
        )
      ).rows;
      for (const row of data.records[table]) {
        const fields = Object.keys(row);
        if (fields.some((f) => !columns.some((c) => c.column_name === f)))
          throw new Error("Backup columns do not match the database schema");
        const values = fields.map((f) =>
          ["json", "jsonb"].includes(
            columns.find((c) => c.column_name === f).data_type,
          )
            ? JSON.stringify(row[f])
            : row[f],
        );
        await tx.query(
          `INSERT INTO "${table}" (${fields.map((f) => `"${f}"`).join(",")}) OVERRIDING SYSTEM VALUE VALUES(${values.map((_, i) => `$${i + 1}`).join(",")})`,
          values,
        );
      }
    }
    await tx.query(
      "UPDATE login_history SET logged_out_at=GREATEST(logged_in_at,LEAST(expires_at,$1::timestamptz)),end_reason='BACKUP_RESTORE' WHERE logged_out_at IS NULL",
      [data.created_at],
    );
    for (const table of ["members", "invoices"])
      await tx.query(
        `SELECT setval(pg_get_serial_sequence('${table}','number'),COALESCE((SELECT max(number) FROM "${table}"),1),EXISTS(SELECT 1 FROM "${table}"))`,
      );
    await tx.query(
      "INSERT INTO audit_logs(action,metadata) VALUES('backup.restored',$1)",
      [JSON.stringify({ snapshot_created_at: data.created_at })],
    );
  });
}
export async function backup(db: Database) {
  const row = await context(db, null, true, (tx) =>
    one(tx, "INSERT INTO backups(status) VALUES('RUNNING') RETURNING id"),
  );
  try {
    const directory = resolve(process.env.BACKUP_DIRECTORY ?? "backups");
    await mkdir(directory, { recursive: true });
    const filename = `gymos-${new Date().toISOString().replaceAll(":", "-")}-${row.id}.enc`;
    const bytes = await snapshot(db);
    await writeFile(resolve(directory, `${filename}.partial`), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(
      resolve(directory, `${filename}.partial`),
      resolve(directory, filename),
    );
    await context(db, null, true, (tx) =>
      tx.query(
        "UPDATE backups SET status='COMPLETED',filename=$1,completed_at=now() WHERE id=$2",
        [filename, row.id],
      ),
    );
    return filename;
  } catch (error) {
    await context(db, null, true, (tx) =>
      tx.query(
        "UPDATE backups SET status='FAILED',error=$1,completed_at=now() WHERE id=$2",
        [(error as Error).message.slice(0, 200), row.id],
      ),
    );
    throw error;
  }
}
