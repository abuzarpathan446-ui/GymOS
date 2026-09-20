import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const git = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
export function projectFiles() {
  return [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    ),
  ];
}
export function checkSafety(staged = false) {
  const paths = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
        .split("\0")
        .filter(Boolean)
    : projectFiles();
  const failures = [];
  for (const path of paths) {
    if (
      /(^|\/)(node_modules|dist|backups|\.local|\.claude|\.codex)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx|sqlite\w*|db|enc|input|dump|bak|log)$/i.test(
        path,
      ) &&
      path !== ".env.example"
    ) {
      failures.push(`${path}: private or generated file`);
      continue;
    }
    let data;
    try {
      if (staged)
        data = execFileSync("git", ["show", `:${path}`], {
          cwd: root,
          maxBuffer: 30 * 1024 * 1024,
          windowsHide: true,
        });
      else {
        const stat = lstatSync(resolve(root, path));
        if (stat.isSymbolicLink())
          throw Error("symbolic links require manual review");
        data = readFileSync(resolve(root, path));
      }
    } catch (e) {
      if (!staged && e.code === "ENOENT") continue;
      failures.push(`${path}: cannot inspect safely`);
      continue;
    }
    if (data.length > 25 * 1024 * 1024) {
      failures.push(`${path}: file exceeds 25 MB`);
      continue;
    }
    const body = data
      .toString("utf8")
      .replace(
        /postgresql:\/\/gymos_runtime:\.\.\.@db:5432\/gymos/g,
        "DATABASE_URL_PLACEHOLDER",
      );
    const patterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /gh[pousr]_[A-Za-z0-9]{30,}/,
      /github_pat_[A-Za-z0-9_]{50,}/,
      /sk-proj-[A-Za-z0-9_-]{30,}/,
      /AKIA[0-9A-Z]{16}/,
      /(?:postgres(?:ql)?|mysql):\/\/[^\s:'"/]+:[^\s@'"/]+@/,
    ];
    if (patterns.some((pattern) => pattern.test(body)))
      failures.push(`${path}: possible credential (value hidden)`);
  }
  if (failures.length)
    throw Error(`Git safety check failed:\n${failures.join("\n")}`);
  return paths.length;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      `Git safety check passed (${checkSafety(process.argv.includes("--staged"))} files).`,
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
