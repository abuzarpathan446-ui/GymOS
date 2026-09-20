# Architecture

## Decisions

GymOS is a modular monolith. A React single-page application calls a same-origin Fastify API. PostgreSQL stores both platform and gym records. A separately deployed worker claims database outbox jobs. This avoids per-gym infrastructure and an extra queue service for the initial deployment.

The original recommendation allowed React and suggested FastAPI. This implementation uses a TypeScript API because Node 24 was available and Python was not runnable in the supplied workspace. Validation is provided by Zod; SQL is parameterized through `pg`. Migrations are explicit SQL rather than automatic production schema synchronization.

## Request boundary

1. Validate origin for browser mutations.
2. Hash the opaque session cookie and load an active, unexpired server-side session.
3. Verify CSRF token on mutations.
4. Authorize the role for a named permission.
5. Open a database transaction and set transaction-local organization/platform context.
6. Verify organization status.
7. Validate request fields with strict schemas; tenant identifiers are not accepted in tenant write bodies.
8. Check centralized subscription entitlement and quota where applicable.
9. Perform scoped SQL operations, create audit records and transactional outbox events.
10. Commit before reporting success.

`security.ts` owns the permission matrix; `entitlements.ts` owns subscription access and quotas. Platform users have a dedicated authentication endpoint and console, and do not inherit ordinary gym permissions. Trainer operations additionally verify member assignment.

## Tenant boundaries

Tenant-owned tables contain organization IDs. Composite foreign keys prevent cross-organization relationships. Explicit SQL tenant predicates protect application paths; PostgreSQL RLS provides a second boundary. The production runtime login must neither own tables nor have `SUPERUSER`/`BYPASSRLS`; forced policies cover business tables. Auth/session tables require explicit private service queries because login begins before a tenant is known.

Organization and platform context is set through `set_config(..., true)` inside a transaction. Connections never retain another request's tenant context after commit/rollback. Platform context is enabled only after `SUPER_ADMIN` authorization or in trusted maintenance/worker code.

## Money and membership history

Money is integer paise; tax is integer basis points, rounded once to paise. A payment records an actually received offline payment. It never initiates or verifies a card/UPI charge. The API calculates totals from the server-side plan, checks an idempotency key and request hash, locks the member, rejects overlapping membership periods, then writes payment, membership, immutable receipt snapshot, audit and event atomically. Renewals insert a new period.

## UI

React Router separates platform and tenant screens. Navigation uses server-returned permissions; backend authorization remains authoritative. Data hooks handle loading/errors/retry, forms provide validation feedback, dialogs use native focus trapping, lists use actual database records. CSS variables support light and dark themes with a persistent preference. No dashboard metric is a hardcoded business value.

## Background processing

PostgreSQL `FOR UPDATE SKIP LOCKED` claims queued jobs. Email uses SMTP with TLS. Missing configuration causes explicit errors. Failed jobs retry up to five times, then remain visible as failed. Reminder notifications use unique keys to prevent duplicate daily reminders. Email is at-least-once delivery; a crash after SMTP acceptance can produce a duplicate. One worker instance is currently supported for backup scheduling. Outbox is not an exactly-once external delivery guarantee.

## Current operational constraints

India/INR is the supported initial market; reporting and transaction dates use Asia/Kolkata. Multi-branch records exist, but branch-specific permissions and centralized branch switching are not implemented. Permissions are centralized but not tenant-customizable. In-process HTTP rate limits require a single API instance plus edge limits; add a shared rate-limit store before horizontally scaling. Portable backups currently load the snapshot into memory and briefly block writes; use an off-peak schedule and benchmark realistic data volumes.

## References

Implementation references: [PostgreSQL row-security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) and [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). Operational configuration and launch status are documented separately.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.
