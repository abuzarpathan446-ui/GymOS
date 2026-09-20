# API reference

Base path `/api`. JSON request/response bodies. IDs are UUIDs unless documented otherwise. Authentication uses the HttpOnly `gymos_session` cookie. Authenticated mutations must include `X-CSRF-Token` from `/auth/me` or login and a same-origin browser request. Cross-origin credential sharing is not enabled.

Errors: `400` invalid fields/references, `401` unauthenticated/expired session, `403` permission/tenant status/entitlement denial, `404` inaccessible resource, `409` duplicate/overlap/quota conflict, `429` rate limit, `500` generic internal failure, `503` missing required service configuration. Field-validation responses contain `error` and `fields: [{path,message}]`. Stack traces are not returned.

## Authentication

| Method | Path | Input | Result / permission |
| --- | --- | --- | --- |
| POST | /owner/auth/login | email, password | user, CSRF, session cookie; OWNER only |
| POST | /staff/auth/login | email, password | MANAGER, RECEPTIONIST or TRAINER only |
| POST | /member/auth/login | email, password | MEMBER only |
| POST | /auth/login | email, password | backwards-compatible OWNER-only alias |
| POST | /admin/auth/login | email, password | platform administrator only |
| GET | /auth/me | — | user and permissions |
| POST | /auth/logout | — | revoke session; authenticated + CSRF |
| POST | /auth/forgot-password | email | generic queued response; configured SMTP required |
| POST | /auth/reset-password | token, password | consume invite/reset, replace hash, revoke sessions |

## Gym operations

Member portal: authenticated MEMBER users can GET `/member/dashboard`, `/member/qr`, `/member/membership`, `/member/attendance`, `/member/workouts`, `/member/progress`, `/member/payments`, `/member/appointments`. List routes accept only `page` (25 records, response `{items,page,has_more}`). Member identity comes from the session account link; supplied member/tenant IDs are rejected. All reads require an active member and the `member_portal` entitlement. Owners and receptionists POST `/members/:id/portal-invitation` with `{delivery:"LINK"}` or `{delivery:"EMAIL"}` to create a linked MEMBER account. Only these roles have `members:account`; this permission does not grant staff management.

Account creation endpoints (`POST /admin/gyms`, `/admin/gyms/:id/owners`, `/staff`, `/members/:id/portal-invitation`) accept `delivery: LINK|EMAIL`. Omitted delivery defaults to EMAIL for compatibility. LINK returns `status: LINK_CREATED`, a one-time `setup_url`, `email`, `login_path`, and `expires_in_hours:48`; it queues no email. EMAIL returns `status: QUEUED` and no raw link; missing SMTP/from configuration returns 503 and the transaction rolls back. Neither mode sets a default password. Password setup consumes the token through `/auth/reset-password`.

| Method | Path | Input / query | Permission |
| --- | --- | --- | --- |
| GET | /dashboard | — | dashboard |
| GET | /members | page, search, status | members:read |
| POST | /members | name, phone; optional email, dob, gender, address, emergency_contact, source, notes | members:write |
| GET | /members/:id | — | members:read |
| PATCH | /members/:id | complete profile as for creation | members:write |
| POST | /members/:id/deactivate | — | members:write |
| GET / POST | /members/:id/qr | get / regenerate opaque QR | members:read / members:write |
| GET | /membership-plans | — | members:read |
| POST | /membership-plans | name, duration_days, price_paise, optional tax_bps, freeze_days, benefits, trial | memberships |
| POST | /memberships/:id/freeze | — | memberships |
| POST | /memberships/:id/unfreeze | — | memberships |
| GET | /payments | page | payments |
| POST | /payments | See example below | payments |
| GET | /invoices/:id/pdf | — | payments |
| GET | /attendance | page | attendance |
| POST | /attendance/check-in | member_id OR qr | attendance |
| POST | /attendance/:id/check-out | — | attendance |
| GET / POST | /leads | name, phone, source, notes, follow_up_on for create | leads |
| PATCH | /leads/:id | status, member_id required for CONVERTED | leads |
| GET | /trainers | — | trainers |
| POST | /trainers/:id/assign | member_id | trainers |
| GET | /assigned-members | — | trainer |
| GET / POST | /workouts | member_id, name, exercises[] | workouts; trainer assignment checked |
| GET / POST | /progress | member_id, weight_kg, height_cm, body_fat, measured_on | progress; trainer assignment checked |
| GET / POST | /appointments | member_id, trainer_id, starts_at, ends_at, notes | appointments; trainer ownership checked |
| PATCH | /appointments/:id | status: COMPLETED or CANCELLED | appointments |
| GET / POST | /inventory | name, sku, category, minimum_stock, purchase_paise, selling_paise, supplier | inventory |
| POST | /inventory/:id/stock | delta, reason | inventory |
| GET | /notifications | — | notifications |
| POST | /notifications/:id/read | — | notifications |
| GET | /reports | from, to (YYYY-MM-DD) | reports |
| GET | /reports/:kind/csv | members, payments or attendance | reports |
| GET / PATCH | /settings | name, email, phone, address, inactive_days, reminder_days | settings |
| GET / POST | /staff | name, email, role for invitation | staff |
| PATCH | /staff/:id | active | staff |
| GET | /subscription | — | subscription |
| POST | /subscription/cancel | — | subscription |
| GET | /audit-logs | latest 100 | audit |

Member, payment and attendance lists return `{items,total,page}` with 25 rows/page. Other operational lists currently return `{items}` capped at 100. Member detail returns recent 100 records per history domain. Date-times use ISO 8601 with timezone. Never send organization_id in tenant write bodies.

### Record payment example

```json
{
  "member_id": "00000000-0000-4000-8000-000000000001",
  "plan_id": "00000000-0000-4000-8000-000000000002",
  "starts_on": "2026-10-01",
  "amount_paise": 150000,
  "discount_paise": 0,
  "method": "CASH",
  "idempotency_key": "00000000-0000-4000-8000-000000000003"
}
```

Use a new idempotency key for each intended payment and retain the same key/body for retries. Success contains `payment`, `membership` and `invoice`; replay returns the existing payment with `replayed: true`. Non-cash methods require a transaction_id. Prices/tax come from the server plan. All writes roll back together on errors.

Exercises contain day, name, sets, reps, weight, rest_seconds, notes. Body progress accepts historical dates. Appointment intervals must have positive duration and cannot overlap a scheduled session for either the trainer or member.

## Platform administration

All require platform permission, separate administrator login, and CSRF on mutations.

| Method | Path | Input / result |
| --- | --- | --- |
| GET | /admin/dashboard | aggregate metrics and recent audits |
| GET / POST | /admin/gyms | create: name, slug, owner_name, email, phone, plan_id (defaults BUSINESS), delivery |
| POST | /admin/gyms/:id/owners | platform only: name, email, delivery; adds OWNER to an active existing gym |
| PATCH | /admin/gyms/:id | status ACTIVE/SUSPENDED/DEACTIVATED |
| PUT | /admin/gyms/:id/subscription | plan_id, status, renews_at, optional grace_until |
| GET / PATCH | /admin/plans/:id | list uses /admin/plans; update price_paise, member_limit, staff_limit, features |
| GET | /admin/users | safe profile fields, no hashes |
| GET | /admin/system-health | DB, configuration, job and backup status |
| GET | /admin/audit-logs | latest 100 platform audits |
| POST | /admin/backups | queue encrypted operator backup; returns QUEUED, never claims completed |

`GET /health` is outside `/api`, does not require authentication, and returns 200 only if the database responds.

The Zod schemas in the API source are the executable validation contract. A generated OpenAPI document is not yet provided.

## Access and business extensions

All paths below have `/api` prefix. Mutations require the session CSRF header. Invalid fields return 400, unauthorized or locked access 403, foreign/missing IDs 404, quota/idempotency/overpayment conflicts 409. Tenant context always comes from the session.

| Method | Path | Permission and contract |
| --- | --- | --- |
| GET | /admin/gyms/:id/details | platform; section=overview/users/members/payments/activity/logins, page; overview includes financial totals, policy and usage |
| PUT | /admin/gyms/:id/access | platform; `{features:{feature:boolean},limits:{member,staff,TRAINER,RECEPTIONIST,MANAGER}}`; omitted keys inherit defaults |
| PATCH | /admin/owners/:id | platform; name, email, status ACTIVE/DEACTIVATED/SUSPENDED, permissions map of members:read/create/edit/deactivate/account |
| GET | /access | subscription; effective policy, usage, recent access requests |
| POST | /access/requests | subscription; resource, optional requested_limit, notes |
| GET / PATCH | /admin/access-requests / :id | platform; list or close with status RESOLVED/DECLINED |
| PUT | /staff/:id/access | staff; name, email, permissions map restricted to role ceiling, optional all_members coaching scope |
| GET | /staff/activity | staff; page; session login/logout, online flag, elapsed seconds |
| GET | /balances | payments; optional member_id, status, page; paginated agreed fees, paid/pending amounts and deadlines |
| POST | /payments | existing contract plus payment_deadline; amount_paise may be below server-calculated fee if a deadline is provided |
| POST | /memberships/:id/payments | payments; positive amount_paise, method, transaction_id for non-cash, notes, idempotency_key; appends an installment and receipt |
| PATCH | /memberships/:id/payment-deadline | payments; payment_deadline date; audited change |
| GET | /financial-summary | reports + payments feature; periods and balance counts; expense/profit fields omitted when expenses locked |
| GET / POST | /expenses | expenses; page for reads; description, category, positive amount_paise, spent_on for writes |
| GET | /whatsapp/reminders | whatsapp; page; expiring/expired membership candidates, no delivery |
| POST | /members/:id/whatsapp | whatsapp; type WELCOME/EXPIRING/EXPIRED/PENDING; returns message, url, PREPARED, sent=false; pending also needs payments |
| PUT | /members/:id/photo | members:edit; photo null or bounded PNG/JPEG data URL |
| GET | /assigned-members/:id | assigned:read; trainer-authorized member identity, membership dates, recent attendance; excludes finances |
| PUT | /workouts/:id | workouts; name, exercises; checks current trainer assignment |
| POST / PUT | /member/workouts / :id | self:read + member_workouts + workouts; own member identity, own-authored plans only for editing |

Exercise objects also accept `muscle_group`. Member attendance responses include the current-month attendance summary; member payment responses include their own membership balances. See [access and payment behavior](docs/ACCESS_AND_PAYMENTS.md) for defaults, limits and accounting semantics. Owner `POST /subscription/cancel` is now forbidden; only the platform subscription controls can change a subscription.
