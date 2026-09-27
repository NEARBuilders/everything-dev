#!/usr/bin/env bun
const [cmd, ...args] = process.argv.slice(2);

const usage = () => console.log("Usage: every-plugin <dev|types|build|deploy|preview> [args…]");

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

// Source-first dev: the dev server resolves framework packages through bun's
// resolver, so re-exec with the `development` export condition when the
// caller didn't already set it. Guarded by env (not argv): bun strips its
// own runtime flags from the child's argv, so an argv check re-execs
// forever. Build/deploy/type flows are untouched — they ship dist.
if (cmd === "dev" && process.env.EVERY_PLUGIN_DEV_CONDITIONS !== "1") {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--conditions=development", new URL(import.meta.url).pathname, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, EVERY_PLUGIN_DEV_CONDITIONS: "1" } },
  );
  process.exit(result.status ?? 0);
}

const { runCliCommand } = await import("../src/cli.ts");
await runCliCommand(cmd, args).catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
