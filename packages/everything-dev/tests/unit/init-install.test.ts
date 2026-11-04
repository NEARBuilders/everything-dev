import { describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import { runPnpmInstallForUpgrade } from "../../src/cli/init";

describe("runPnpmInstallForUpgrade", () => {
  it("uses pnpm install --force with captured output (the release-age remediation seam)", async () => {
    await runPnpmInstallForUpgrade("/tmp/project");

    expect(execaMock).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--force"],
      expect.objectContaining({
        cwd: "/tmp/project",
        stdio: ["inherit", "pipe", "pipe"],
        all: true,
        timeout: 300000,
        env: expect.objectContaining({ BOS_NO_BANNER: "1" }),
      }),
    );
  });

  it("attaches the captured output to the failure for classification", async () => {
    const stream = {
      on: (_event: string, handler: (chunk: Buffer) => void) => handler(Buffer.from("boom")),
    };
    execaMock.mockImplementationOnce(() => {
      const child = Promise.reject(new Error("install failed")) as Promise<never> & {
        stdout?: unknown;
        stderr?: unknown;
        all?: unknown;
      };
      child.stdout = stream;
      child.stderr = stream;
      child.all = stream;
      return child;
    });

    const error = await runPnpmInstallForUpgrade("/tmp/project").catch((e: unknown) => e);
    expect((error as { output?: string }).output).toBe("boom");
  });
});
