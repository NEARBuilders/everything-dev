import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyReleaseAgeViolation,
  installWithReleaseAgeRemediation,
} from "../../src/services/scaffold/install-remediation";

const violationOutput = [
  "Scope: all 7 workspace projects",
  "✗ Lockfile failed supply-chain policy check (1452 entries in 2.8s)",
  "Error: ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION",
  "  × installing dependencies",
  "  ╰─▶ 1 lockfile entries failed verification:",
  "        everything-dev@2.0.0-rc.31 was published at 2026-11-03T08:29:25.000Z, within the minimumReleaseAge cutoff",
].join("\n");

const dirs: string[] = [];
function workspaceFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "install-remediation-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("classifyReleaseAgeViolation", () => {
  it("extracts the offending name@version entries", () => {
    expect(classifyReleaseAgeViolation(violationOutput)).toEqual([
      { name: "everything-dev", version: "2.0.0-rc.31" },
    ]);
  });

  it("returns nothing for unrelated failures", () => {
    expect(classifyReleaseAgeViolation("Error: ERR_PNPM_NETWORK_DOWN")).toEqual([]);
  });
});

describe("installWithReleaseAgeRemediation", () => {
  it("passes through a clean install", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await installWithReleaseAgeRemediation({ workspaceDir: "/w", run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-throws failures outside the release-age class untouched", async () => {
    const boom = new Error("ERR_PNPM_NETWORK_DOWN");
    const run = vi.fn().mockRejectedValue(boom);
    await expect(installWithReleaseAgeRemediation({ workspaceDir: "/w", run })).rejects.toThrow(
      "ERR_PNPM_NETWORK_DOWN",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a framework offender repairs the posture, regenerates the lockfile, and retries once", async () => {
    const workspaceDir = workspaceFixture();
    writeFileSync(
      join(workspaceDir, "pnpm-workspace.yaml"),
      ["packages:", "  - ui", "", "catalog:", '  "everything-dev": "2.0.0-rc.31"', ""].join("\n"),
    );
    writeFileSync(join(workspaceDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const error: Record<string, unknown> = new Error(violationOutput);
    error.output = violationOutput;
    const run = vi
      .fn<(dir: string) => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const log = vi.fn();

    await installWithReleaseAgeRemediation({ workspaceDir, run, log });

    expect(run).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.some(([m]) => String(m).includes("regenerating the lockfile"))).toBe(
      true,
    );
  });

  it("a persistent violation fails with the targeted remediation, not the raw dump", async () => {
    const workspaceDir = workspaceFixture();
    const error: Record<string, unknown> = new Error(violationOutput);
    error.output = violationOutput;
    const run = vi.fn<(dir: string) => Promise<void>>().mockRejectedValue(error);

    await expect(
      installWithReleaseAgeRemediation({ workspaceDir, run, log: () => {} }),
    ).rejects.toThrow(/minimumReleaseAge.*holdback is still open|rejected the install/s);
  });

  it("a non-framework offender fails with the wait-or-override guidance and never touches the lockfile", async () => {
    const workspaceDir = workspaceFixture();
    writeFileSync(join(workspaceDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const output = violationOutput.replace("everything-dev@", "left-pad@");
    const error: Record<string, unknown> = new Error(output);
    error.output = output;
    const run = vi.fn<(dir: string) => Promise<void>>().mockRejectedValue(error);

    await expect(installWithReleaseAgeRemediation({ workspaceDir, run })).rejects.toThrow(
      /left-pad@/,
    );
    // the lockfile survived — the repair is scoped to framework offenders
    expect(run).toHaveBeenCalledTimes(1);
  });
});
