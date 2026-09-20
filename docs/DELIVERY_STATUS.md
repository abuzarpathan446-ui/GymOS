# Delivery status

GymOS is **not production-ready yet**. This document distinguishes working implemented flows from schema foundations and remaining requirements. Do not interpret a plan feature name, environment variable or database table as completed product functionality.

## Implemented with automated core coverage

- React gym workspace and separate Super Admin console; reusable forms, dialogs, tables, error/retry/empty/loading states; responsive CSS and persistent light/dark themes.
- Password login, logout, expiring/revocable sessions, password reset/invitation token handling, account activation flags, centralized RBAC and tenant authorization.
- Four distinct role-restricted login pages and a member portal for personal membership, attendance, workouts, progress, payments, appointments and QR access. Super Admin creates owners, owners create staff, and owners/receptionists create member logins. One-time setup links work without email; optional email delivery uses the outbox. Member self-booking, notifications and receipt download are not yet included in this portal.
- SQL migrations, composite tenant constraints, forced row-level security and an explicit restricted-role deployment model.
- Member create/read/edit/search/filter/pagination/deactivation, opaque QR generation and regeneration.
- Membership plan creation; immutable historical membership periods; renewal, tax/discount validation, freeze/unfreeze.
- Offline payment recording with idempotency, atomic membership/invoice/audit creation, downloadable actual PDF receipt.
- Member/QR check-in, duplicate prevention, exit logging, attendance history.
- Actual database dashboard metrics, revenue chart, expiring memberships, notifications, CSV member/payment/attendance exports and financial/attendance reports.
- Subscription plans/entitlements/quotas, trial provisioning, manual administrative plan changes, suspension/cancellation without data deletion.
- Admin gym creation with queued owner invitation, organization activation/suspension/deactivation, platform metrics, user list, audit list, service configuration/job/backup visibility.
- Staff invitations/deactivation, trainer assignments, workout creation/editing, body measurement recording, CRM stage updates and explicit member conversion link, appointment conflict checks, stock changes with immutable audit history.
- Transactional outbox, SMTP transport, background notification reminders and configurable reminder dates.
- Encrypted full-platform logical backups, scheduled/manual operator paths, tested restore to an empty database.
- Separate development seed, CI configuration, environment template, Docker/deployment instructions and developer documentation.

See [access and payment extensions](ACCESS_AND_PAYMENTS.md) for configuration, defaults, accounting semantics, and the local checkpoint-recovery incident. The requested local Super Admin account is configured; live sign-in and logout passed for all four portals.

## Partial implementations and boundaries

- SMTP code is implemented; real delivery is untested and needs valid provider configuration. Queue acceptance is not delivery confirmation.
- Workout creation and editing now support multiple exercises, days and muscle groups. Progress charts remain.
- Core member/payment/attendance lists paginate; operational/admin lists have bounded 100-record views and need pagination.
- Backup is currently a full-platform operator workflow, not per-gym self-service restore. Local encrypted snapshots need off-host replication. Standalone PostgreSQL restore must be rehearsed.
- Reports cover payment method totals, daily attendance and CSV exports. Advanced trainer/inventory/renewal reports and PDF/Excel reports remain.
- Owner account editing/suspension, gym-level feature/limit controls, access requests and login/activity views are implemented. Full gym profile editing, owner recovery shortcuts, storage metrics and provider billing events still need expansion.
- Onboarding has create/invite and gym/staff/plan settings, but no full guided completion wizard yet.
- Subscription statuses are enforced, but lifecycle billing automation, scheduled plan transitions, provider checkout, proration and webhook verification are not implemented.
- API documentation is maintained in Markdown; generated OpenAPI specification remains.
- Small member PNG/JPEG photos are implemented. Gym logos, object storage, receipt branding and digital receipt sending remain.
- Partial payments, balance/deadline status, append-only installments, expenses and cash-basis profit/loss are implemented. Refunds and financial reconciliation remain.

## Not implemented

- Automated WhatsApp Business sending, delivery webhooks, consent management, message templates/quotas/cost accounting. Click-to-WhatsApp is available; sending remains with the staff member.
- Full event-rule management UI and marketing automation; current configured notification rules and expiry reminders are a foundation.
- Online GymOS customer billing/payment-provider integration.
- AI assistant, advanced analytics, multi-branch authorization/switching and white labeling (later phases in the specification).
- MFA, shared distributed rate limiting, comprehensive email-verification policy. Custom owner member permissions, staff restrictions and gym feature controls are implemented.
- Full production acceptance across external services, independent security review, browser QA, load testing, and real server deployment.

## Latest verified checkpoints

- 41 automated integration tests passed, including new access/limit/partial-payment/staff-attendance/restore coverage and the complete account-creation hierarchy, single-use password setup without SMTP, role escalation denial, tenant isolation, encrypted restore, four login endpoints and logout through the actual frontend request helper.
- Strict TypeScript and Vite production build passed.
- npm audit reported zero vulnerabilities after patching dependencies.
- Persistent local server smoke check passed: login, 16 owner API reads and logout. Local frontend runs on port 5173; API on port 3001.
- Four-login update: production build and live admin/owner/staff/trainer/member authentication checks passed; linked demo member pages and QR endpoint returned successfully.
- Browser bootstrap failed due to environment tooling; no claim of visual browser verification.
- Docker engine was stopped; no claim of a tested Docker or managed PostgreSQL deployment.

The remaining list is an explicit launch gate, not an assertion that credentials alone will complete the product.
