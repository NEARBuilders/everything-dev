import { join } from "node:path";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import type { PluginBaseConfigOptions } from "every-plugin/build/rspack";
import { contentPatterns } from "./velite.config";

/**
 * Compiles the docs content collections through velite as part of the
 * plugin's rspack build — no hand-run velite step in dev or build. Velite is
 * started once per process and its output under `.velite/` is imported by
 * the plugin source.
 *
 * In watch mode the watching is done here, over the content patterns only:
 * velite's own watcher scans its config root recursively (unfilterable), and
 * a repository-root content source would point it at node_modules and blow
 * past the process file-watcher limit (EMFILE). Each content change reruns
 * the (non-watching) velite build — ~300ms for this corpus — whose rewritten
 * `.velite/index.js` recompiles the plugin through rspack's own watcher.
 */
class VeliteContentPlugin implements RspackPluginInstance {
  name = "VeliteContentPlugin";
  private static started = false;

  apply(compiler: Compiler) {
    compiler.hooks.beforeCompile.tapPromise("VeliteContentPlugin", async () => {
      if (VeliteContentPlugin.started) return;
      VeliteContentPlugin.started = true;
      const { build } = await import("velite");
      const watch = compiler.options.watch === true;
      await build({ clean: !watch });

      if (!watch) return;

      const { watch: chokidarWatch } = await import("chokidar");
      const repoRoot = join(process.cwd(), "../..");
      let rebuilding = Promise.resolve();
      chokidarWatch([...contentPatterns], {
        cwd: repoRoot,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
      }).on("all", (_event, filename) => {
        if (!filename?.match(/\.(md|mdx)$/i)) return;
        rebuilding = rebuilding.then(async () => {
          await build({ clean: false });
        });
      });
    });
  }
}

export default {
  extraPlugins: [new VeliteContentPlugin()],
} satisfies PluginBaseConfigOptions;
