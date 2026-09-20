# GymOS

A TypeScript/React gym operations application with a Fastify API, PostgreSQL data model, tenant authorization, server sessions, and database-backed business workflows.

**Status: implemented core with automated coverage; not yet approved for a commercial production launch.** See [delivery status](docs/DELIVERY_STATUS.md) for implemented functionality, limitations, and remaining acceptance criteria. This repository does not simulate payments, WhatsApp delivery, or AI responses.

## Quick start

Requires Node.js 24+. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm ci
cp .env.example .env
```

Set `SEED_PASSWORD` in `.env` to a unique development password of at least 12 characters, then:

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

Alternatively, on a fresh checkout without `.env`, `npm run demo:setup` generates local credentials, configures `.env` and seeds the database. Credentials are stored only in ignored `.local/demo-access.txt`. Do not use generated demo accounts in production.

Open **http://localhost:5173**. Development login accounts use the configured seed password:

| Role | Email | Login page |
| --- | --- | --- |
| Owner | owner@gymos.test | /owner/login |
| Manager | manager@gymos.test | /staff/login |
| Receptionist | reception@gymos.test | /staff/login |
| Trainers | trainer1@gymos.test, trainer2@gymos.test | /staff/login |
| Member | member@gymos.test | /member/login |
| Platform admin | admin@gymos.test | /admin/login |

`/login` shows all four login choices. Each API login endpoint rejects roles outside that portal. Staff and trainers share one login page but keep their existing individual permissions. All portals share one browser session; sign out before switching accounts.

The Business/Enterprise member portal displays only the authenticated member’s own membership, attendance, workouts, progress, payments, appointments and QR card. Owners and receptionists can create member logins from a member profile after adding a unique email address. The local demo member is linked to the first seeded member and uses `SEED_PASSWORD`. To add that account to an older local development database, stop the API, run `node --import tsx scripts/demo-member.ts`, then restart the API. The helper refuses production/external databases and does not reset existing accounts.

## Account creation hierarchy

- **Super Admin → Gyms → Add gym & owner** creates a gym and owner account. **Add owner account** on a gym row adds another owner to that gym. New gyms default to a 14-day Business trial so member access can be evaluated.
- **Owner → Settings → Staff & access → Add staff account** creates a Manager, Trainer or Receptionist. Trainer accounts automatically get a trainer profile. Staff entitlements and quotas still apply.
- **Receptionist or Owner → Members → member profile → Create member login** links a MEMBER account to that exact gym member. Register a new member first if needed. Trainers, managers and members cannot create member accounts or staff accounts.
- Choose **Copy a one-time setup link** to work without SMTP. Share the link privately with the account holder; they must be signed out before opening it, then choose their password and use their designated login page. Links expire in 48 hours and work once. Raw manual tokens are not stored or audited, and manual setup does not claim email verification.
- **Send setup email** remains available when SMTP and the worker are configured. The UI reports queued delivery, not a sent message. Accounts show “Awaiting password setup” until a password exists.

The development seed creates one gym, two membership plans, 20 members, payments and invoices, attendance, three leads, two trainers, assignments, and four appointments. It is an explicit development-only command, refuses production, and never runs on server startup.

Without `DATABASE_URL`, local development uses persistent PGlite (embedded PostgreSQL) in `.local/database`. **Only one process may open that directory.** Stop the server before migrations, seeds, or offline backups. Use real PostgreSQL when running API and background worker together. Production refuses the embedded database.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API on 3001 and Vite on 5173 |
| `npm run build` | Strict TypeScript checks and frontend production bundle |
| `npm start` | API and built frontend on 3001 |
| `npm test` | Isolated embedded PostgreSQL integration tests |
| `npm run db:migrate` | Apply versioned SQL migrations |
| `npm run admin:create` | Create administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `npm run worker` | PostgreSQL outbox, reminders, email, scheduled backups |
| `npm run backup` | Encrypt a consistent logical database snapshot |
| `npm run restore` | Restore into a separate empty migrated database |

## Project layout

```text
apps/api/src/       API, authorization, domain operations, background worker
apps/api/test/      Security and workflow integration tests
apps/web/src/       React workspace, platform console, reusable UI, theme tokens
database/migrations/  Ordered transactional schema migrations
database/runtime-role.sql  Restricted production database grants
scripts/           Migration, seed, administrator and backup entry points
docs/              Delivery status and implementation references
```

Read [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API.md](API.md), [DEPLOYMENT.md](DEPLOYMENT.md), [SECURITY.md](SECURITY.md), [ENVIRONMENT.md](ENVIRONMENT.md), and [TESTING.md](TESTING.md) before operating a deployment.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.
# GitHub synchronization

Code is maintained at [abuzarpathan446-ui/GymOS](https://github.com/abuzarpathan446-ui/GymOS). See [GitHub sync setup and controls](docs/GIT_SYNC.md) for automatic commits after validation, Windows startup, status logs, pausing and manual synchronization. Local databases, credentials and backups are excluded from Git.
