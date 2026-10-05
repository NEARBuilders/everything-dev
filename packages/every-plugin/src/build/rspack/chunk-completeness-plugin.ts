import type { Compiler, RspackPluginInstance } from "@rspack/core";
import { findHashedEntry } from "../artifact-names";

/**
 * Fails the build when a container entry's eager chunk references
 * (`Promise.all([__webpack_require__.e(N), …])` in get factories) point at
 * chunk files the compilation never emits. Rspack 2.x splitChunks re-ids the
 * final chunk graph while the federation get-factory codegen can keep
 * pre-split ids — the emitted entry then 404s its own chunks at load time and
 * the failure surfaces downstream as `__webpack_modules__[r] is not a
 * function`. SplitChunks is disabled in the composition for exactly this
 * reason; this gate catches any regression loudly at build time instead.
 */
export class ChunkCompletenessPlugin implements RspackPluginInstance {
  name = "ChunkCompletenessPlugin";

  constructor(private entryBase = "remoteEntry") {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(this.name, (compilation) => {
      const webpack = (compiler as Compiler & { webpack?: any }).webpack;
      const stage = webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONS ?? 1000;

      compilation.hooks.processAssets.tap({ name: this.name, stage }, (assets) => {
        const names = Object.keys(assets);
        const entry =
          findHashedEntry(names, this.entryBase) ?? names.find((n) => n === `${this.entryBase}.js`);
        if (!entry) return;

        const jsFiles = new Set(names.filter((n) => n.endsWith(".js")));
        const source = assets[entry].source().toString();

        const special = new Map<string, string>();
        const u = source.match(/\.u\s*=\s*(\w+)=>([^,;]+)/);
        if (u) {
          for (const m of u[2].matchAll(/(\d+)\s*===\s*\w+\s*\?\s*"([^"]+)"/g)) {
            special.set(m[1], m[2]);
          }
        }

        for (const pa of source.matchAll(/Promise\.all\(\[([^\]]*)\]\)/g)) {
          for (const m of pa[1].matchAll(/(?:__webpack_require__|\w+)\.e\((\d+)\)/g)) {
            const id = m[1];
            const file = special.has(id) ? `${special.get(id)}.js` : `${id}.js`;
            if (!jsFiles.has(file)) {
              compilation.errors.push(
                new Error(
                  `[${this.name}] entry ${entry} eagerly loads chunk ${id} (${file}) but the compilation never emitted it — the built remote would fail at load time with "__webpack_modules__[r] is not a function".`,
                ),
              );
            }
          }
        }
      });
    });
  }
}
