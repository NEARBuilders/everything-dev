#!/usr/bin/env node
import { fileURLToPath } from "node:url";

if (process.env.EVERY_PLUGIN_TSX !== "1") {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, EVERY_PLUGIN_TSX: "1" },
  });
  process.exit(result.status ?? 0);
}
await import("../src/dev/serve.ts");
