# Deployment and operations

This is a deployment path for a staging environment. Read `docs/DELIVERY_STATUS.md` before commercial release; browser QA and standalone PostgreSQL deployment verification remain outstanding.

## Prerequisites

- Node 24, PostgreSQL 17+, HTTPS reverse proxy, and a persistent encrypted backup volume.
- A migration-owner database login and a separate restricted runtime login.
- SMTP if inviting real staff or allowing email password recovery.
- A dedicated 32-byte base64 `BACKUP_ENCRYPTION_KEY`, retained separately from backup files.
- Production origin, edge rate limits, logging/alerting, and an off-host backup replication policy.

## Provision database and build

1. Create `gymos` database and migration owner through your managed PostgreSQL console.
2. Set `MIGRATION_DATABASE_URL` to the owner connection. Set `DATABASE_URL` to a separate `gymos_runtime` login (not the owner).
3. Run `npm ci`, `npm run db:migrate`, then apply `database/runtime-role.sql` as the migration owner. Provision the runtime password through your secret manager; never commit it.
4. Run `npm test`, `npm run build`, and `npm audit --audit-level=high`.
5. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` temporarily; run `npm run admin:create`. Clear them afterward. Do not run the demo seed in production.
6. Set `NODE_ENV=production`, `APP_ORIGIN=https://your-domain`, and the runtime `DATABASE_URL`.
7. Start `npm start` and one `npm run worker` process under an operating-system process manager or containers.
8. Route HTTPS traffic to port 3001. Keep PostgreSQL and the API upstream inaccessible directly from the public internet. Set `TRUST_PROXY=true` only when direct access is blocked and the reverse proxy overwrites forwarded headers.
9. Verify `/health`, owner invitation/email delivery, real logins, tenant isolation, PDF receipts, worker reminders and a full backup restore before allowing customer data.

## Docker Compose

`compose.yaml` supplies PostgreSQL, API and worker. The DB service uses a migration superuser for provisioning; **do not use it as the API connection**. Start `docker compose up -d db`, provision the restricted role, run migrations/grants using a one-off container, then start API/worker. The API binds only to host loopback; terminate HTTPS in a reverse proxy.

Required Compose environment includes `POSTGRES_PASSWORD`. Application `.env` needs `DATABASE_URL=postgresql://gymos_runtime:...@db:5432/gymos` and a separate migration-owner URL. URI-encode special characters in passwords. Protect `.env` permissions. The container runs as a non-root user. Ensure the mounted backup volume is writable by UID 1000, or provide a pre-provisioned writable volume.

The Docker path has not been executed in the supplied environment because the Docker engine was not running. CI currently verifies embedded PostgreSQL integration tests, TypeScript and the frontend bundle, not a full Docker deployment.

## Backups and restore

`npm run backup` creates an AES-256-GCM encrypted versioned logical snapshot. It writes a temporary file then atomically renames it, and records RUNNING/COMPLETED/FAILED in `backups`. Authentication sessions, pending access links, and external-delivery jobs are deliberately excluded so a restore does not replay messages or revive sessions. Password hashes and customer records are included and must be treated as sensitive.

The worker schedules snapshots when a key is configured, using `BACKUP_INTERVAL_HOURS` (default 24). Run exactly one worker while using this scheduler. Manual operator backups are available through `POST /api/admin/backups` (queued) or the CLI. This is a full-platform backup, never a downloadable cross-tenant file for gym staff.

For restore:

1. Provision a **new empty database**, not the serving production database.
2. Set `RESTORE_DATABASE_URL`, `RESTORE_FILE`, and the original `BACKUP_ENCRYPTION_KEY`. The restore connection must own the new schema so migrations can run.
3. Run `npm run restore`. The command refuses a destination containing organizations or users and validates authenticated encryption before inserting records.
4. Reapply restricted-role grants. Check counts, member history, invoice PDF output, and tenant access. The procedure has automated coverage against embedded PostgreSQL; rehearse with the actual PostgreSQL host before launch.
5. Switch the runtime connection during a maintenance window only after verification. All users must sign in again.

Keep backup encryption keys separate and recoverable. Local volume backups alone do not survive host loss. Copy completed encrypted files off-host using infrastructure tooling; document frequency, retention, deletion and restore drills. Off-host replication and managed point-in-time recovery are not implemented by this repository. Backups are not proof of a disaster-recovery SLA.

## Operations

Monitor HTTP 5xx, database saturation, disk space, failed outbox jobs, and age of last successful backup. `/health` checks application/database connectivity only. Platform health shows external-service configuration, queued/failed jobs and backup history; configuration does not prove email or WhatsApp delivery. Reverse-proxy access logs must redact credentials and avoid request bodies.

Schema updates: backup, apply migrations with owner credentials, deploy the API and worker together, verify health, retain the previous image for application rollback. Do not roll back database files by deleting migration records. Implement a forward repair migration when needed.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.

Local embedded mode permits exactly one API/maintenance process through `.local/database.lock`. Stop the API gracefully before maintenance; inspect the recorded PID before removing a stale lock. Production continues to require PostgreSQL. `HOST` controls server binding. Configure administrators with `node --import tsx scripts/configure-admin.ts <email> <private-password-file>` while the embedded API is stopped. The input file is removed and only the password hash is stored. Never put that input in the frontend or commit it.
