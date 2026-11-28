import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Compiler, RspackPluginInstance } from "@rspack/core";

export interface ContentCompilerOptions {
  /** The workspace whose velite.config.ts declares the collections. Defaults
   * to the rspack compiler's context. */
  cwd?: string;
}

interface VeliteConfigModule {
  /** The content root, relative to the declaring workspace. */
  root?: string;
  output?: { data?: string };
  collections?: Record<string, { pattern?: string | string[] }>;
}

const loadConfig = async (configPath: string): Promise<VeliteConfigModule> => {
  const configModule = (await import(pathToFileURL(configPath).href)) as {
    default?: VeliteConfigModule | (() => VeliteConfigModule | Promise<VeliteConfigModule>);
  };
  const raw = configModule.default;
  return typeof raw === "function" ? await raw() : (raw ?? {});
};

/**
 * Compiles a workspace's content collections through velite inside the
 * rspack build — the framework-owned content plane (ADR 0052). The
 * convention is the config file: a workspace with a `velite.config.ts`
 * compiles content; nothing else is wired by hand.
 *
 * Velite's own watch mode scans its config root recursively and is
 * unfilterable — a content root above the workspace (e.g. a repository
 * root aggregating sibling sources) points the watcher at node_modules and
 * blows past the process file-watcher limit (EMFILE), killing the dev
 * server. This plugin therefore watches in watch mode itself, scoped to
 * the collection patterns (relative to the config's declared root), and
 * reruns the non-watching velite build per change; the rewritten output
 * entry recompiles the workspace through rspack's own watcher.
 */
export class ContentCompilerPlugin implements RspackPluginInstance {
  name = "ContentCompilerPlugin";
  private readonly cwd?: string;
  private started = false;

  constructor(options: ContentCompilerOptions = {}) {
    this.cwd = options.cwd;
  }

  apply(compiler: Compiler) {
    const cwd = this.cwd ?? compiler.options.context ?? process.cwd();
    const configPath = join(cwd, "velite.config.ts");
    if (!existsSync(configPath)) return;

    // Content as a first-class artifact (ADR 0052): the compiled collections
    // ride the dist as JSON assets, so the deploy train's generic file
    // upload (diff, SRI, version directory) carries them with no
    // content-specific leg. The tap registers before any compilation; the
    // output JSONs are read from disk at emit time — the velite build that
    // wrote them completes before the rspack recompile that triggers the
    // next emit.
    const webpack = (compiler as Compiler & { webpack?: any }).webpack;
    const rawSource = webpack?.sources?.RawSource;
    const emitStage = webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONS ?? 1000;
    if (rawSource) {
      compiler.hooks.thisCompilation.tap("ContentCompilerPlugin", (compilation) => {
        compilation.hooks.processAssets.tapPromise(
          { name: "ContentCompilerPlugin", stage: emitStage },
          async () => {
            const config = await loadConfig(configPath);
            const outputDataDir = resolve(cwd, config.output?.data ?? ".velite");
            for (const name of Object.keys(config.collections ?? {})) {
              const file = join(outputDataDir, `${name}.json`);
              if (!existsSync(file)) continue;
              compilation.emitAsset(`content/${name}.json`, new rawSource(readFileSync(file)));
            }
          },
        );
      });
    }

    compiler.hooks.beforeCompile.tapPromise("ContentCompilerPlugin", async () => {
      if (this.started) return;
      this.started = true;

      // Resolve the compiler and watcher from the declaring workspace —
      // velite and chokidar are the workspace's dependencies, not
      // every-plugin's.
      const workspaceRequire = createRequire(pathToFileURL(join(cwd, "package.json")).href);
      let velitePath: string;
      let chokidarPath: string | null = null;
      try {
        velitePath = workspaceRequire.resolve("velite");
        chokidarPath = workspaceRequire.resolve("chokidar");
      } catch (error) {
        throw new Error(
          `ContentCompilerPlugin: "${cwd}" declares velite.config.ts but velite is not installed — add it to the workspace's devDependencies (${error instanceof Error ? error.message : String(error)})`,
        );
      }

      const { build } = await import(pathToFileURL(velitePath).href);
      const watch = compiler.options.watch === true;
      await build({ config: configPath, clean: !watch });
      if (!watch) return;

      if (!chokidarPath) return;
      const { watch: chokidarWatch } = await import(pathToFileURL(chokidarPath).href);
      const config = await loadConfig(configPath);
      const patterns = Object.values(config.collections ?? {}).flatMap((collection) => {
        const pattern = collection.pattern;
        return Array.isArray(pattern) ? pattern : pattern ? [pattern] : [];
      });
      if (patterns.length === 0) return;
      const contentRoot = resolve(cwd, config.root ?? ".");

      let rebuilding: Promise<void> = Promise.resolve();
      chokidarWatch(patterns, {
        cwd: contentRoot,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
      }).on("all", (_event: string, filename: string | undefined) => {
        if (!filename?.match(/\.(md|mdx)$/i)) return;
        rebuilding = rebuilding.then(async () => {
          await build({ config: configPath, clean: false });
        });
      });
    });
  }
}
