# Security model and remaining review

## Implemented boundaries

- Salted scrypt password hashing (`N=32768,r=8,p=1`, 64-byte key), constant-time hash comparison, minimum 12-character new passwords, maximum input lengths.
- Random 256-bit opaque session IDs; only SHA-256 hashes stored. HttpOnly, SameSite=Strict cookies, Secure in production. Sessions expire and can be revoked. Password reset invalidates all user sessions and consumes all outstanding access links.
- Separate platform-admin and tenant login endpoints; central role permissions; no client-controlled tenant context.
- Strict Zod request validation and bound SQL parameters. Resource lookups include tenant restrictions and inaccessible records return generic not-found errors.
- Forced PostgreSQL RLS on tenant business tables, composite tenant foreign keys, non-bypass production login checks.
- Per-session CSRF headers for authenticated mutations and same-origin request checking. No cross-origin CORS credential policy.
- Helmet headers and a production CSP; React text rendering; no raw HTML rendering of user strings.
- Per-process HTTP and login rate limits. Redacted authentication headers and generic server error responses.
- Immutable invoice and audit records, quota locking, payment idempotency and transactional outbox writes.
- AES-GCM backups; generic password-recovery responses; CSV formula escaping.

## Roles

Owner: tenant operations within feature controls; member creation/editing/deactivation require explicit Super Admin grants. Manager: operational management without owner settings/subscriptions/staff administration. Receptionist: dashboard, members, payments, attendance, leads, appointments and notifications. Trainer: assigned members, workouts, progress and own appointments. Member: self-service reads resolved from the active user-to-member link; no general tenant-data access. Super admin: dedicated platform functions only.

Four login endpoints enforce role allowlists: admin, owner, staff (manager/receptionist/trainer), member. The legacy `/api/auth/login` is an owner-only alias. Member APIs reject client member identifiers, omit private staff notes and payment internals, and recheck member activity and subscription entitlement on every request. Super Admin creates OWNER accounts, owners create staff/trainer/reception accounts, and receptionists or owners create linked MEMBER accounts using the dedicated `members:account` permission. The member account endpoint never lets the browser select a role or tenant. Permitted admin staff can create linked member accounts; trainers cannot create accounts.

Account setup can use an emailed INVITE token or a privately shared SETUP link, both single-use and expiring after 48 hours. Manual links are returned only to the authorized creator over a no-store response; only their hashes are stored. They are not written to audit logs, sent to analytics, or placed in URL query strings. Manual setup does not set `verified_at`, since it does not prove ownership of the email address. No password is assigned until the holder completes setup. Setup links are credentials: copy them only to the intended account holder. SMTP is required only for email delivery mode.

## Important limitations

Authentication tables are private service tables rather than tenant-RLS tables because login must locate a user before organization context exists. Database credentials are therefore a privileged trust boundary. Session-derived tenant values must never be replaced with request values. RLS context is set by trusted application code; it does not defend against arbitrary SQL execution using stolen database credentials.

No MFA, account lockout by email, breached-password check, recovery codes, device/session management UI, or independently reviewed penetration test yet. Rate limiting is per API process, so horizontally scaled deployments need a shared limiter and edge protection. `TRUST_PROXY=true` is safe only behind an isolated trusted proxy. Authentication email verification occurs through invite/reset link completion; optional mandatory verification for other registrations is not implemented.

Multi-branch restriction policies remain later work. Owner and staff permission editing is implemented within fixed role ceilings. Full-platform backup permissions are operator-only; gym exports are scoped. Production secrets must be provided through deployment configuration rather than source code.

## Before launch

Run security tests against the actual restricted PostgreSQL role, including concurrent requests across tenants. Independently review the auth flows, endpoint permission map, migration grants, reverse proxy, storage, logs and retention. Verify invitations, reset emails and session cookies over real HTTPS. Rehearse restore and validate every externally integrated provider in a sandbox. Maintain dependency scans; passing an npm audit is not a security certification.

Report security issues privately to the deployment operator. A public vulnerability-disclosure contact and incident procedure must be established before commercial launch.
