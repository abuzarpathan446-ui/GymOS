# Database

PostgreSQL 17+ in production; PGlite PostgreSQL for local development and isolated tests. UUID primary keys, database timestamps, strict check constraints, unique indexes, and composite tenant foreign keys enforce business rules.

## Migrations

| Migration | Scope |
| --- | --- |
| 001_foundation.sql | Organizations, branches, users, sessions, access tokens, platform plans, subscriptions, audits, outbox |
| 002_operations.sql | Members, membership plans/history, payments, invoices, attendance, trainers, assignments, workouts, progress, CRM, appointments, inventory, notifications, automation, messages, backups |
| 003_isolation.sql | Forced row security and composite user/member organization constraint |
| 004_manual_account_setup.sql | Separate manual SETUP tokens from email-based invitation/verification tokens |

`schema_migrations` records successful migration files. Each file runs transactionally under an advisory lock. Run migrations with the migration-owner connection before application rollout. The production runtime never migrates automatically. Treat applied migrations as immutable; add a new file for schema changes.

## Core relationships

```text
organizations -> branches, users, subscriptions
organizations -> members -> memberships -> payments -> invoices
members -> attendance, trainer_assignments, workouts, body_measurements, appointments
trainers -> trainer_assignments, appointments
inventory -> inventory_transactions
organizations -> audit_logs, notifications, automation_rules, message_logs
```

Members have a globally generated display number (`GYM-000001`) and an opaque random QR token. Numbers are not secrets and need not be sequential within a gym. QR identifiers contain no name, contact information, or membership details.

Membership dates are inclusive: a 30-day period beginning September 1 ends September 30. Status is stored for ACTIVE/TRIAL/FROZEN/CANCELLED; expiration is derived from dates. Freeze records preserve freeze use and extend the end date by the allowed elapsed days on unfreeze. Renewals never overwrite prior periods. Frozen periods block check-in.

An open-attendance partial unique index prevents a second active entry. Payment idempotency keys are unique per organization. Non-null external transaction references are unique per organization and method. Invoice snapshots retain receipt values even if member or gym details change. Audit and invoice update/delete triggers reject mutations.

## Access model

Apply `database/runtime-role.sql` after migrations with the trusted migration login. Supply a strong runtime password separately. Do not expose PostgreSQL publicly. Tenant RLS does not replace application permission checks. Never run the API with the Docker-created migration superuser.

## Retention and exports

Cancelling a platform subscription blocks new entitled operations without deleting business history. Deactivating a member retains records. CSV exports include up to 50,000 rows per domain; larger exports need an asynchronous extension. Exports escape spreadsheet formulas. Full-platform backups are operator-only and contain password hashes and customer personal data in encrypted form.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.
