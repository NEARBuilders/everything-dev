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

/**
 * The core ui's MF build surface — entry points and the declared exposes
 * (ADR 0008 §2). Entries and the bootstrap exposes resolve to GENERATED
 * stubs (ADR 0023); only surfaces with consumers are declared: the browser
 * bootstrap, the shared component barrel, the SSR router module, the
 * composition engine, and the generated route config.
 */
export const CORE_UI_WEB_ENTRY = "./src/entry.gen.ts";

export const CORE_UI_WEB_EXPOSES: Record<string, string> = {
  "./Hydrate": "./src/hydrate.gen.tsx",
  "./components": "./src/components/index.ts",
};

export const CORE_UI_NODE_ENTRY = "./src/router.server.gen.tsx";

export const CORE_UI_NODE_EXPOSES: Record<string, string> = {
  "./Router": "./src/router.server.gen.tsx",
  "./compose": "./src/compose.gen.ts",
  "./routeConfig": "./src/routeConfig.gen.ts",
};

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
    webEntry: CORE_UI_WEB_ENTRY,
    webExposes: CORE_UI_WEB_EXPOSES,
    nodeEntry: CORE_UI_NODE_ENTRY,
    nodeExposes: CORE_UI_NODE_EXPOSES,
    copy: [{ from: path.join(workspaceRoot, "public"), to: "./" }],
    define: {
      "import.meta.env.APP_NAME": JSON.stringify(domain),
      "import.meta.env.APP_ACCOUNT": JSON.stringify(account),
    },
  });
}
