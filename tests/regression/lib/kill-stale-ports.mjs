#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { computeRegressionEnv } from "./regression-env.mjs";

export function portsForBase(base) {
  return [
    ...[0, 1, 2, 3, 4, 5].map((offset) => base + offset),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((offset) => base + 10 + offset),
  ];
}

function listeningPidsOnPort(port) {
  try {
    const out = spawnSync("sh", ["-c", `lsof -nP -ti:${port} -sTCP:LISTEN 2>/dev/null || true`]);
    return String(out.stdout)
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isFinite(pid) && pid > 1);
  } catch {
    return [];
  }
}

function killPidTree(pid) {
  try {
    process.kill(-pid, "SIGKILL");
    return "group";
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return "direct";
    } catch {
      return "gone";
    }
  }
}

export function killStalePorts(ports, { log = console.log } = {}) {
  const killed = [];
  for (const port of ports) {
    for (const pid of listeningPidsOnPort(port)) {
      const how = killPidTree(pid);
      killed.push({ port, pid, how });
    }
  }
  if (killed.length > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  for (const entry of killed) {
    log(`[kill-stale-ports] killed pid ${entry.pid} (${entry.how}) on port ${entry.port}`);
  }
  if (killed.length === 0) {
    log("[kill-stale-ports] no stale listeners");
  }
  return killed;
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith("kill-stale-ports.mjs") ||
    process.argv[1].endsWith("kill-stale-ports"));

if (isDirectRun) {
  const baseFlag = process.argv.indexOf("--base");
  const base = baseFlag !== -1 ? Number(process.argv[baseFlag + 1]) : undefined;
  const ports = Number.isFinite(base) ? portsForBase(base) : computeRegressionEnv().stalePorts;
  if (ports.length === 0) {
    console.error("[kill-stale-ports] no ports to check");
    process.exit(1);
  }
  killStalePorts(ports);
}
