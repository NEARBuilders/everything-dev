import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDevLogger,
  readDevLatestLog,
  resolveDevLatestFile,
} from "../../src/services/dev/logs";

let tempDir: string;

const withPid = async <T>(pid: number, run: () => Promise<T>): Promise<T> => {
  const original = process.pid;
  Object.defineProperty(process, "pid", { value: pid, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "pid", { value: original, configurable: true });
  }
};

describe("dev-logs per-session filenames", () => {
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("two sessions in the same project write distinct, non-truncating log files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-logs-"));

    const first = await withPid(11111, () => createDevLogger(tempDir, "first session"));
    const second = await withPid(22222, () => createDevLogger(tempDir, "second session"));

    expect(first.logFile).not.toBe(second.logFile);
    expect(first.latestFile).not.toBe(second.latestFile);

    await first.write({
      source: "api",
      line: "first session line",
      isError: false,
      timestamp: Date.now(),
    });
    await second.write({
      source: "api",
      line: "second session line",
      isError: false,
      timestamp: Date.now(),
    });

    const files = readdirSync(join(tempDir, ".bos", "logs"));
    expect(files.filter((f) => f.startsWith("dev-latest-")).length).toBe(2);

    const { readFile } = await import("node:fs/promises");
    const firstText = await readFile(first.latestFile, "utf8");
    expect(firstText).toContain("first session line");
    expect(firstText).not.toContain("second session line");
  });

  it("readDevLatestLog resolves the newest pid-suffixed latest file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-logs-"));

    await withPid(11111, async () => {
      const first = await createDevLogger(tempDir, "first");
      await first.write({
        source: "host",
        line: "older session line",
        isError: false,
        timestamp: Date.now(),
      });
    });
    await withPid(22222, async () => {
      const second = await createDevLogger(tempDir, "second");
      await second.write({
        source: "host",
        line: "newest session line",
        isError: false,
        timestamp: Date.now(),
      });
    });

    const resolved = resolveDevLatestFile(tempDir);
    expect(resolved).toContain("22222");

    const text = await readDevLatestLog(tempDir);
    expect(text).toContain("newest session line");
    expect(text).not.toContain("older session line");
  });
});

describe("dated log pruning (#596)", () => {
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // 25h + 3h*n: older than the live-session skip window, younger than the
  // 7d max-age — so the keep-20 rule is what governs, deterministically.
  const oldDate = (n: number) => new Date(Date.now() - (25 + 3 * n) * 60 * 60 * 1000);
  const datedName = (n: number) =>
    `dev-2026-10-${String(10 + n).padStart(2, "0")}T00-00-00-${n}.log`;
  const datedLogShape = (name: string) =>
    /^dev-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+\.log$/.test(name);

  it("prunes dated logs beyond the retention window, protecting live sessions", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-logs-"));
    const logsDir = join(tempDir, ".bos", "logs");
    const { utimesSync, writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(logsDir, { recursive: true });

    for (let n = 0; n < 25; n++) {
      const file = join(logsDir, datedName(n));
      writeFileSync(file, `#${n}\n`);
      utimesSync(file, oldDate(n), oldDate(n));
    }
    const staleLatest = join(logsDir, "dev-latest-99999.log");
    writeFileSync(staleLatest, "#stale\n");
    utimesSync(staleLatest, oldDate(30), oldDate(30));
    // protected: a live session's dated log (recent mtime), the canonical
    // dev-latest.log, and the regression stacks' non-dated logs
    const live = join(logsDir, datedName(80));
    writeFileSync(live, "#live\n");
    writeFileSync(join(logsDir, "dev-latest.log"), "#canonical\n");
    writeFileSync(join(logsDir, "regression-dev-ssr.log"), "#regression\n");

    await createDevLogger(tempDir, "pruning boot");

    const files = readdirSync(logsDir);
    // 26 prunable (25 dated + stale pid-latest) minus the 6 oldest, plus the
    // boot's own fresh dated log
    expect(files.filter((f) => datedLogShape(f)).length).toBe(22);
    expect(files).not.toContain("dev-latest-99999.log");
    expect(files).toContain(datedName(80));
    expect(files).toContain("dev-latest.log");
    expect(files).toContain("regression-dev-ssr.log");
  });
});
