import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { run } from "../../src/utils/run";

function canSpawn(command: string): boolean {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !probe.error;
}

const gitAvailable = canSpawn("git");

describe("run", () => {
  it("captures stdout and exit code from a successful subprocess", {
    skip: !gitAvailable,
  }, async () => {
    const result = await run("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: import.meta.dirname,
      capture: true,
    });

    expect(result).toBeDefined();
    expect(result!.exitCode).toBe(0);
    expect(result!.stdout.trim()).toBe("true");
  });

  it("captures a non-zero exit code with empty stdout", { skip: !gitAvailable }, async () => {
    const result = await run("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: "/",
      capture: true,
    });

    expect(result).toBeDefined();
    expect(result!.exitCode).not.toBe(0);
    expect(result!.stdout.trim()).toBe("");
  });

  it("reports a missing binary as a failure, not success", async () => {
    const result = await run("definitely-not-a-real-binary-xyz", ["--version"], {
      capture: true,
    });

    expect(result).toBeDefined();
    expect(result!.exitCode).not.toBe(0);
  });

  it("throws on a failing subprocess without capture", async () => {
    await expect(run("definitely-not-a-real-binary-xyz", ["--version"], {})).rejects.toThrow(
      /failed with exit code/,
    );
  });

  it("forwards chunks to onChunk while capturing", { skip: !gitAvailable }, async () => {
    const chunks: string[] = [];
    const result = await run("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: import.meta.dirname,
      capture: true,
      onChunk: (_stream, chunk) => chunks.push(chunk.toString("utf-8")),
    });

    expect(result).toBeDefined();
    expect(result!.exitCode).toBe(0);
    expect(chunks.join("").trim()).toBe("true");
    expect(result!.stdout.trim()).toBe("true");
  });
});
