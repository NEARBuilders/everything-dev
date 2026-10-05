#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [cmd, ...args] = process.argv.slice(2);

const usage = () => console.log("Usage: every-plugin <dev|types|build|deploy|preview> [args…]");

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

const binPath = fileURLToPath(import.meta.url);
const distCli = new URL("../dist/cli.cjs", import.meta.url);

// Dev always runs the TS source through tsx with the `development` export
// condition (source-first framework resolution per ADR 0018). Everything
// else runs the built dist when it exists; a fresh checkout has no dist yet,
// so the bootstrap build falls back to tsx + src with the same condition —
// the config chain's package-internal imports resolve source over a dist
// that does not exist yet.
if (cmd === "dev" && process.env.EVERY_PLUGIN_TSX !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=development", binPath, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, EVERY_PLUGIN_TSX: "1" } },
  );
  process.exit(result.status ?? 0);
}

if (cmd !== "dev" && existsSync(distCli)) {
  const mod = await import(distCli.href);
  const runCliCommand = mod.runCliCommand ?? mod.default?.runCliCommand;
  await runCliCommand(cmd, args).catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
  process.exit(0);
}

if (process.env.EVERY_PLUGIN_TSX !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=development", binPath, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, EVERY_PLUGIN_TSX: "1" },
    },
  );
  process.exit(result.status ?? 0);
}

const { runCliCommand } = await import("../src/cli.ts");
await runCliCommand(cmd, args).catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
