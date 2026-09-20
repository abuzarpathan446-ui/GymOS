# GitHub sync

This folder is a standalone repository for https://github.com/abuzarpathan446-ui/GymOS on branch `main`. The Desktop parent repository is unrelated and is not used. Source code, migrations, docs and the PRD are versioned. `.env`, local databases, backups, keys, agent-local configuration, dependencies and build output are excluded. GitHub does not back up customer records or automatically deploy the app.

## Commands

- `npm run git:sync`: validate, commit and push once.
- `npm run git:watch`: keep automatic syncing running. After edits settle for 60 seconds, it runs TypeScript, the production build and all API tests, then commits and pushes. Edits made during checks defer the upload until the next stable cycle.
- `npm run git:check`: check publishable files for private paths and common credential patterns. Also review new files before saving secrets: pattern matching cannot detect every secret.

The Git pre-commit hook runs the staged-file safety check. On a new clone, run `git config core.hooksPath .githooks` and install dependencies with `npm ci`.

The watcher uses the Windows Git credential manager; no access token is stored in code. It refuses unexpected remotes, branches other than main, manually staged changes and pending merge/rebase operations. It never force-pushes, automatically pulls, resets or discards work. If GitHub has newer commits, reconcile them manually before resuming. Failed checks or network errors are shown in the local status and retried at most once per minute. GitHub Actions independently runs the build, tests and dependency audit after pushes.

## Windows background startup

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-sync.ps1` once to install a **GymOS Git Sync** shortcut in the current user's Windows Startup folder and start the hidden background watcher. Keep the project at its current path or rerun installation after moving it. Only one watcher is allowed per workspace.

View `.local/git-sync-status.json`, `.local/git-sync.log` and `.local/git-sync-error.log` for status. To pause, create the file `.local/git-sync.pause`; remove it to resume. Pausing takes effect before the next cycle; an already-running validation/upload can finish. To disable future Windows startup, remove only the **GymOS Git Sync** shortcut from `shell:startup`. This does not stop a watcher already running; pause it first or end its PID shown in the status file.

Automatic syncing applies to saved code changes while this computer and the watcher are running. Failed checks require fixes; offline pushes retry when connectivity returns. It does not sync unsaved editor contents or changes made on other devices.
