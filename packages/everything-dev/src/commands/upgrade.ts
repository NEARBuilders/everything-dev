import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { syncTemplate } from "../cli/sync";
import { upgradeTemplate } from "../cli/upgrade";
import { generateCodeArtifacts } from "../code-artifacts";
import { findConfigPath, MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../config";
import { resolvePublishedConfig } from "../dev-program";
import { checkFederationCompat } from "../services/federation";
import { openResolution } from "../services/resolution/session";
import { selectWorkspaceTargets } from "../services/workspace/build-train";
import type { BosConfig } from "../types";
import { colors } from "../utils/theme";
import type { BosBuilder } from "./shared";

export function registerUpgrade(builder: BosBuilder) {
  return {
    sync: builder.sync.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            updated: [],
            skipped: [],
            added: [],
            error: `${MISSING_CONFIG_MESSAGE} in current directory`,
          };
        }

        const projectDir = resolve(dirname(configPath));
        const result = await syncTemplate(projectDir, input);

        if (result.status === "synced" || result.status === "dry-run") {
          const syncedConfig = await openResolution({ cwd: projectDir });
          if (syncedConfig?.config) {
            await generateCodeArtifacts(projectDir, syncedConfig.config);
          }
        }

        return result;
      } catch (error) {
        return {
          status: "error" as const,
          updated: [],
          skipped: [],
          added: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    upgrade: builder.upgrade.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            packages: [],
            error: `${MISSING_CONFIG_MESSAGE} in current directory`,
          };
        }

        const projectDir = resolve(dirname(configPath));
        return await upgradeTemplate(projectDir, input);
      } catch (error) {
        return {
          status: "error" as const,
          packages: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    typesGen: builder.typesGen.handler(async ({ input }) => {
      try {
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
        const env =
          input.env ?? (process.env.NODE_ENV === "production" ? "production" : "development");

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

          const generated = ["ui/src/lib/api-types.gen.ts", "ui/src/lib/auth-types.gen.ts"];
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
          runtimeConfig: runtime,
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
          generated,
          fetched,
          skipped,
          failed,
        };
      } catch (error) {
        return {
          status: "error" as const,
          generated: [],
          fetched: [],
          skipped: [],
          failed: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    typecheck: builder.typecheck.handler(async ({ input }) => {
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            checked: [],
            skipped: [],
            results: [],
            error: `${MISSING_CONFIG_MESSAGE} in current directory`,
          };
        }

        const projectDir = resolve(dirname(configPath));
        const refreshed = await openResolution({ cwd: projectDir });
        if (!refreshed?.config || !refreshed.runtime) {
          return {
            status: "error" as const,
            checked: [],
            skipped: [],
            results: [],
            error: "Failed to load the authored config",
          };
        }

        const runtime = refreshed.runtime;
        const resolvedConfig = refreshed.config;

        await generateCodeArtifacts(projectDir, resolvedConfig, {
          runtimeConfig: runtime,
          emitPluginUiRouteTree: true,
        });
        type AppTarget = { source?: string; localPath?: string };
        const workspaceEntries: Array<{
          key: string;
          label: string;
          dir: string;
          ui?: boolean;
        }> = [];
        const skipped: Array<{ key: string; label: string }> = [];

        const appTargets: Array<{
          key: string;
          label: string;
          target: AppTarget | undefined;
        }> = [
          { key: "host", label: "host", target: runtime.host },
          { key: "ui", label: "ui", target: runtime.ui },
          { key: "api", label: "api", target: runtime.api },
        ];
        if (runtime.auth) {
          appTargets.push({ key: "auth", label: "auth", target: runtime.auth });
        }

        for (const entry of appTargets) {
          if (
            entry.target?.source === "local" &&
            entry.target.localPath &&
            existsSync(join(entry.target.localPath, "tsconfig.json"))
          ) {
            workspaceEntries.push({
              key: entry.key,
              label: entry.label,
              dir: entry.target.localPath,
            });
          } else {
            skipped.push({ key: entry.key, label: entry.label });
          }
        }

        for (const [key, plugin] of Object.entries(runtime.plugins ?? {})) {
          const label = `plugins/${key}`;
          const localPath = plugin.source === "local" ? plugin.localPath : undefined;
          if (localPath && existsSync(join(localPath, "tsconfig.json"))) {
            workspaceEntries.push({ key, label, dir: localPath });
          } else {
            skipped.push({ key, label });
          }
          // Plugin UIs are not in the plugin root tsconfig — they typecheck
          // through their own ui/tsconfig.json (the typecheck:ui script).
          if (localPath && existsSync(join(localPath, "ui", "tsconfig.json"))) {
            workspaceEntries.push({ key, label: `${label}/ui`, dir: localPath, ui: true });
          }
        }

        const selected = selectWorkspaceTargets(input.packages, resolvedConfig);
        const targets =
          input.packages === "all"
            ? workspaceEntries
            : workspaceEntries.filter((entry) => selected.includes(entry.key));
        const skippedEntries =
          input.packages === "all"
            ? skipped
            : skipped.filter((entry) => selected.includes(entry.key));

        const checked: string[] = [];
        const results: Array<{
          workspace: string;
          passed: boolean;
          error?: string;
        }> = [];

        for (const entry of targets) {
          // Builds keep the plugin ui's routeTree write on a scratch path
          // (the router plugin owns the build-time tree), so typechecking a
          // plugin ui first materializes ui/src/routeTree.gen.ts on disk —
          // without it every createFileRoute call types as `undefined`.
          if (entry.ui && !existsSync(join(entry.dir, "ui", "src", "routeTree.gen.ts"))) {
            try {
              await generateUiManifest({
                workspaceRoot: join(entry.dir, "ui"),
                pluginName: entry.key,
                emitRouteTree: true,
              });
            } catch (error) {
              checked.push(entry.label);
              results.push({
                workspace: entry.label,
                passed: false,
                error: `routeTree materialization failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
              continue;
            }
          }

          const packageJsonPath = join(entry.dir, "package.json");
          let args: string[] = entry.ui
            ? ["exec", "tsc", "--noEmit", "-p", "ui/tsconfig.json"]
            : ["exec", "tsc", "--noEmit"];
          if (existsSync(packageJsonPath)) {
            try {
              const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
                scripts?: Record<string, string>;
              };
              const scriptName = entry.ui ? "typecheck:ui" : "typecheck";
              if (pkg.scripts?.[scriptName]) {
                args = ["run", scriptName];
              }
            } catch {}
          }

          console.log(`\n  ${colors.dim("Checking")} ${colors.cyan(entry.label)}`);
          const child = spawnSync("pnpm", args, {
            cwd: entry.dir,
            stdio: "inherit",
          });
          const passed = child.status === 0;
          checked.push(entry.label);
          results.push({
            workspace: entry.label,
            passed,
            error: passed ? undefined : `typecheck failed (exit code ${child.status ?? "n/a"})`,
          });
        }

        return {
          status: "success" as const,
          checked,
          skipped: skippedEntries.map((entry) => entry.label),
          results,
        };
      } catch (error) {
        return {
          status: "error" as const,
          checked: [],
          skipped: [],
          results: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    mfCheck: builder.mfCheck.handler(async ({ input }) => {
      let authored: BosConfig | null = null;
      try {
        authored = (await readAuthoredConfigInput()) as BosConfig | null;
      } catch (e) {
        return {
          status: "fail" as const,
          hostVersion: null,
          hostReachable: false,
          hostReason: e instanceof Error ? e.message : String(e),
          remotes: [],
        };
      }
      if (!authored) {
        // No local authored config (the universal image carries none): fall
        // back to the registry identity — the same source `bos start` boots
        // from in a runtime container.
        const account = process.env.BOS_ACCOUNT;
        const gateway = process.env.BOS_GATEWAY;
        if (!account || !gateway) {
          return {
            status: "fail" as const,
            hostVersion: null,
            hostReachable: false,
            hostReason: MISSING_CONFIG_MESSAGE,
            remotes: [],
          };
        }
        try {
          authored = await resolvePublishedConfig(account, gateway);
        } catch (e) {
          return {
            status: "fail" as const,
            hostVersion: null,
            hostReachable: false,
            hostReason: e instanceof Error ? e.message : String(e),
            remotes: [],
          };
        }
        if (!authored) {
          return {
            status: "fail" as const,
            hostVersion: null,
            hostReachable: false,
            hostReason: `No config found at bos://${account}/${gateway} — verify BOS_ACCOUNT/BOS_GATEWAY and that the config has been published.`,
            remotes: [],
          };
        }
      }

      const report = await checkFederationCompat(authored, {
        timeoutMs: input.timeoutMs,
      });
      return {
        status: report.ok ? ("ok" as const) : ("fail" as const),
        hostVersion: report.hostVersion,
        hostReachable: report.hostReachable,
        hostReason: report.hostReason,
        remotes: report.remotes,
      };
    }),
  };
}
