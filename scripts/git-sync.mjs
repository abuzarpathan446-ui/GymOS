import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { checkSafety, projectFiles } from "./check-git-safety.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(root);
const remote = "https://github.com/abuzarpathan446-ui/GymOS.git";
const once = process.argv.includes("--once");
mkdirSync(".local", { recursive: true });
const lock = ".local/git-sync.lock",
  statusFile = ".local/git-sync-status.json";
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
    timeout: 120000,
  });
function status(state, message) {
  writeFileSync(
    statusFile,
    JSON.stringify(
      {
        state,
        message,
        updated_at: new Date().toISOString(),
        pid: process.pid,
      },
      null,
      2,
    ),
  );
  console.log(`${new Date().toISOString()} ${state}: ${message}`);
}
try {
  writeFileSync(lock, String(process.pid), { flag: "wx" });
} catch {
  const pid = Number(readFileSync(lock, "utf8"));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") alive = false;
  }
  if (alive) {
    console.log("GymOS Git sync is already running.");
    process.exit(0);
  }
  unlinkSync(lock);
  writeFileSync(lock, String(process.pid), { flag: "wx" });
}
process.on("exit", () => {
  try {
    if (readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock);
  } catch {}
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
function fingerprint() {
  const hash = createHash("sha256");
  for (const path of projectFiles().sort()) {
    hash.update(path);
    try {
      hash.update(readFileSync(path));
    } catch (e) {
      if (e.code === "ENOENT") hash.update("deleted");
      else throw e;
    }
  }
  return hash.digest("hex");
}
async function run(args) {
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? ok()
        : fail(Error(`Check failed: ${args.join(" ")} (exit ${code})`)),
    );
  });
}
async function sync(expected) {
  if (resolve(git(["rev-parse", "--show-toplevel"]).trim()) !== root)
    throw Error("Wrong repository root; stopping.");
  if (
    git(["remote", "get-url", "origin"]).trim() !== remote ||
    git(["remote", "get-url", "--push", "origin"]).trim() !== remote
  )
    throw Error("Unexpected GitHub destination; stopping.");
  if (git(["branch", "--show-current"]).trim() !== "main")
    throw Error("Automatic sync only runs on main.");
  if (
    ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].some(
      (p) => existsSync(resolve(".git", p)),
    )
  )
    throw Error("Finish the current Git operation before syncing.");
  if (git(["diff", "--cached", "--name-only"]).trim())
    throw Error(
      "Manually staged changes found. Commit or unstage them before automatic syncing.",
    );
  git(["fetch", "origin"]);
  let remoteHead = "";
  try {
    remoteHead = git([
      "rev-parse",
      "--verify",
      "refs/remotes/origin/main",
    ]).trim();
  } catch {}
  if (remoteHead) {
    let localHead = "";
    try {
      localHead = git(["rev-parse", "HEAD"]).trim();
    } catch {}
    if (!localHead)
      throw Error("Remote now has commits; reconcile history manually.");
    const counts = git([
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...origin/main",
    ])
      .trim()
      .split(/\s+/)
      .map(Number);
    if (counts[1] > 0)
      throw Error(
        "GitHub has new commits. Pull/reconcile them manually; automatic sync will not overwrite them.",
      );
  }
  if (git(["status", "--porcelain"]).trim()) {
    checkSafety();
    status("CHECKING", "Running build and tests before upload.");
    await run(["node_modules/typescript/bin/tsc", "--noEmit"]);
    await run(["node_modules/vite/bin/vite.js", "build"]);
    await run([
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...projectFiles().filter((p) =>
        /^apps\/api\/test\/.*\.test\.ts$/.test(p),
      ),
    ]);
    if (fingerprint() !== expected) {
      status(
        "WAITING",
        "Files changed during checks; waiting for stable edits.",
      );
      return;
    }
    checkSafety();
    git(["add", "--all", "--", "."]);
    checkSafety(true);
    if (git(["diff", "--cached", "--name-only"]).trim())
      git(["commit", "-m", `Sync GymOS changes ${new Date().toISOString()}`]);
  }
  git(["push", "-u", "origin", "main"]);
  status("SYNCED", "Committed code is up to date on GitHub.");
}
if (once) {
  try {
    await sync(fingerprint());
  } catch (e) {
    status("ERROR", e.message);
    process.exitCode = 1;
  }
} else {
  status(
    "WATCHING",
    "Waiting 60 seconds after the last edit. Create .local/git-sync.pause to pause.",
  );
  let previous = "",
    changedAt = Date.now(),
    attemptAt = 0,
    lastSynced = "";
  setInterval(async () => {
    if (busy) return;
    if (existsSync(".local/git-sync.pause")) return;
    busy = true;
    try {
      const current = fingerprint();
      if (current !== previous) {
        previous = current;
        changedAt = Date.now();
        lastSynced = "";
      }
      if (
        Date.now() - changedAt < 60000 ||
        Date.now() - attemptAt < 60000 ||
        current === lastSynced
      )
        return;
      attemptAt = Date.now();
      await sync(current);
      if (fingerprint() === current) lastSynced = current;
    } catch (e) {
      status("ERROR", e.message);
    } finally {
      busy = false;
    }
  }, 10000);
}
let busy = false;
