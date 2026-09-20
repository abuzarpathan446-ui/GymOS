# Environment configuration

Copy `.env.example` into `.env` for development. Never commit `.env`, generated credentials, provider tokens, production DB URLs or backup keys.

| Variable | Meaning |
| --- | --- |
| NODE_ENV | development/test/production; production enables secure cookies and strict DB startup checks |
| PORT | API port, default 3001 |
| APP_ORIGIN | Exact browser origin, default development http://localhost:5173; HTTPS mandatory in production |
| DATABASE_URL | PostgreSQL runtime connection; unset means embedded development database |
| MIGRATION_DATABASE_URL | Migration owner connection, only migration command uses it |
| DATABASE_SSL | true enables TLS with certificate verification; configure trust roots at infrastructure level |
| SESSION_HOURS | Session lifetime, default 12 |
| TRUST_PROXY | false by default; enable only behind an isolated proxy |
| SMTP_HOST / PORT / USER / PASSWORD | Email transport; port 587 default; TLS required |
| EMAIL_FROM | Verified sender address |
| BACKUP_DIRECTORY | Encrypted backup destination, default ./backups |
| BACKUP_INTERVAL_HOURS | Single-worker schedule, default 24; minimum 1 |
| BACKUP_ENCRYPTION_KEY | Base64-encoded 32-byte key; mandatory for backups/restores |
| RESTORE_DATABASE_URL / RESTORE_FILE | Separate empty DB and encrypted backup file for restore |
| ADMIN_EMAIL / ADMIN_PASSWORD | One-time bootstrap inputs; clear after use |
| SEED_PASSWORD | Explicit development seed password, at least 12 characters |

WhatsApp, payment-provider, AI and object-storage variables in the example are reserved configuration names, **not enabled adapters**. Setting them does not activate working provider integrations. The current WhatsApp mode is click-to-chat, which opens WhatsApp for the staff member to send. The worker rejects unsupported automated WhatsApp actions instead of reporting success. Online subscription billing is not implemented. Object uploads and AI are not implemented.

Generate a backup key with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store the output in a secret manager or local ignored `.env`, not a checked-in file. Environment variables are read at process startup; restart the API/worker after changing configuration. Production deployment should expose migration credentials only to the migration job.


## Access and payment extension

See [Access and payments](docs/ACCESS_AND_PAYMENTS.md) for the new owner/staff permission controls, gym feature overrides, resource quotas, installment payments, staff session attendance, optional WhatsApp preparation and workout editing. Migration `005_access_and_business.sql` is additive; it backfills historical agreed fees from completed payments and adds RLS-protected expense, request and login-history tables.

Local embedded mode permits exactly one API/maintenance process through `.local/database.lock`. Stop the API gracefully before maintenance; inspect the recorded PID before removing a stale lock. Production continues to require PostgreSQL. `HOST` controls server binding. Configure administrators with `node --import tsx scripts/configure-admin.ts <email> <private-password-file>` while the embedded API is stopped. The input file is removed and only the password hash is stored. Never put that input in the frontend or commit it.

APP_ORIGIN is the canonical browser URL used by origin checks and account links. For LAN access use the full LAN origin, including port (for example http://192.168.0.195:5173). ALLOWED_ORIGINS accepts additional exact comma-separated HTTP(S) origins, such as http://localhost:5173,http://127.0.0.1:5173. Restart the API after changing these values. No wildcards or Host-header-based trust are supported.

