import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [pidFile, ...cmd] = process.argv.slice(2);
if (!pidFile || cmd.length === 0) {
  console.error("usage: node orphan-wrapper.mjs <pid-file> <command> [args...]");
  process.exit(1);
}

const child = spawn(cmd[0], cmd.slice(1), {
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});
writeFileSync(pidFile, String(child.pid));

child.on("error", (err) => {
  console.error("[orphan-wrapper] spawn failed:", err);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
