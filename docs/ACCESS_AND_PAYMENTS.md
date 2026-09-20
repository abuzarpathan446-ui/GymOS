# Access controls and member balances

## Account hierarchy

Use `/admin/login` for the platform, `/owner/login` for owners, `/staff/login` for trainers/receptionists/admin staff, and `/member/login` for members. `MANAGER` is the existing database role used for admin staff; no duplicate role system was introduced.

Super Admin → Customer gyms → Details & access provides feature overrides, resource quotas, owner editing, account suspension, users, members, payment activity and login/audit history. Only Super Admin can create owners. The Users tab edits each owner's independent member permissions. Owner member creation, editing and deactivation are denied by default; viewing and member-account setup remain independently configurable.

Owners use Settings → Staff & access to invite, edit, activate/deactivate and restrict staff. Staff cannot exceed their role's permission ceiling. Trainers never receive financial permissions through this editor. Trainer scope defaults to assigned members; an owner can explicitly grant all-member coaching access within the same gym. Receptionists and permitted admin staff can register members and create their portal login using a one-time setup link.

## Policy resolution

`organizations.access_overrides` contains `features` and `limits`. Plan features supply defaults; explicit true grants and false locks override them. WhatsApp click-to-chat, automated WhatsApp and member-created workouts are off unless explicitly enabled. A feature key does not implement its underlying service; automated delivery, AI and other unfinished services remain unavailable even if a key is enabled.

Limits are active members (`member`), total active staff (`staff`), and active accounts per `TRAINER`, `RECEPTIONIST`, `MANAGER`. Invited accounts reserve a staff place. Individual staff limits inherit the aggregate staff limit when unset. Creation and reactivation serialize against the subscription row; quota edits use the same row lock. Lowering a quota does not delete or deactivate existing records. No additional records can be added until usage falls below the quota or Super Admin raises it.

`users.permission_overrides` provides owner member permissions and staff restrictions. These are evaluated on each request, not embedded permanently in a session. `permissionFeature` maps backend permissions to centralized feature checks. The client shows locked navigation and an unavailable screen; the API independently rejects locked access. Export routes also check the underlying resource lock. Expired subscriptions retain permitted core read/export access while restricting writes; explicit manual feature locks still apply.

The owner Subscription page shows effective limits and accepts access requests. Super Admin reviews these under Access requests and applies changes through gym controls. Owners cannot cancel, change or upgrade their own subscription through the API.

## Payments

Membership creation records an immutable agreed `fee_paise` and a payment deadline alongside the historical membership period. The agreed fee uses the server's plan price, discount and tax calculation. Existing memberships are backfilled from their completed payments, preserving their historical paid amounts.

The existing payment form accepts an initial payment smaller than the fee. A deadline is required when a balance remains. Leave initial amount blank for the existing full-payment behavior. Money is stored as integer paise. Overpayments and conflicting reuse of an idempotency key are rejected.

Later installments use `POST /api/memberships/:id/payments`, not another membership purchase. Each installment appends a payment, receipt snapshot and audit/outbox event atomically. It never overwrites earlier payments. The balance is agreed fee minus all completed payments for that membership. Status is PAID, OVERDUE (deadline before today), PARTIALLY_PAID or PENDING, evaluated at read time. Pending payments can receive an audited deadline change.

Full-payment receipt tax/discount behavior is preserved. Partial-payment receipts describe the cash installment; the agreed membership fee is also printed. They are payment acknowledgements, not a replacement for jurisdiction-specific tax invoicing. Refunds, reversals and external payment-provider verification are not implemented.

Expenses are append-only through the app. Owner business summaries show all-time, daily, monthly and yearly cash receipts, recorded expenses, and profit/loss (receipts minus expenses). They do not claim accrual-accounting profit or provider reconciliation. Expenses and financial reports are separately feature-gated.

## Staff attendance

Login creates a server-side session and history row. A new login closes the preceding session to prevent overlapping session durations. Logout, password reset and account deactivation revoke sessions and record an end reason. Expired sessions show offline and their duration is capped at expiry. Working duration means authenticated session time, not verified physical presence or payroll attendance. The owner can refresh the Staff attendance page to see current presence.

## WhatsApp and coaching

The paid optional WhatsApp feature prepares welcome, expiry, expired and balance messages through authorized backend retrieval. The reminder screen automatically selects memberships expiring in three days and expired memberships without a later renewal. Staff review the text, open WhatsApp, and send themselves. `PREPARED` never means sent or delivered. Authorized Business API automation and provider billing remain a separate unimplemented integration.

The shared workout editor supports days, muscle groups, exercises, sets, reps, weights, rest and notes. Trainers can edit only assigned members' plans unless explicitly given broader gym-local scope. Members can view their own plans; the optional `member_workouts` entitlement enables creation/editing of their own authored plans, never modification of trainer-authored plans. Member attendance percentage is unique present dates divided by elapsed calendar days in the current month; it does not imply a gym-opening-day schedule.

Member profile photos accept PNG/JPEG up to 160 KB and are stored in the existing tenant record. This small-image facility is not a general object-storage implementation.

## Local operation and recovery

Production requires PostgreSQL. Local PGlite uses `.local/database.lock` to prevent a second process from opening the same directory. Use one development command and stop it gracefully. If a process crashes, inspect the lock's PID and confirm it is no longer running before removing that lock; do not remove locks from active processes. Never run seed, migration or maintenance scripts concurrently with the embedded API.

The September 20 extension encountered a damaged local checkpoint while two development APIs had been running. A separate recovery copy was opened, closed, reopened, migrated and used for live portal smoke checks. Recovered counts before the new administrator: 1 organization, 7 users, 21 members, 21 memberships, 21 payments, 21 invoices and 12 attendance rows. `.local/database-original-checkpoint-damaged` and `.local/database-before-access-update` preserve the original material. Checkpoint recovery cannot prove that every uncheckpointed transaction survived. Review recent real business entries against external records before treating this local database as authoritative. No automatic WAL repair is part of the application. The separately reviewed recovery approach is documented in the [PGlite upstream recovery discussion](https://github.com/electric-sql/pglite/pull/994).

The one-time administrator configuration script accepts an email and a private password-file path. It removes the input before connecting, hashes the password, refuses to elevate a tenant account, and invalidates prior sessions. Do not place password files under `dist/web` or commit them. The configured local Super Admin email is `AbuzarPathan@gymos.com`; its password is not documented here.

After migration and account configuration, an encrypted local snapshot at `.local/post-update-backup.enc` was restored into a fresh database and compared: 1 gym, 8 users, 21 members, 21 memberships/payments/receipts, 12 attendance rows, and 5 login-history entries matched. Existing full-payment membership fees reconciled to their payments. Its separate `.local/post-update-backup.key` is private; keep a secure off-host copy of both the encrypted snapshot and its key. This validates the recovered snapshot, not the survival of unknown pre-recovery transactions.
# Super Admin owner passwords

The Add Gym / Add Owner forms accept an optional password (12–128 characters). When provided, the backend stores a salted scrypt hash and creates the account without a setup email or link. Leaving it blank preserves the existing invitation workflow. A manually assigned password does not verify the owner's email.

## Owner payments and access revocation

WhatsApp click-to-chat uses the WhatsApp account signed in on the owner's or staff member's device. Each gym should sign in or link its own gym number. GymOS prepares the recipient and message but cannot enforce or verify the sender number through a click-to-chat link. Automated messaging is not enabled; any future activation requires that gym's own authorized WhatsApp Business connection and provider billing. The Super Admin only controls the feature entitlement.

Super Admin can optionally record an initial GymOS payment in Add Gym / Add Owner. The account and payment are saved in one transaction. The separate **Owner Payments** navigation lists payment history with gym, owner, amount, date, method, reference, notes and recorded-by details. Search filters by gym, owner or email; totals reflect the filtered history. Additional payments are recorded separately, with idempotency keys preventing duplicate submissions.

`GET /api/admin/owner-payments` accepts `q` and `page`; `GET /api/admin/owner-payments/accounts` searches up to 50 owner accounts; `POST /api/admin/owner-payments` accepts owner_id, amount_paise (positive integer), paid_on (ISO date), method, reference, notes and idempotency_key (UUID). Add Owner APIs accept the same payment payload without owner_id as optional initial_payment. These are manual receipts of money already collected, not provider-verified charges or automatic subscription changes. Migration 006 adds the separate immutable owner_payments ledger with platform-only RLS. Encrypted backups include it; older backups restore with an empty ledger.

**Gyms → Details & access → Users → Edit owner → Revoke Owner Access** requires confirmation. It deactivates the owner, revokes sessions and consumes unused access tokens. It retains the owner record, gym operations and financial history. Super Admin can explicitly restore login using the existing Active account status and issue a new password if needed.

In Customer gyms, open the gym's owner account controls and choose **Set / reset owner password**. `PUT /api/admin/owners/:id/password` accepts `{ "password": "<new password>" }`, requires Super Admin authentication and CSRF protection, and only targets OWNER accounts. It atomically replaces the hash, consumes outstanding access tokens, revokes sessions and records `owner.password_changed` without the password in audit metadata. It does not reactivate a suspended/deactivated owner. Existing passwords cannot be viewed or recovered; the Super Admin assigns a replacement and shares it privately.
