import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevLogger, readDevLatestLog, resolveDevLatestFile } from "../../src/dev-logs";

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
