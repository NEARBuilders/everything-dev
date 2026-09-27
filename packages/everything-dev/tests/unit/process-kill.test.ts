import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLsofAvailable,
  ownerOfPort,
  resetLsofCacheForTests,
} from "../../src/infra/port-ownership";
import { killProcessGroupEscalating, reapGroup } from "../../src/process-kill";
import { isPidAlive } from "../../src/process-registry";

let tempDir = mkdtempSync(join(tmpdir(), "process-kill-"));
const cleanup: string[] = [];

const fakeLsof = (script: string): string => {
  const path = join(tempDir, `lsof-${Math.random().toString(36).slice(2)}`);
  writeFileSync(path, script, { mode: 0o755 });
  return path;
};

const spawnSleeper = (): { pid: number; wait: Promise<void> } => {
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  cleanup.push(-child.pid);
  return {
    pid: child.pid,
    wait: new Promise((resolve) => child.once("exit", resolve)),
  };
};

describe("port-ownership", () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "port-ownership-"));
  });

  afterEach(() => {
    resetLsofCacheForTests();
  });

  it("reports the listening pid and its command", async () => {
    const lsof = fakeLsof("#!/bin/sh\necho 4242\n");
    const ps = fakeLsof('#!/bin/sh\necho "bun /somewhere/dev-server.ts"\n');
    const owner = await Effect.runPromise(ownerOfPort(3000, { lsofPath: lsof, psPath: ps }));
    expect(owner).toEqual({ pid: 4242, command: "bun /somewhere/dev-server.ts" });
  });

  it("returns null when the port is free (lsof finds nothing)", async () => {
    const lsof = fakeLsof("#!/bin/sh\nexit 1\n");
    const owner = await Effect.runPromise(ownerOfPort(3000, { lsofPath: lsof }));
    expect(owner).toBeNull();
  });

  it("returns null when lsof is missing", async () => {
    const owner = await Effect.runPromise(
      ownerOfPort(3000, { lsofPath: join(tempDir, "definitely-missing-lsof") }),
    );
    expect(owner).toBeNull();
  });

  it("falls back to 'unknown' command when ps fails", async () => {
    const lsof = fakeLsof("#!/bin/sh\necho 4242\n");
    const owner = await Effect.runPromise(
      ownerOfPort(3000, { lsofPath: lsof, psPath: join(tempDir, "definitely-missing-ps") }),
    );
    expect(owner).toEqual({ pid: 4242, command: "unknown" });
  });

  it("rejects invalid ports without spawning anything", async () => {
    const owner = await Effect.runPromise(ownerOfPort(Number.NaN, { lsofPath: "/nonexistent" }));
    expect(owner).toBeNull();
  });

  it("isLsofAvailable caches and reflects availability", async () => {
    const missing = await Effect.runPromise(
      isLsofAvailable({ lsofPath: join(tempDir, "definitely-missing-lsof") }),
    );
    expect(missing).toBe(false);
    const cached = await Effect.runPromise(
      isLsofAvailable({ lsofPath: join(tempDir, "definitely-missing-lsof") }),
    );
    expect(cached).toBe(false);
  });
});

describe("process-kill escalation", () => {
  afterEach(() => {
    for (const groupPid of cleanup.splice(0)) {
      try {
        process.kill(groupPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const { pid, wait } = spawnSleeperWithSigtermIgnored();
    expect(isPidAlive(pid)).toBe(true);
    await Effect.runPromise(killProcessGroupEscalating(pid, { terminateMs: 300 }));
    await wait;
    expect(isPidAlive(pid)).toBe(false);
  }, 15000);

  it("kills immediately when signal is SIGKILL", async () => {
    const { pid, wait } = spawnSleeper();
    await Effect.runPromise(killProcessGroupEscalating(pid, { signal: "SIGKILL" }));
    await wait;
    expect(isPidAlive(pid)).toBe(false);
  }, 15000);

  it("is a no-op for an already-dead pid", async () => {
    await Effect.runPromise(killProcessGroupEscalating(999999999));
  });

  it("reapGroup takes down the whole group including a spawned child", async () => {
    const script = "#!/bin/sh\nsleep 300 &\nwait\n";
    const path = join(tempDir, `parent-${Date.now()}.sh`);
    writeFileSync(path, script, { mode: 0o755 });
    const parent = spawn(path, { detached: true, stdio: "ignore" });
    cleanup.push(-parent.pid);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const members = await groupMembersOf(parent.pid);
    expect(members.length).toBeGreaterThanOrEqual(2);
    reapGroup(parent.pid);
    const deadline = Date.now() + 5000;
    for (;;) {
      const alive = (await groupMembersOf(parent.pid)).filter((pid) => isPidAlive(pid));
      if (alive.length === 0) break;
      if (Date.now() > deadline) throw new Error(`group members survived: ${alive.join(", ")}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 15000);
});

const groupMembersOf = async (pgid: number): Promise<number[]> => {
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,pgid="], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const members: number[] = [];
  for (const line of out.split("\n")) {
    const [pid, group] = line.trim().split(/\s+/);
    if (Number(group) === pgid) members.push(Number(pid));
  }
  return members;
};

function spawnSleeperWithSigtermIgnored(): { pid: number; wait: Promise<void> } {
  const script = "#!/bin/sh\ntrap '' TERM\nsleep 300\n";
  const path = join(tempDir, `sleeper-${Date.now()}.sh`);
  writeFileSync(path, script, { mode: 0o755 });
  const child = spawn(path, { detached: true, stdio: "ignore" });
  cleanup.push(-child.pid);
  return {
    pid: child.pid,
    wait: new Promise((resolve) => child.once("exit", resolve)),
  };
}
