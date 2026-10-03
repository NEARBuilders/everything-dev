import { execa } from "execa";

type RunResult = { stdout: string; stderr: string; exitCode: number };

export async function run(
  cmd: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    capture?: boolean;
    onChunk?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
  } = {},
): Promise<RunResult | undefined> {
  const proc = execa(cmd, args, {
    cwd: options.cwd,
    env: options.env ? { ...(process.env as Record<string, string>), ...options.env } : process.env,
    stdio: options.capture ? "pipe" : "inherit",
    reject: false,
  });

  let capturedStdout = "";
  let capturedStderr = "";

  if (options.capture && options.onChunk) {
    proc.stdout?.on("data", (chunk: Buffer) => {
      capturedStdout += chunk.toString("utf-8");
      options.onChunk!("stdout", chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      capturedStderr += chunk.toString("utf-8");
      options.onChunk!("stderr", chunk);
    });
  }

  // Read the settled result, not the promise object — under execa 9 the
  // promise's stdout/stderr are live streams, not the resolved strings.
  const result = await proc;
  const exitCode = result.exitCode ?? (result.failed ? 1 : 0);

  if (!options.capture) {
    if (exitCode !== 0) {
      throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${exitCode}`);
    }
    return;
  }

  if (options.onChunk) {
    return { stdout: capturedStdout, stderr: capturedStderr, exitCode };
  }

  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    exitCode,
  };
}
