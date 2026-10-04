/**
 * The core ui's generated bootstrap stubs — the mechanical files an app must
 * never author or edit (ADR 0023): the web MF entry, the `./Hydrate`
 * bootstrap, the SSR router module, the `./compose` expose, and the ambient
 * globals. Emitted into the ui source root by the framework's code-artifact
 * generation pass, regenerated from the installed package version, and
 * gitignored (`*.gen.*`) — never synced, never hand-maintained.
 *
 * The generated hydrate/SSR stubs wire the app's AUTHORED router factory
 * (`src/router.tsx` — the router policy seam) into the framework machinery;
 * the factory file is scaffolded once by `bos init` and owned by the app.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CORE_UI_STUBS: Record<string, string> = {
  "src/entry.gen.ts": `// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by \`bos dev\` / \`bos build\` / \`bos typecheck\` (gitignored).
import "./styles.css";
import { runEntry } from "everything-dev/ui/entry";

runEntry(() => import("./hydrate.gen"));
`,
  "src/hydrate.gen.tsx": `// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by \`bos dev\` / \`bos build\` / \`bos typecheck\` (gitignored).
import "./styles.css";
import { hydrate as coreHydrate } from "everything-dev/ui/hydrate";
import { createRouter } from "./router";

export function hydrate() {
  return coreHydrate({
    routeConfig: () => import("./routeConfig.gen"),
    manifest: () => import("./manifest.gen.json"),
    createRouter,
  });
}

export default hydrate;
`,
  "src/router.server.gen.tsx": `// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by \`bos dev\` / \`bos build\` / \`bos typecheck\` (gitignored).
import { createServerRouterModule } from "everything-dev/ui/router-server";
import { createRouter } from "./router";
import { routeTree } from "./routeTree.gen";

const routerModule = createServerRouterModule({ defaultRouteTree: routeTree, createRouter });

export default routerModule;
`,
  "src/compose.gen.ts": `// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by \`bos dev\` / \`bos build\` / \`bos typecheck\` (gitignored).
export type {
  ConstructedTree,
  ConstructInput,
  ConstructPluginRef,
  GateUser,
  HostContext,
  NavManifest,
  PluginManifest,
  ResolvedPlugin,
  RouteConfigModule,
  RouteOptionsBundle,
} from "everything-dev/ui/manifest";
export {
  CORE_UI_PLUGIN_KEY,
  ComposePayloadSchema,
  constructTree,
} from "everything-dev/ui/manifest";
`,
  "src/globals.gen.ts": `// GENERATED FILE — do not edit. Regenerated from the installed framework version
// by \`bos dev\` / \`bos build\` / \`bos typecheck\` (gitignored).
/// <reference types="@rsbuild/core/types" />
`,
};

/**
 * Emits the stub set into the ui source root. Returns the stub paths whose
 * content actually changed (empty when everything is already current) — the
 * same-content suppression keeps dev watchers from regen loops.
 */
export function emitCoreUiStubs(uiRoot: string): string[] {
  const written: string[] = [];
  for (const [relPath, content] of Object.entries(CORE_UI_STUBS)) {
    const fullPath = join(uiRoot, relPath);
    if (existsSync(fullPath) && readFileSync(fullPath, "utf-8") === content) continue;
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    written.push(relPath);
  }
  return written;
}
