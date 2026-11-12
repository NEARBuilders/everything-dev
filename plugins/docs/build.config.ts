import type { Compiler, RspackPluginInstance } from "@rspack/core";
import type { PluginBaseConfigOptions } from "every-plugin/build/rspack";

/**
 * Compiles the docs content collections through velite as part of the
 * plugin's rspack build — no hand-run velite step in dev or build. Velite is
 * started once per process (`watch` in watch mode) and its output under
 * `.velite/` is imported by the plugin source.
 */
class VeliteContentPlugin implements RspackPluginInstance {
  name = "VeliteContentPlugin";
  private static started = false;

  apply(compiler: Compiler) {
    compiler.hooks.beforeCompile.tapPromise("VeliteContentPlugin", async () => {
      if (VeliteContentPlugin.started) return;
      VeliteContentPlugin.started = true;
      const { build } = await import("velite");
      await build({
        watch: compiler.options.watch === true,
        clean: compiler.options.watch !== true,
      });
    });
  }
}

export default {
  extraPlugins: [new VeliteContentPlugin()],
} satisfies PluginBaseConfigOptions;
