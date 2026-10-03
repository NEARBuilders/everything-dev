import type { Compiler, RspackPluginInstance } from "@rspack/core";
import { BuildEntryReportSchema, findHashedEntry } from "../artifact-names";

/**
 * Emits `build-report.json` for the deploy leg: the container entry is hashed
 * by the build's filename template (`remoteEntry.[contenthash].js`), and the
 * report names it — in-compilation, so watch-mode cleans can't open a window
 * where the report 404s (mirrors the `output.clean` rationale on the build
 * plugin).
 */
export class BuildReportPlugin implements RspackPluginInstance {
  name = "BuildReportPlugin";

  constructor(private entryBase = "remoteEntry") {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(this.name, (compilation) => {
      const webpack = (compiler as Compiler & { webpack?: any }).webpack;
      const rawSource = webpack?.sources?.RawSource;
      const stage = webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONS ?? 1000;

      compilation.hooks.processAssets.tap({ name: this.name, stage }, (assets) => {
        const entry = findHashedEntry(Object.keys(assets), this.entryBase);
        if (!entry || !rawSource) return;

        const report = BuildEntryReportSchema.parse({ entry });
        compilation.emitAsset(
          "build-report.json",
          new rawSource(`${JSON.stringify(report, null, 2)}\n`),
        );
      });
    });
  }
}
