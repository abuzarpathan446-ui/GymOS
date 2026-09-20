# Remaining environment setup

Local `.env` stays ignored by Git. Keep actual credentials there or in your production secret manager; never paste them into source, commits or GitHub issues.

## Configured locally

- Development mode, API port 3001, LAN binding and the existing browser origin/localhost allowlist.
- Existing SMTP host, port, username and password are preserved. A missing EMAIL_FROM is set to the configured SMTP email address; the provider must permit this sender.
- Existing session settings, backup destination, interval, encryption key and seed password are preserved. No accounts were recreated and no encryption keys were rotated.

## Setup requiring the operator

1. **PostgreSQL:** provide a running PostgreSQL database, its runtime connection URL and separate migration-owner URL. Follow DEPLOYMENT.md and database/runtime-role.sql. Set DATABASE_SSL according to the provider's TLS requirements. Do not point the application at an empty new database without planning migration of the existing local gym records.
2. **Worker:** after PostgreSQL is configured, run and supervise `npm run worker`. Email invitations, queued reminders and scheduled backups need this process. The current embedded database cannot safely be opened by a second process.
3. **Email:** authorize/verify the configured sender with the SMTP provider. A successful SMTP authentication check does not prove sender authorization or delivery. After the worker is running, perform an intentional test email and confirm receipt. Until then, create owners with an assigned password or a one-time setup link.
4. **Production hosting:** choose the server and public HTTPS domain. Set NODE_ENV=production, APP_ORIGIN to the real domain and configure exact ALLOWED_ORIGINS. Enable TRUST_PROXY only for a properly isolated reverse proxy. A Docker deployment also needs its own POSTGRES_PASSWORD for database provisioning.
5. **Backups:** keep encryption keys securely off this computer along with encrypted backups. Existing older snapshots have a separately stored key; the current environment key was preserved and may differ. Test restore against an empty separate database before relying on a production schedule.

## Intentionally blank integrations

WhatsApp API automation, online payment processing, AI and object storage adapters are not implemented. Filling WHATSAPP_TOKEN, PAYMENT_SECRET, AI_API_KEY or storage keys does not enable them. They require implementation as well as provider configuration. Current WhatsApp click-to-chat works from each gym's signed-in WhatsApp account without an API token. Current payment recording is manual.

ADMIN_EMAIL/ADMIN_PASSWORD and RESTORE_DATABASE_URL/RESTORE_FILE are one-time command inputs, not permanent runtime settings. Do not leave an administrator password or restore command inputs in the routine production environment.
