import { connectDatabase, context, one } from "./db.js";
import nodemailer from "nodemailer";
import { setTimeout } from "node:timers/promises";
import { backup } from "./backup.js";
if (!process.env.DATABASE_URL)
  throw new Error(
    "The background worker requires PostgreSQL. Do not open an embedded database from a second process.",
  );
const db = await connectDatabase();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function reminders() {
  await context(db, null, true, async (tx) => {
    await tx.query(`INSERT INTO notifications(organization_id,title,body,event_key)
   SELECT s.organization_id,'Membership expiry reminder',m.name||' — expires '||s.ends_on::text,'expiry:'||s.id::text||':'||CURRENT_DATE::text
   FROM memberships s JOIN members m ON m.id=s.member_id JOIN organizations o ON o.id=s.organization_id
   WHERE o.status='ACTIVE' AND s.status IN ('ACTIVE','TRIAL') AND (s.ends_on-CURRENT_DATE) IN (SELECT value::int FROM jsonb_array_elements_text(COALESCE(o.settings->'reminder_days','[30,7,3,1,0]'::jsonb)))
   ON CONFLICT(organization_id,event_key) DO NOTHING`);
  });
}
async function next() {
  return db.transaction(async (tx) => {
    await tx.query(
      "UPDATE outbox SET status='PENDING' WHERE status='PROCESSING' AND locked_at<now()-interval '10 minutes'",
    );
    return one(
      tx,
      "UPDATE outbox SET status='PROCESSING',locked_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM outbox WHERE status='PENDING' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
    );
  });
}
let lastReminders = 0,
  lastBackup = 0;
while (!stopping) {
  try {
    if (Date.now() - lastReminders > 3600000) {
      await reminders();
      lastReminders = Date.now();
    }
    if (
      process.env.BACKUP_ENCRYPTION_KEY &&
      Date.now() - lastBackup >
        Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 24) * 3600000
    ) {
      lastBackup = Date.now();
      await backup(db);
    }
    const job = await next();
    if (!job) {
      await setTimeout(2000);
      continue;
    }
    try {
      if (job.kind === "BACKUP") {
        await backup(db);
      } else if (job.kind === "EMAIL") {
        if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM)
          throw new Error("SMTP is not configured");
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: Number(process.env.SMTP_PORT) === 465,
          requireTLS: Number(process.env.SMTP_PORT) !== 465,
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined,
          connectionTimeout: 15000,
          socketTimeout: 30000,
        });
        await transport.sendMail({
          from: process.env.EMAIL_FROM,
          to: job.payload.to,
          subject: job.payload.subject,
          text: job.payload.text,
        });
      } else if (job.kind === "EVENT") {
        // Only configured notification rules execute. External delivery is never simulated.
        await context(db, job.organization_id, false, async (tx) => {
          const rules = (
            await tx.query(
              "SELECT * FROM automation_rules WHERE organization_id=$1 AND event=$2 AND enabled",
              [job.organization_id, job.payload.event],
            )
          ).rows;
          for (const rule of rules) {
            if (rule.action === "WHATSAPP")
              throw new Error(
                "Automated WhatsApp adapter is not enabled; no message was sent",
              );
            await tx.query(
              "INSERT INTO notifications(organization_id,title,body,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [
                job.organization_id,
                rule.configuration.title ?? job.payload.event,
                job.payload.resource_id,
                `rule:${rule.id}:${job.id}`,
              ],
            );
          }
        });
      } else throw new Error("Unsupported job kind");
      await db.query(
        "UPDATE outbox SET status='SENT',payload=CASE WHEN kind='EMAIL' THEN '{}'::jsonb ELSE payload END,last_error=NULL WHERE id=$1",
        [job.id],
      );
    } catch (error) {
      await db.query(
        "UPDATE outbox SET status=$1,last_error=$2,available_at=now()+interval '5 minutes' WHERE id=$3",
        [
          job.attempts >= 5 ? "FAILED" : "PENDING",
          (error as Error).message.slice(0, 200),
          job.id,
        ],
      );
    }
  } catch {
    console.error("Worker cycle failed; retrying.");
    await setTimeout(5000);
  }
}
await db.close();
