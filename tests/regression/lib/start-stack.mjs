#!/usr/bin/env bun
// Boots the regression stack (dev/prod/backcompat) with the test environment
// from .env.test so regression runs never touch dev databases or dev ports.
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { killStalePorts } from "./kill-stale-ports.mjs";
import { computeRegressionEnv, findRepoRoot, regressionStackOptions } from "./regression-env.mjs";

const PROBE_RETRIES = 6;
const PROBE_DELAY_MS = 500;

function log(msg) {
  console.log(`[start-stack] ${msg}`);
}

function probeTcp(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitForDatabases(dbUrls) {
  const targets = new Map();
  for (const [secret, url] of Object.entries(dbUrls)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") continue;
      targets.set(`${parsed.hostname}:${parsed.port || "5432"}`, secret);
    } catch {
      // ignore malformed URLs, the stack will surface them
    }
  }
  if (targets.size === 0) return;

  for (let attempt = 1; attempt <= PROBE_RETRIES; attempt++) {
    const results = await Promise.all(
      [...targets.keys()].map(async (target) => ({
        target,
        ok: await probeTcp(...target.split(":")),
      })),
    );
    if (results.every((r) => r.ok)) return;

    const missing = results.filter((r) => !r.ok).map((r) => r.target);
    if (attempt === PROBE_RETRIES) {
      throw new Error(
        `test databases not reachable: ${missing.join(", ")}. ` +
          "Start them with `bun run test:db:up` (docker compose postgres-*-test services).",
      );
    }
    log(`waiting for test databases (${missing.join(", ")})...`);
    await Bun.sleep(PROBE_DELAY_MS);
  }
}

const mode = process.argv[2] ?? "dev";
const root = findRepoRoot();
if (!root) {
  console.error("[start-stack] bos.config.json not found in any parent directory");
  process.exit(1);
}

const regressionEnv = computeRegressionEnv({ repoRoot: root });
const spec = regressionStackOptions(regressionEnv, mode);
await waitForDatabases(regressionEnv.dbUrls);
killStalePorts(regressionEnv.stalePorts);

log(`starting ${mode} stack on port ${regressionEnv.basePort} with test databases`);
// Stack output goes to a file, not stdio: playwright pipes the webServer's
// stdout/stderr and waits on them at teardown — inherited fds held by the
// service tree delay EOF for minutes after the direct wrapper dies (the
// teardown "stall"). `tail -f` the log for live output.
const logsDir = join(root, ".bos", "logs");
mkdirSync(logsDir, { recursive: true });
// Colons are invalid in upload-artifact paths (NTFS-safe charset) — the mode
// names (`dev:ssr`) must never leak into the log filename.
const stackLogPath = join(logsDir, `regression-${mode.replace(/:/g, "-")}.log`);
const stackLog = openSync(stackLogPath, "w");
log(`stack output: ${stackLogPath}`);

// Own process group: bos dev spawns service trees (rspack/rsbuild watchers
// included) that don't always die from a plain SIGTERM to the orchestrator —
// the group kill is what playwright's webServer teardown can rely on.
const child = spawn(process.execPath, spec.command, {
  cwd: root,
  env: spec.env,
  stdio: ["ignore", stackLog, stackLog],
  detached: true,
});

let forceExitTimer = null;
const killGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};
const forceExit = () => {
  killGroup("SIGKILL");
  process.exit(0);
};
// The signal has to survive the wrapper layers (playwright's `sh -c`, the
// `bun run` npm runner) — forward to the whole group, then hard-kill after a
// grace: a wedged graceful shutdown must never hold the webServer open.
const forward = (signal) => {
  killGroup(signal);
  if (forceExitTimer) clearTimeout(forceExitTimer);
  forceExitTimer = setTimeout(forceExit, 5000);
  forceExitTimer.unref?.();
};
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));
process.on("exit", () => killGroup("SIGKILL"));

const exitCode = await new Promise((resolve) => {
  child.once("error", (error) => {
    console.error(`[start-stack] ${error.message}`);
    resolve(1);
  });
  child.once("exit", (code, signal) => {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    resolve(code ?? (signal ? 1 : 0));
  });
});
process.exit(exitCode);
