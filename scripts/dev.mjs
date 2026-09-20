import { spawn } from "node:child_process";
const jobs = [
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
    { stdio: "inherit" },
  ),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const job of jobs) job.kill();
}
for (const job of jobs) job.on("exit", close);
process.on("SIGINT", close);
process.on("SIGTERM", close);
