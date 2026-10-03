import type { RsbuildPlugin } from "@rsbuild/core";
import { generateUiManifest } from "../../ui/manifest/generator";

/**
 * Rsbuild plugin that keeps a ui source's generated artifacts fresh during
 * builds and dev watch: manifest.gen.json + routeConfig.gen.ts are
 * regenerated in plugin setup (before any environment compiles, so the
 * `./routeConfig` MF expose resolves), and again on every build/dev-compile
 * start. The stock routeTree write is redirected to a scratch path —
 * TanStackRouterRspack owns src/routeTree.gen.ts (its autoCodeSplitting
 * options differ from the manifest pass).
 */

export interface UiManifestGenPluginOptions {
  workspaceRoot: string;
  pluginName: string;
}

const inFlight = new Map<string, Promise<unknown>>();

/** rsbuild builds environments in parallel and each setup runs the generator — concurrent runs share one pass. */
function runOnce(key: string, run: () => Promise<unknown>): Promise<unknown> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function uiManifestGenPlugin(options: UiManifestGenPluginOptions): RsbuildPlugin {
  const run = () =>
    runOnce(`${options.workspaceRoot}::${options.pluginName}`, () =>
      generateUiManifest({
        workspaceRoot: options.workspaceRoot,
        pluginName: options.pluginName,
        emitRouteTree: false,
      }),
    );

  return {
    name: "ui-manifest-gen",
    async setup(api) {
      await run();
      api.onBeforeBuild(async () => {
        await run();
      });
      api.onBeforeDevCompile(async () => {
        await run();
      });
    },
  };
}
