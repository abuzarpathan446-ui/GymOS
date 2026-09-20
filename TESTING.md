# Verification

Run `npm test`, `npm run build`, and `npm audit --audit-level=high`.

The test suite starts fresh in-memory PostgreSQL using PGlite and the real migrations. It exercises real Fastify handlers and database transactions with `app.inject`; it does not mock repository results. Test fixtures are isolated and discarded after completion.

## Automated coverage

- Salted password hashing, wrong-password rejection, anonymous denial.
- Admin versus gym login boundary, role denial, origin and CSRF denial.
- Rejecting client tenant injection; another gym cannot view/update/regenerate QR/pay for a foreign member.
- Payment total validation, receipt creation/PDF bytes, idempotency replay, changed-body conflict, overlapping-period rejection.
- Tenant-scoped QR resolution, valid check-in, missing membership denial, duplicate entry prevention, checkout and repeated-checkout denial.
- Freeze/unfreeze eligibility and entry restrictions; renewal retains old periods.
- Subscription expiration, readable retained data, plan limits and feature downgrade/upgrade gating.
- Immutable audits and receipt snapshots.
- Inventory history and prevention of negative stock.
- Trainer assignment boundaries and appointment conflict checks.
- Encrypted logical backup/restore, invoice preservation, excluded sessions, corrupted ciphertext rejection, nonempty destination refusal.
- Direct SQL RLS tests under a non-superuser/non-bypass role, including denied foreign-tenant inserts.
- Single-use password reset and session revocation; logout revokes stored session.

## Verification performed in this workspace

All 30 integration tests passed, including the account-creation hierarchy, persisted dashboard/report totals, role allowlists across all four portals, same-gym and cross-gym member ownership boundaries, private-field exclusions, deactivation/entitlement checks, and member invitation handling. Account tests exercise Super Admin creating owners for new/existing gyms, owners creating all three staff roles, reception registering a member and creating its login, single-use manual setup links, no false email verification, rejection of cross-tenant/role injection and rollback on quota/duplicate failures. The logout regression uses the actual frontend API helper with real Fastify handlers, checks all portal roles, verifies cookie removal and rejects reuse of revoked session cookies. TypeScript checking and Vite production build are also required. The earlier dependency audit reported zero findings. A running-server smoke check authenticated against the persistent development database and successfully read all 16 implemented owner API domains, then logged out.

Logout regression: the shared client previously declared `application/json` for POST requests without a body, causing Fastify to return 400 before the logout handler ran. The client now sets that header only when sending a JSON body. The sign-out button also handles loading/failure visibly and replaces the current route on success.

The four-login production build passed. `node scripts/smoke-portals.mjs` verified live Super Admin, Owner, Receptionist, Trainer and Member sign-in, role destinations, member record pages, and logout against the persistent demo database. Browser visual verification remains blocked by the browser tool’s environment metadata error.

The supplied Windows environment required execution outside the filesystem sandbox for `tsx` (Windows account lookup) and Vite (workspace path resolution). Scripts use direct Node entry points because Windows `.cmd` shims broke on the `&` character in the workspace path.

## Not yet verified

- Browser visual/interaction/accessibility QA: the in-app browser tool failed to initialize with an environment metadata error.
- A standalone PostgreSQL server, Docker Compose startup, actual HTTPS reverse proxy, production restrictive grants and production workload concurrency.
- SMTP delivery, real customer invitations, provider-based payment verification, automated WhatsApp delivery or external AI.
- Restore on the intended managed PostgreSQL provider, off-host disaster recovery, large-data backup resource usage.
- Cross-browser layout, screen-reader review, sustained load testing and independent penetration review.

## Required staging walkthrough

Create a gym from the platform console, receive invitation email, set owner password, create staff and plans, register a member, record a real sandbox/offline payment, download a PDF, regenerate and scan QR, check out, freeze/unfreeze, renew without losing history, export reports, downgrade to a restrictive plan and confirm data retention. Repeat under a second gym and malicious resource IDs. Confirm trainer scope and disabled-account rejection. Execute a backup, restore to a new DB and compare records. Test dark mode and mobile layouts in a browser.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.

The expanded suite has 41 passing tests. New coverage includes owner-default denial, manual grants/locks, concurrent member quota enforcement, per-role staff quotas/reactivation, tenant isolation, installments/overpayment/idempotency, financial scope, staff session history, trainer/member plan editing, WhatsApp preparation, staff permission ceilings and encrypted restore of all new tables. Live login, authorized reads and logout passed for the configured administrator and existing owner, reception, trainer and member accounts. Browser visual verification remains blocked by the browser connection error.
