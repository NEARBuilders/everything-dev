import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import {
  DEV_ENTRY_FILENAME,
  findHashedEntry,
  isBuildInvocation,
  uiEntryFilename,
} from "../artifact-names";
import { CONTRACT_TYPES_FILE, generateContractTypes } from "../contract-types";
import { BuildReportPlugin } from "./build-report-plugin";
import { ChunkCompletenessPlugin } from "./chunk-completeness-plugin";
import { buildSharedDependencies } from "./module-federation";
import { getPluginInfo } from "./utils";

export interface EveryPluginBuildOptions {
  dts?: boolean;
}

export interface PluginManifestEmitterOptions {
  manifestFileName?: string;
  contractFileName?: string;
}

export class EmitPluginManifest implements RspackPluginInstance {
  name = "EmitPluginManifest";

  constructor(private options: PluginManifestEmitterOptions = {}) {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(this.name, (compilation) => {
      const webpack = (compiler as Compiler & { webpack?: any }).webpack;
      const rawSource = webpack?.sources?.RawSource;
      const stage = webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONS ?? 1000;

      compilation.hooks.processAssets.tapPromise({ name: this.name, stage }, async () => {
        const context = compiler.options.context || process.cwd();
        const pluginInfo = getPluginInfo(context);
        const contractFileName = this.options.contractFileName ?? "contract.d.ts";
        const manifestFileName = this.options.manifestFileName ?? "plugin.manifest.json";

        let generationError: string | null = null;
        try {
          const status = await generateContractTypes(context);
          if (status === "generated") {
            console.log(`[EmitPluginManifest] Contract types regenerated (${context}).`);
          }
        } catch (error) {
          generationError = error instanceof Error ? error.message : String(error);
        }

        if (generationError) {
          console.warn(`[EmitPluginManifest] Skipping manifest generation — ${generationError}`);
          return;
        }

        const sourceContractPath = path.join(context, CONTRACT_TYPES_FILE);

        const tryReadFile = async (filePath: string): Promise<string | null> => {
          if (!fs.existsSync(filePath)) {
            return null;
          }
          const stats = fs.statSync(filePath);
          if (!stats.isFile()) {
            return null;
          }
          try {
            return await fs.promises.readFile(filePath, "utf8");
          } catch {
            return null;
          }
        };

        const contractTypes = (await tryReadFile(sourceContractPath)) ?? "";

        if (!contractTypes) {
          console.warn(
            `[EmitPluginManifest] No contract types at ${sourceContractPath} ` +
              `(no src/contract.ts in this workspace?). Skipping manifest generation.`,
          );
          return;
        }

        const contractSha256 = crypto.createHash("sha256").update(contractTypes).digest("hex");
        const hashedEntry = findHashedEntry(Object.keys(compilation.assets), "remoteEntry");
        const manifest: Record<string, unknown> = {
          schemaVersion: 1,
          kind: "every-plugin/manifest",
          plugin: {
            name: pluginInfo.name,
            version: pluginInfo.version,
          },
          runtime: {
            remoteEntry: `./${hashedEntry ?? DEV_ENTRY_FILENAME}`,
          },
          contract: {
            kind: "orpc",
            types: {
              path: `./types/${contractFileName}`,
              exportName: "contract",
              typeName: "ContractType",
              sha256: contractSha256,
            },
          },
        };

        if (rawSource) {
          compilation.emitAsset(
            manifestFileName,
            new rawSource(`${JSON.stringify(manifest, null, 2)}\n`),
          );
          compilation.emitAsset(`types/${contractFileName}`, new rawSource(`${contractTypes}`));
        }
      });
    });
  }
}

export class EveryPluginBuild implements RspackPluginInstance {
  name = "EveryPluginBuild";

  constructor(private options: EveryPluginBuildOptions = {}) {}

  apply(compiler: Compiler) {
    const pluginInfo = getPluginInfo(compiler.options.context || process.cwd());

    this.configureDefaults(compiler, pluginInfo);

    new ModuleFederationPlugin({
      name: pluginInfo.normalizedName,
      filename: uiEntryFilename({ isBuild: isBuildInvocation() }),
      dts: this.options.dts !== false,
      manifest: {},
      runtimePlugins: [require.resolve("@module-federation/node/runtimePlugin")],
      library: { type: "commonjs-module" },
      exposes: {
        "./plugin": "./src/index.ts",
      },
      shared: buildSharedDependencies(pluginInfo),
      shareStrategy: "version-first",
    }).apply(compiler);

    new BuildReportPlugin().apply(compiler);
    new ChunkCompletenessPlugin().apply(compiler);

    if (this.options.dts === false) {
      compiler.options.plugins = (compiler.options.plugins ?? []).filter(
        (p) =>
          !p ||
          typeof p !== "object" ||
          ((p as any).name !== "MFDevPlugin" && (p as any).name !== "ModuleFederationDtsPlugin"),
      );
    }
  }

  private configureDefaults(compiler: Compiler, pluginInfo: any) {
    const context = compiler.options.context || process.cwd();

    if (!compiler.options.output) {
      compiler.options.output = {};
    }
    compiler.options.output.uniqueName = pluginInfo.normalizedName;
    compiler.options.output.publicPath = "auto";
    compiler.options.output.path = path.resolve(context, "dist");
    // Watch rebuilds must not wipe dist: the dev serve static handler serves
    // this directory, and a clean on every rebuild opens a window where
    // remoteEntry.js 404s for any consumer that loads mid-rebuild.
    compiler.options.output.clean = !compiler.options.watch;
    compiler.options.output.library = { type: "commonjs-module" };

    if (!compiler.options.target) {
      compiler.options.target = "async-node";
    }

    if (!compiler.options.mode) {
      compiler.options.mode = process.env.NODE_ENV === "development" ? "development" : "production";
    }

    if (compiler.options.devtool === undefined) {
      compiler.options.devtool = "source-map";
    }

    if (!compiler.options.infrastructureLogging) {
      compiler.options.infrastructureLogging = {
        level: "warn",
      };
    }

    this.ensureTypeScriptLoader(compiler);

    if (!compiler.options.optimization) {
      compiler.options.optimization = {};
    }
    // rspack 2.x splitChunks re-ids the final chunk graph while the federation
    // get-factory codegen keeps pre-split ids — the entry then references
    // chunks that were never emitted (ChunkCompletenessPlugin's exact failure
    // mode). Splitting off keeps the emitted bundle self-consistent.
    compiler.options.optimization.splitChunks = false;
    // The default deterministic module ids hash module identifiers that embed
    // absolute resource paths, so the same source builds to different id
    // spaces on different machines (host deploy train vs the image's
    // dist-builder stage). A mixed-generation load — CDN-pinned entry +
    // staged chunks — then splices two incompatible id spaces and fails with
    // "__webpack_modules__[r] is not a function". Named ids derive from
    // context-relative requests, keeping builds machine-independent and the
    // two generations semantically identical.
    compiler.options.optimization.moduleIds = "named";

    if (!compiler.options.resolve) {
      compiler.options.resolve = {};
    }
    compiler.options.resolve.extensions = ["...", ".tsx", ".ts"];
    // Source-first for local flows: resolve framework packages through the
    // `development` export condition (TS source) unless DEPLOY=true — the
    // manual dist-first switch deploy-identical builds opt into. (NODE_ENV
    // is unusable as the gate here: the rspack CLI defaults it to
    // "production" for every `build` invocation, including local dev watch.)
    // byDependency entries inherit the root conditions via "...", so
    // dropping the strip lets esm/cjs deps pick up `development` too.
    const sourceFirst = process.env.DEPLOY !== "true";
    compiler.options.resolve.conditionNames = [
      ...(sourceFirst ? ["development"] : []),
      "webpack",
      "import",
      "module",
      "require",
      "node",
      "default",
    ];
    if (sourceFirst) {
      // Source-resolved TS packages (e.g. better-near-auth) use node-style
      // `.js` specifiers for their own relative imports; map them to the
      // on-disk `.ts` sources. `.js` stays first in the expansion: the alias
      // picks the first target that exists on disk, and .ts-first made
      // packages that also ship index.ts (e.g. @scure/base) resolve their
      // TypeScript over their real JavaScript entry.
      compiler.options.resolve.extensionAlias = {
        ".js": [".js", ".ts", ".tsx"],
      };
    }
    if (!sourceFirst && compiler.options.resolve.byDependency) {
      for (const depType of Object.keys(compiler.options.resolve.byDependency)) {
        const depConfig = (
          compiler.options.resolve.byDependency as Record<string, { conditionNames?: string[] }>
        )[depType];
        if (depConfig?.conditionNames) {
          depConfig.conditionNames = depConfig.conditionNames.filter((c) => c !== "development");
        }
      }
    }
    compiler.options.resolve.fallback = {
      ...compiler.options.resolve.fallback,
      bufferutil: false,
      "utf-8-validate": false,
    };
  }

  private ensureTypeScriptLoader(compiler: Compiler) {
    if (!compiler.options.module) {
      compiler.options.module = { rules: [] } as any;
    }

    if (!compiler.options.module.rules) {
      compiler.options.module.rules = [];
    }

    // Source-first resolution pulls every-plugin src into the graph, which
    // imports package.json (runtime/mf-config.ts). The MF shared chunks
    // must emit it as a json module, not parse it as JavaScript.
    const hasJsonRule = compiler.options.module.rules.some(
      (rule: any) =>
        typeof rule === "object" &&
        rule !== null &&
        "test" in rule &&
        rule.test instanceof RegExp &&
        rule.test.test(".json"),
    );

    if (!hasJsonRule) {
      compiler.options.module.rules.push({
        test: /\.json$/,
        type: "json",
      } as any);
    }

    const hasTsLoader = compiler.options.module.rules.some(
      (rule: any) =>
        typeof rule === "object" &&
        rule !== null &&
        "test" in rule &&
        rule.test instanceof RegExp &&
        rule.test.test(".ts"),
    );

    if (!hasTsLoader) {
      compiler.options.module.rules.push({
        test: /\.tsx?$/,
        use: "builtin:swc-loader",
        exclude: /node_modules/,
      });
    }
  }
}
