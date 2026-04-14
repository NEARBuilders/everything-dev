type RunResult = { stdout: string; stderr: string; exitCode: number };

export async function run(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; capture?: boolean } = {},
): Promise<RunResult | undefined> {
  const proc = Bun.spawn({
    cmd: [cmd, ...args],
    cwd: options.cwd,
    env: options.env ? { ...(process.env as Record<string, string>), ...options.env } : process.env,
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
  });

  if (!options.capture) {
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${exitCode}`);
    }
    return;
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const result = { stdout, stderr, exitCode };
  return result;
}
