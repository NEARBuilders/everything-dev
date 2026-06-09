import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 120_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "pipe",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command '${command} ${args.join(" ")}' timed out after ${timeout}ms`));
    }, timeout);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("bos publish subprocess", () => {
  const tempDirs: string[] = [];
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ entries: [] }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start FastKV test server");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps running until the publish phase reaches NEAR", async () => {
    const repoRoot = join(import.meta.dirname, "../../../../");
    const tempDir = mkdtempSync(join(tmpdir(), "bos-publish-cli-"));
    tempDirs.push(tempDir);

    const fakeBinDir = join(tempDir, "bin");
    mkdirSync(fakeBinDir, { recursive: true });

    const nearInvocationFile = join(tempDir, "near-invoked.txt");
    writeFileSync(
      join(fakeBinDir, "near"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "near-cli 0.23.5"
  exit 0
fi
printf "invoked" > "${nearInvocationFile}"
printf "Transaction ID: TESTTX\n"
exit 0
`,
      { mode: 0o755 },
    );

    const result = await runCommand(
      "bun",
      ["packages/everything-dev/src/cli.ts", "publish", "--packages", "host"],
      repoRoot,
      {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        NEAR_PRIVATE_KEY: "ed25519:test",
        REGISTRY_FASTKV_MAINNET_URL: baseUrl,
        BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS: "250",
        BOS_PUBLISH_CONFIRMATION_INTERVAL_MS: "25",
      },
      120_000,
    );

    const cleanStdout = result.stdout
      .replaceAll(String.fromCharCode(27), "")
      .replace(/\[[0-9;?]*[A-Za-z]/g, "");
    expect(cleanStdout).toContain("Publishing to:");
    expect(cleanStdout).toContain("bos.config.json");
    expect(cleanStdout).toContain("Ensuring NEAR CLI...");
    expect(cleanStdout).toContain("NEAR CLI ready");
    expect(cleanStdout).toContain("Submitting transaction on mainnet...");
    expect(cleanStdout).toContain("Waiting for publish confirmation...");
    expect(cleanStdout).toContain("Transaction ID: TESTTX");
    expect(cleanStdout).not.toContain("Warning: No NEAR_PRIVATE_KEY set");
    expect(result.code).not.toBe(0);
  });
});
