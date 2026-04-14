import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import { setupPluginMiddleware } from "./dev-server-middleware";
import { buildSharedDependencies } from "./module-federation";
import { getPluginInfo, loadDevConfig } from "./utils";

export interface EveryPluginOptions {
  devConfigPath?: string;
  port?: number;
  pluginId?: string;
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

        const sourceContractPath = path.join(context, "types", contractFileName);

        let contractTypes: string;

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

        contractTypes = (await tryReadFile(sourceContractPath)) ?? "";

        if (!contractTypes) {
          const packageDir = context.split("/").pop();
          const nestedPath = path.join(context, "types", packageDir ?? "", "src", contractFileName);

          contractTypes = (await tryReadFile(nestedPath)) ?? "";

          if (!contractTypes) {
            console.warn(
              `[EmitPluginManifest] Contract file not found at ${sourceContractPath} or ${nestedPath}. ` +
                `Skipping manifest generation.`,
            );
            return;
          }
        }

        const contractSha256 = crypto.createHash("sha256").update(contractTypes).digest("hex");
        const manifest = {
          schemaVersion: 1,
          kind: "every-plugin/manifest",
          plugin: {
            name: pluginInfo.name,
            version: pluginInfo.version,
          },
          runtime: {
            remoteEntry: "./remoteEntry.js",
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

export class EveryPluginDevServer implements RspackPluginInstance {
  name = "EveryPluginDevServer";

  constructor(private options: EveryPluginOptions = {}) {}

  apply(compiler: Compiler) {
    const pluginInfo = getPluginInfo(compiler.options.context || process.cwd());
    const devConfig = loadDevConfig(this.options.devConfigPath || "./plugin.dev.ts");
    const port = Number(process.env.PORT) || this.options.port || devConfig?.port || 3999;

    this.configureDefaults(compiler, pluginInfo);

    if (!compiler.options.devServer) {
      compiler.options.devServer = {};
    }

    this.configureDevServer(compiler, pluginInfo, devConfig, port);

    new ModuleFederationPlugin({
      name: pluginInfo.normalizedName,
      filename: "remoteEntry.js",
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
    compiler.options.output.clean = true;
    compiler.options.output.library = { type: "commonjs-module" };

    if (!compiler.options.target) {
      compiler.options.target = "async-node";
    }

    if (!compiler.options.mode) {
      compiler.options.mode = process.env.NODE_ENV === "development" ? "development" : "production";
    }

    if (!compiler.options.devtool) {
      compiler.options.devtool = "source-map";
    }

    if (!compiler.options.infrastructureLogging) {
      compiler.options.infrastructureLogging = {
        level: "warn",
      };
    }

    this.ensureTypeScriptLoader(compiler);

    if (!compiler.options.resolve) {
      compiler.options.resolve = {};
    }
    compiler.options.resolve.extensions = ["...", ".tsx", ".ts"];
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

  private configureDevServer(compiler: Compiler, pluginInfo: any, devConfig: any, port: number) {
    if (!compiler.options.devServer) {
      return;
    }

    const context = compiler.options.context || process.cwd();
    const originalSetup = compiler.options.devServer.setupMiddlewares;

    compiler.options.devServer.port = port;
    compiler.options.devServer.static = path.join(context, "dist");
    compiler.options.devServer.hot = true;
    compiler.options.devServer.devMiddleware = { writeToDisk: true };
    compiler.options.devServer.headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
    };

    compiler.options.devServer.client = {
      logging: "warn",
      overlay: {
        warnings: false,
        errors: true,
      },
    };

    compiler.options.devServer.setupMiddlewares = (middlewares, devServer) => {
      setupPluginMiddleware(devServer, pluginInfo, devConfig, port);
      return originalSetup ? originalSetup(middlewares, devServer) : middlewares;
    };
  }
}
