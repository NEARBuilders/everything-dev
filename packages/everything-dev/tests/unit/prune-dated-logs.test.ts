import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneDatedLogs } from "../../src/services/dev/logs";

/**
 * The pruner's contract is bounded sediment in .bos/logs: every writer's
 * names are prunable (the dev logger's PID-suffixed and pre-#476 PID-less
 * formats, the legacy dev-latest.log, the regression stack's framework/
 * regression wrappers), the <24h guard protects live sessions, the newest
 * KEEP survive regardless of age, and the age cap overrides KEEP.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OLD = 2 * DAY;
const ANCIENT = 8 * DAY;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prune-logs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(name: string, ageMs: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), `# ${name}\n`);
  utimesSync(path.join(dir, name), new Date(), new Date(Date.now() - ageMs));
}

describe("pruneDatedLogs", () => {
  it("prunes legacy PID-less dated logs and the PID-less dev-latest.log", async () => {
    seed("dev-2026-07-23T14-58-21.log", ANCIENT);
    seed("dev-latest.log", ANCIENT);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "dev-2026-07-23T14-58-21.log"))).toBe(false);
    expect(existsSync(path.join(dir, "dev-latest.log"))).toBe(false);
  });

  it("prunes the regression stack's framework and regression wrappers", async () => {
    seed("framework-3900.log", ANCIENT);
    seed("regression-container.log", ANCIENT);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "framework-3900.log"))).toBe(false);
    expect(existsSync(path.join(dir, "regression-container.log"))).toBe(false);
  });

  it("never touches files modified within the live-session window", async () => {
    seed("dev-2026-11-10T09-00-00-123.log", 1 * HOUR);
    seed("framework-3900.log", 1 * HOUR);
    seed("regression-ssr.log", 1 * HOUR);
    seed("dev-latest-999.log", 1 * HOUR);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "dev-2026-11-10T09-00-00-123.log"))).toBe(true);
    expect(existsSync(path.join(dir, "framework-3900.log"))).toBe(true);
    expect(existsSync(path.join(dir, "regression-ssr.log"))).toBe(true);
    expect(existsSync(path.join(dir, "dev-latest-999.log"))).toBe(true);
  });

  it("keeps the newest KEEP prunable files across all classes, prunes the rest", async () => {
    const total = 25;
    for (let i = 0; i < total; i++) {
      seed(`dev-2026-01-01T00-${String(i).padStart(2, "0")}-00.log`, OLD - i * 60 * 1000);
    }
    seed("framework-3900.log", OLD + 60 * 1000);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "framework-3900.log"))).toBe(false);
    const survivors = total - 20;
    for (let i = 0; i < survivors; i++) {
      expect(
        existsSync(path.join(dir, `dev-2026-01-01T00-${String(i).padStart(2, "0")}-00.log`)),
      ).toBe(false);
    }
    for (let i = survivors; i < total; i++) {
      expect(
        existsSync(path.join(dir, `dev-2026-01-01T00-${String(i).padStart(2, "0")}-00.log`)),
      ).toBe(true);
    }
  });

  it("the age cap prunes beyond KEEP — old sediment never survives on recency alone", async () => {
    seed("dev-2025-01-01T00-00-00.log", ANCIENT);
    seed("dev-2026-11-09T00-00-00-1.log", 1 * HOUR);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "dev-2025-01-01T00-00-00.log"))).toBe(false);
    expect(existsSync(path.join(dir, "dev-2026-11-09T00-00-00-1.log"))).toBe(true);
  });

  it("leaves names no pattern claims alone", async () => {
    seed("custom-notes.txt", ANCIENT);
    seed("dev-notes.md", ANCIENT);

    await pruneDatedLogs(dir);

    expect(existsSync(path.join(dir, "custom-notes.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "dev-notes.md"))).toBe(true);
  });

  it("tolerates a missing directory", async () => {
    await expect(pruneDatedLogs(path.join(dir, "nope"))).resolves.toBeUndefined();
  });
});
