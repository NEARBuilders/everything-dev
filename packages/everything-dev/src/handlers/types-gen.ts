import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import { generateCodeArtifacts } from "../services/codegen/artifacts";
import { checkFederationCompat, checkUiCompositionCompat } from "../services/federation/service";
import { readInstalledFrameworkVersion } from "../services/framework-version";
import {
  ManifestService,
  type PlatformCompatViolation,
  type ResolvedPlatformManifest,
} from "../services/platform/manifest";
import { resolvePublishedConfig } from "../services/registry/published";
import { openResolution } from "../services/resolution/session";
import { selectWorkspaceTargets } from "../services/workspace/build-train";
import { readWorkspaceCatalog } from "../services/workspace/catalog";
import { findWorkspaceRoot } from "../services/workspace/workspace";
import type { BosConfig } from "../types";
import { colors } from "../utils/theme";
import type { BosBuilder } from "./shared";

const nodeEnvProduction = (): boolean => process.env.NODE_ENV === "production";
const envOf = (name: string): string | undefined => process.env[name];

export function registerTypesGen(builder: BosBuilder) {
  return {
    typesGen: builder.typesGen.effect(function* (_opts, input) {
      return yield* Effect.tryPromise({
        try: async () => {
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              status: "error" as const,
              generated: [],
              fetched: [],
              skipped: [],
              failed: [],
              error: `${MISSING_CONFIG_MESSAGE} in current directory`,
            };
          }

          const projectDir = resolve(dirname(configPath));
          const env = input.env ?? (nodeEnvProduction() ? "production" : "development");

          const refreshed = await openResolution({
            cwd: projectDir,
            env,
            remotePlugins: input.remotePlugins,
          });
          if (!refreshed?.config || !refreshed.runtime) {
            return {
              status: "error" as const,
              generated: [],
              fetched: [],
              skipped: [],
              failed: [],
              error: "Failed to load the authored config",
            };
          }

          const runtime = refreshed.runtime;
          const resolvedConfig = refreshed.config;

          if (input.dryRun) {
            const pluginEntries = Object.entries(runtime.plugins ?? {});
            const fetched: string[] = [];
            const skipped: string[] = [];
            const hasLocalApiWorkspace = existsSync(join(projectDir, "api", "src"));

            if (runtime.api.source !== "local") {
              fetched.push(`api remote (${runtime.api.url})`);
            } else {
              const path = runtime.api.localPath
                ? ` (${relative(projectDir, runtime.api.localPath)})`
                : "";
              skipped.push(`api local${path}`);
            }

            if (runtime.auth) {
              if (runtime.auth.source !== "local") {
                fetched.push(`auth remote (${runtime.auth.url})`);
              } else {
                const path = runtime.auth.localPath
                  ? ` (${relative(projectDir, runtime.auth.localPath)})`
                  : "";
                skipped.push(`auth local${path}`);
              }
            }

            for (const [key, plugin] of pluginEntries) {
              if (plugin.url && plugin.source !== "local") {
                fetched.push(`${key} remote (${plugin.url})`);
              } else if (plugin.localPath) {
                skipped.push(`${key} local (${relative(projectDir, plugin.localPath)})`);
              } else {
                skipped.push(`${key} no URL resolved`);
              }
            }

            const generated = [
              "ui/src/lib/api-types.gen.ts",
              "ui/src/lib/auth-types.gen.ts",
              ".bos/bos.resolved-config.json",
            ];
            if (hasLocalApiWorkspace) {
              generated.push("api/src/lib/plugins-types.gen.ts", "api/src/lib/auth-types.gen.ts");
            }
            if (existsSync(join(projectDir, "host", "src"))) {
              generated.push("host/src/lib/auth-types.gen.ts");
            }
            for (const [_key, plugin] of pluginEntries) {
              const localPath = plugin.localPath;
              if (!localPath) continue;
              const pluginSrc = join(localPath, "src", "lib", "plugins-client.gen.ts");
              if (existsSync(pluginSrc)) {
                generated.push(relative(projectDir, pluginSrc));
              }
            }
            if (runtime.auth?.localPath) {
              const authSrc = join(runtime.auth.localPath, "src", "lib", "plugins-client.gen.ts");
              if (existsSync(authSrc)) {
                generated.push(relative(projectDir, authSrc));
              }
            }

            return {
              status: "success" as const,
              generated,
              fetched,
              skipped,
              failed: [],
            };
          }

          const artifacts = await generateCodeArtifacts(projectDir, resolvedConfig, {
            env,
            extendsChain: [...refreshed.chain],
            runtimeConfig: runtime,
            forceRouteTree: true,
            // bos types gen is the strict runtime-map gate (#594): an
            // unresolvable remote manifest fails the run so typecheck
            // catches an upstream rename instead of shrinking the map
            runtimeMapStrict: true,
          });

          const hasLocalApiWorkspace = existsSync(join(projectDir, "api", "src"));
          const generated = ["ui/src/lib/api-types.gen.ts"];
          if (hasLocalApiWorkspace) {
            generated.push("api/src/lib/plugins-types.gen.ts", "api/src/lib/auth-types.gen.ts");
          }
          if (runtime.auth && (runtime.auth.source !== "local" || runtime.auth.localPath)) {
            generated.push("ui/src/lib/auth-types.gen.ts");
          }
          if (existsSync(join(projectDir, "host", "src"))) {
            generated.push("host/src/lib/auth-types.gen.ts");
          }
          for (const [_key, plugin] of Object.entries(runtime.plugins ?? {})) {
            const localPath = plugin.localPath;
            if (!localPath) continue;
            const pluginSrc = join(localPath, "src", "lib", "plugins-client.gen.ts");
            if (existsSync(pluginSrc)) {
              generated.push(relative(projectDir, pluginSrc));
            }
          }
          if (runtime.auth?.localPath) {
            const authSrc = join(runtime.auth.localPath, "src", "lib", "plugins-client.gen.ts");
            if (existsSync(authSrc)) {
              generated.push(relative(projectDir, authSrc));
            }
          }

          const contractStatus = artifacts?.contractStatus ?? [];
          const fetched: string[] = [];
          const skipped: string[] = [];
          const failed: string[] = [];
          for (const entry of contractStatus) {
            if (entry.source === "remote") {
              fetched.push(entry.url ? `${entry.key} remote (${entry.url})` : entry.key);
            } else if (entry.source === "local") {
              const path = entry.localPath ? ` (${relative(projectDir, entry.localPath)})` : "";
              skipped.push(`${entry.key} local${path}`);
            } else if (entry.source === "skipped") {
              skipped.push(`${entry.key} no URL resolved`);
            } else if (entry.source === "failed") {
              const detail = entry.error ? `: ${entry.error}` : "";
              failed.push(`${entry.key}${detail}`);
            }
          }

          return {
            status: "success" as const,
            generated: [
              ...generated,
              ".bos/bos.resolved-config.json",
              // the composition inventory (#594) — emitted when the map's
              // sources resolve (skipped with a note otherwise)
              ...(existsSync(join(projectDir, ".bos/generated/runtime-map.json"))
                ? [".bos/generated/runtime-map.json"]
                : []),
              ...(runtime.ui?.source === "local" &&
              runtime.ui.localPath &&
              existsSync(join(runtime.ui.localPath, "src/lib/runtime-map.gen.ts"))
                ? ["ui/src/lib/runtime-map.gen.ts"]
                : []),
            ],
            fetched,
            skipped,
            failed,
          };
        },
        catch: (error) => ({
          status: "error" as const,
          generated: [],
          fetched: [],
          skipped: [],
          failed: [],
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),
  };
}
