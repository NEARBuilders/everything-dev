import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLEAN_NEVER_TOUCH, dirSize, executeClean, planClean } from "../../src/services/clean";

/**
 * The clean partition IS the command's contract: the removable set covers
 * regenerable state only, the never-touch list is absolute (PGlite data,
 * session credentials, port prefs, the deploy accelerator), dryRun reports
 * without deleting, and the logs branch keeps a live session's fresh files.
 */

const HOUR = 60 * 60 * 1000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bos-clean-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function bos(): string {
  const p = path.join(dir, ".bos");
  mkdirSync(p, { recursive: true });
  return p;
}

function seed(relPath: string, bytes = 10, ageMs = 0): string {
  const full = path.join(dir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "x".repeat(bytes));
  if (ageMs > 0) utimesSync(full, new Date(), new Date(Date.now() - ageMs));
  return full;
}

describe("planClean", () => {
  it("the never-touch names appear as guarded targets with reasons — always", () => {
    const targets = planClean(dir);
    for (const { name, reason } of CLEAN_NEVER_TOUCH) {
      const target = targets.find((t) => t.id === name);
      expect(target, `never-touch target ${name} missing from the plan`).toBeDefined();
      expect(target?.guarded).toBe(reason);
    }
  });

  it("every guarded path lives under .bos — the lockfile at the root is not even addressable", () => {
    for (const target of planClean(dir)) {
      expect(target.path.startsWith(path.join(dir, ".bos"))).toBe(true);
    }
  });

  it("no removable target collides with a never-touch name", () => {
    const guarded = new Set(CLEAN_NEVER_TOUCH.map((g) => g.name));
    for (const target of planClean(dir)) {
      if (target.guarded) continue;
      expect(guarded.has(target.id)).toBe(false);
      expect(target.path).not.toContain("db");
    }
  });

  it("the removable set is exactly the regenerable inventory", () => {
    const ids = planClean(dir)
      .filter((t) => !t.guarded)
      .map((t) => t.id);
    expect(ids.sort()).toEqual(
      [
        "logs",
        "bundles",
        "regression",
        "generated",
        "bundle-cache",
        "snapshot",
        "sync-backup",
        "import-backup",
        "compose-retired",
        "manifest-cache",
        "resolved-config",
        "build-cache",
      ].sort(),
    );
  });
});

describe("executeClean", () => {
  it("removes the regenerable targets, reports per-category bytes", () => {
    bos();
    seed(".bos/logs/dev-2026-01-01T00-00-00.log", 100, 2 * HOUR);
    seed(".bos/build-cache.json", 50);
    seed(".bos/bundles/app/ui/remoteEntry.js", 200);

    const report = executeClean(dir);

    expect(report.status).toBe("ok");
    expect(report.dryRun).toBe(false);
    const removed = new Map(report.entries.map((e) => [e.id, e]));
    expect(removed.get("build-cache")?.action).toBe("removed");
    expect(removed.get("bundles")?.action).toBe("removed");
    expect(existsSync(path.join(dir, ".bos", "build-cache.json"))).toBe(false);
    expect(existsSync(path.join(dir, ".bos", "bundles"))).toBe(false);
    expect(report.freedBytes).toBeGreaterThanOrEqual(350);
  });

  it("never touches the guarded set — db, session, ports, deploy-state survive", () => {
    bos();
    seed(".bos/db/api/PG_VERSION", 8);
    seed(".bos/session.json", 40);
    seed(".bos/infra-state.json", 30);
    seed(".bos/deploy-state.json", 60);
    seed(".bos/build-cache.json", 5);

    const report = executeClean(dir);

    const kept = new Map(report.entries.map((e) => [e.id, e]));
    expect(kept.get("db")?.action).toBe("kept");
    expect(kept.get("session.json")?.action).toBe("kept");
    expect(kept.get("infra-state.json")?.action).toBe("kept");
    expect(kept.get("deploy-state.json")?.action).toBe("kept");
    expect(existsSync(path.join(dir, ".bos", "db", "api", "PG_VERSION"))).toBe(true);
    expect(existsSync(path.join(dir, ".bos", "session.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".bos", "infra-state.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".bos", "deploy-state.json"))).toBe(true);
  });

  it("dryRun reports the same bytes and deletes nothing", () => {
    bos();
    seed(".bos/bundles/app/ui/remoteEntry.js", 200);
    seed(".bos/build-cache.json", 50);

    const report = executeClean(dir, { dryRun: true });

    expect(report.dryRun).toBe(true);
    const wouldRemove = new Map(report.entries.map((e) => [e.id, e]));
    expect(wouldRemove.get("bundles")?.action).toBe("would-remove");
    expect(wouldRemove.get("bundles")?.bytes).toBe(200);
    expect(report.freedBytes).toBe(250);
    expect(existsSync(path.join(dir, ".bos", "bundles", "app", "ui", "remoteEntry.js"))).toBe(true);
    expect(existsSync(path.join(dir, ".bos", "build-cache.json"))).toBe(true);
  });

  it("the logs branch keeps a live session's fresh log and removes stale ones", () => {
    bos();
    seed(".bos/logs/dev-latest-999.log", 30, 5 * 1000);
    seed(".bos/logs/dev-2026-01-01T00-00-00.log", 100, 2 * HOUR);

    const report = executeClean(dir);

    const logs = report.entries.find((e) => e.id === "logs");
    expect(logs?.action).toBe("removed");
    expect(logs?.bytes).toBe(100);
    expect(logs?.reason).toContain("1 fresh file(s)");
    expect(existsSync(path.join(dir, ".bos", "logs", "dev-2026-01-01T00-00-00.log"))).toBe(false);
    expect(existsSync(path.join(dir, ".bos", "logs", "dev-latest-999.log"))).toBe(true);
  });

  it("absent targets report absent — cleaning a pristine repo is a no-op", () => {
    bos();
    const report = executeClean(dir);
    const touched = report.entries.filter((e) => e.action !== "kept" && e.action !== "absent");
    expect(touched).toEqual([]);
    expect(report.freedBytes).toBe(0);
  });

  it("dirSize sums a tree recursively", () => {
    bos();
    seed(".bos/bundles/a/one", 10);
    seed(".bos/bundles/a/b/two", 20);
    expect(dirSize(path.join(dir, ".bos", "bundles"))).toBe(30);
  });
});
