import { describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import { runBunInstallForUpgrade } from "../../src/cli/init";

describe("runBunInstallForUpgrade", () => {
  it("uses bun install --force to refresh lockfile resolutions", async () => {
    await runBunInstallForUpgrade("/tmp/project");

    expect(execaMock).toHaveBeenCalledWith(
      "bun",
      ["install", "--force"],
      expect.objectContaining({
        cwd: "/tmp/project",
        stdio: "inherit",
        timeout: 300000,
        env: expect.objectContaining({ BOS_NO_BANNER: "1" }),
      }),
    );
  });
});
