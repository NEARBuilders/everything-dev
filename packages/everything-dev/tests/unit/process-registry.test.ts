import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimedPorts,
  getRegistryPath,
  isPidAlive,
  pruneDead,
  pruneDeadEffect,
  readRegistry,
  registerStandalone,
  unregisterPid,
  writeRegistry,
} from "../../src/process-registry";

const ORIG_REGISTRY_PATH = process.env.BO_PID_REGISTRY_PATH;

describe("process-registry", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bos-registry-"));
    registryPath = join(tempDir, "pids.json");
    process.env.BO_PID_REGISTRY_PATH = registryPath;
  });

  afterEach(() => {
    if (ORIG_REGISTRY_PATH === undefined) delete process.env.BO_PID_REGISTRY_PATH;
    else process.env.BO_PID_REGISTRY_PATH = ORIG_REGISTRY_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("readRegistry returns empty when the file does not exist", () => {
    expect(readRegistry()).toEqual([]);
  });

  it("getRegistryPath honors BO_PID_REGISTRY_PATH over the default", () => {
    expect(getRegistryPath()).toBe(registryPath);
  });

  it("registerStandalone writes a single standalone entry", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-project-"));
    try {
      const entry = registerStandalone({
        pid: 999_999,
        configDir: projectDir,
        ports: { host: 3000, api: 3001 },
        startedAt: 1234,
        description: "test",
      });
      expect(entry.role).toBe("standalone");

      const live = readRegistry();
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({
        pid: 999_999,
        configDir: projectDir,
        role: "standalone",
        ports: { host: 3000, api: 3001 },
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("registerStandalone de-duplicates by pid", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-project-"));
    try {
      registerStandalone({
        pid: process.pid,
        configDir: projectDir,
        ports: {},
        startedAt: 1,
        description: "first",
      });
      registerStandalone({
        pid: process.pid,
        configDir: projectDir,
        ports: { host: 3000 },
        startedAt: 2,
        description: "second",
      });
      const live = readRegistry();
      expect(live).toHaveLength(1);
      expect(live[0]?.description).toBe("second");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("unregisterPid removes the matching pid and preserves others", () => {
    const aDir = mkdtempSync(join(tmpdir(), "bos-a-"));
    const bDir = mkdtempSync(join(tmpdir(), "bos-b-"));
    try {
      writeRegistry([
        {
          pid: process.pid,
          configDir: aDir,
          role: "standalone",
          ports: {},
          startedAt: 1,
          description: "a",
        },
        {
          pid: process.ppid,
          configDir: bDir,
          role: "standalone",
          ports: {},
          startedAt: 2,
          description: "b",
        },
      ]);
      unregisterPid(process.pid);
      const live = readRegistry();
      expect(live.map((e) => e.pid)).toEqual([process.ppid]);
    } finally {
      rmSync(aDir, { recursive: true, force: true });
      rmSync(bDir, { recursive: true, force: true });
    }
  });

  it("writes registry atomically (tmp file is not left behind)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-project-"));
    try {
      writeRegistry([
        {
          pid: 7,
          configDir: projectDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "c",
        },
      ]);
      expect(existsSync(registryPath)).toBe(true);
      expect(existsSync(`${registryPath}.tmp`)).toBe(false);
      const raw = JSON.parse(readFileSync(registryPath, "utf-8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].pid).toBe(7);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("pruneDead drops dead pids (ESRCH)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-project-"));
    try {
      writeRegistry([
        {
          pid: 9_999_999,
          configDir: projectDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "y",
        },
      ]);
      const pruned = pruneDead(readRegistry());
      expect(pruned.map((e) => e.pid)).not.toContain(9_999_999);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("pruneDead drops entries with pid <= 1 (init/kernel guards)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-project-"));
    try {
      writeRegistry([
        {
          pid: 0,
          configDir: projectDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "kernel",
        },
        {
          pid: 1,
          configDir: projectDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "init",
        },
      ]);
      const pruned = pruneDead(readRegistry());
      expect(pruned).toHaveLength(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("pruneDead drops entries whose configDir no longer exists", () => {
    const deadDir = join(tmpdir(), "bos-deleted-never-existed");
    writeRegistry([
      {
        pid: process.pid,
        configDir: deadDir,
        role: "standalone",
        ports: {},
        startedAt: 0,
        description: "gone",
      },
    ]);
    expect(existsSync(deadDir)).toBe(false);
    const pruned = pruneDead(readRegistry());
    expect(pruned).toHaveLength(0);
  });

  it("pruneDead cleans stale fixtures that leaked from prior test runs", () => {
    writeRegistry([
      {
        pid: 1,
        configDir: "/alive-implies-other-process",
        role: "standalone",
        ports: {},
        startedAt: 0,
        description: "x",
      },
    ]);
    const pruned = pruneDead(readRegistry());
    expect(pruned).toHaveLength(0);
  });

  it("isPidAlive returns false for an unused pid (ESRCH)", () => {
    expect(isPidAlive(9_999_999)).toBe(false);
  });

  it("readRegistry tolerates a corrupted file by returning []", () => {
    mkdirSync(join(tempDir, ".."), { recursive: true });
    writeFileSync(registryPath, "{ not valid json");
    expect(readRegistry()).toEqual([]);
  });

  it("claimedPorts flattens live entries into a Set of port numbers", () => {
    const aDir = mkdtempSync(join(tmpdir(), "bos-claim-a-"));
    const bDir = mkdtempSync(join(tmpdir(), "bos-claim-b-"));
    try {
      writeRegistry([
        {
          pid: process.pid,
          configDir: aDir,
          role: "standalone",
          ports: { host: 3100, api: 3101, ui: 3103 },
          startedAt: 0,
          description: "a",
        },
        {
          pid: process.ppid,
          configDir: bDir,
          role: "standalone",
          ports: { host: 3200, auth: 3202 },
          startedAt: 0,
          description: "b",
        },
      ]);
      const claimed = claimedPorts();
      expect(claimed.has(3100)).toBe(true);
      expect(claimed.has(3101)).toBe(true);
      expect(claimed.has(3103)).toBe(true);
      expect(claimed.has(3200)).toBe(true);
      expect(claimed.has(3202)).toBe(true);
      expect(claimed.has(3300)).toBe(false);
      expect(claimed.size).toBe(5);
    } finally {
      rmSync(aDir, { recursive: true, force: true });
      rmSync(bDir, { recursive: true, force: true });
    }
  });

  it("claimedPorts skips dead entries (pruneDead applied)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-claim-dead-"));
    try {
      writeRegistry([
        {
          pid: 9_999_999,
          configDir: dir,
          role: "standalone",
          ports: { host: 9999 },
          startedAt: 0,
          description: "dead",
        },
        {
          pid: process.pid,
          configDir: dir,
          role: "standalone",
          ports: { host: 4000 },
          startedAt: 0,
          description: "alive",
        },
      ]);
      const claimed = claimedPorts();
      expect(claimed.has(9999)).toBe(false);
      expect(claimed.has(4000)).toBe(true);
      expect(claimed.size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pruneDeadEffect async-filters dead pids, missing configDirs, and pid<=1", async () => {
    const liveDir = mkdtempSync(join(tmpdir(), "bos-prune-effect-live-"));
    const deadDir = join(tmpdir(), "bos-prune-effect-dead-not-exist");
    try {
      writeRegistry([
        {
          pid: 0,
          configDir: liveDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "kernel",
        },
        {
          pid: 9_999_999,
          configDir: liveDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "dead-pid",
        },
        {
          pid: process.pid,
          configDir: deadDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "missing-dir",
        },
        {
          pid: process.pid,
          configDir: liveDir,
          role: "standalone",
          ports: {},
          startedAt: 0,
          description: "alive",
        },
      ]);

      const pruned = await Effect.runPromise(pruneDeadEffect(readRegistry()));
      expect(pruned).toHaveLength(1);
      expect(pruned[0]?.description).toBe("alive");
    } finally {
      rmSync(liveDir, { recursive: true, force: true });
    }
  });
});
