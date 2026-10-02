import "dotenv/config";
import { installBundleFetchFromEnv } from "everything-dev/bundle-fs-resolve";
import { runServerBlocking } from "./src/program";
import type { RuntimeConfig } from "./src/services/config";

const configJson = process.env.BOS_RUNTIME_CONFIG;

if (!configJson) {
  console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║  BOS_RUNTIME_CONFIG environment variable is required.             ║
║                                                                   ║
║  The host must be started through the BOS CLI:                    ║
║    bos dev                  # Full local development              ║
║    bos dev --host=local     # Local host with remote UI/API       ║
║    bos start                # Production mode                     ║
║                                                                   ║
║  Direct 'bun run dev' is not supported.                           ║
╚═══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

let config: RuntimeConfig;
try {
  config = JSON.parse(configJson) as RuntimeConfig;
} catch (e) {
  console.error("Failed to parse BOS_RUNTIME_CONFIG:", e);
  process.exit(1);
}

// The host shares the CLI's outbound bundle-fetch tier (bundle-fs-resolve):
// own-namespace staged reads + the stale-if-error cache. Installed before the
// server boots so SSR container loads and any config fetches route through it.
installBundleFetchFromEnv({ configPath: process.env.BOS_CONFIG_PATH ?? null });

runServerBlocking({ config });
