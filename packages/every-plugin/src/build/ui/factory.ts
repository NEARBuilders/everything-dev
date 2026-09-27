/**
 * The core ui's rsbuild factory — the workspace-form counterpart of
 * `createUiRsbuildConfig` (folder-form plugin uis). The config object the
 * generated `.every-plugin/ui.rsbuild.config.generated.mjs` materializes:
 * the APP_NAME/APP_ACCOUNT defines come from the authored config through
 * `readAuthoredConfigInput` (everything-dev/config), which the generated
 * file loads in the workspace's own module graph.
 */

import fs from "node:fs";
import path from "node:path";
import { CORE_UI_PLUGIN_KEY } from "../../ui/manifest/contract";
import { createUiRsbuildConfig } from "./rsbuild-config";

export interface CoreUiRsbuildConfigInput {
  /** Authored config domain — stamped as `import.meta.env.APP_NAME`. */
  domain?: string;
  /** Authored config account — stamped as `import.meta.env.APP_ACCOUNT`. */
  account?: string;
}

export function createCoreUiRsbuildConfig({ domain, account }: CoreUiRsbuildConfigInput = {}) {
  const workspaceRoot = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    name: string;
  };

  return createUiRsbuildConfig({
    workspaceRoot,
    pkg,
    role: "provider",
    manifestName: CORE_UI_PLUGIN_KEY,
    devPort: 3003,
    webEntry: "./src/entry.ts",
    webExposes: {
      "./Hydrate": "./src/hydrate.tsx",
      "./components": "./src/components/index.ts",
      "./providers": "./src/providers/index.tsx",
      "./hooks": "./src/hooks/index.ts",
    },
    nodeEntry: "./src/router.server.tsx",
    nodeExposes: {
      "./Router": "./src/router.server.tsx",
      "./compose": "./src/compose.ts",
      "./routeConfig": "./src/routeConfig.gen.ts",
    },
    copy: [{ from: path.join(workspaceRoot, "public"), to: "./" }],
    define: {
      "import.meta.env.APP_NAME": JSON.stringify(domain),
      "import.meta.env.APP_ACCOUNT": JSON.stringify(account),
    },
  });
}
