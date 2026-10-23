import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { upgradeTemplate } from "../cli/upgrade";
import { findConfigPath, MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../config";
import { generateCodeArtifacts } from "../services/codegen/artifacts";
import { checkFederationCompat, checkUiCompositionCompat } from "../services/federation/service";
import { readInstalledFrameworkVersion } from "../services/framework-version";
import {
  type PlatformCompatViolation,
  PlatformManifestService,
  type ResolvedPlatformManifest,
} from "../services/platform/manifest";
import { resolvePublishedConfig } from "../services/registry/published";
import { openResolution } from "../services/resolution/session";
import {
  applyV1Tree,
  auditV1Tree,
  isV2Tree,
  maintainV1Tree,
} from "../services/scaffold/upgrade-audit";
import { selectWorkspaceTargets } from "../services/workspace/build-train";
import { readWorkspaceCatalog } from "../services/workspace/catalog";
import { findWorkspaceRoot } from "../services/workspace/workspace";
import type { BosConfig } from "../types";
import { colors } from "../utils/theme";
import type { BosBuilder } from "./shared";

export function registerUpgrade(builder: BosBuilder) {
  return {
    upgrade: builder.upgrade.effect(function* (_opts, input) {
      return yield* Effect.tryPromise({
        try: async () => {
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              status: "error" as const,
              packages: [],
              error: `${MISSING_CONFIG_MESSAGE} in current directory`,
            };
          }

          const projectDir = resolve(dirname(configPath));

          if (input.from === "v1") {
            if (isV2Tree(projectDir)) {
              return {
                status: "already-upgraded" as const,
                packages: [],
                notes: [
                  "bos.app.ts present — this tree is already on the v2 train; nothing to audit or apply",
                ],
              };
            }
            if (input.maintain && input.maintain.length > 0) {
              const migrated: string[] = [];
              const notes: string[] = [];
              for (const step of input.maintain) {
                const result = await maintainV1Tree(projectDir, step, input.dryRun);
                for (const path of result.writes) migrated.push(`${step}: wrote ${path}`);
                for (const path of result.deletes) migrated.push(`${step}: deleted ${path}`);
                for (const note of result.notes) notes.push(`${step}: ${note}`);
              }
              return {
                status: input.dryRun ? ("dry-run" as const) : ("upgraded" as const),
                packages: [],
                migrated,
                notes,
              };
            }
            if (input.audit) {
              const outcome = await auditV1Tree(projectDir);
              const auditResult = {
                tier: outcome.tier,
                findings: outcome.findings,
                manifest: outcome.manifest,
              };
              return outcome.gateBlocked
                ? {
                    status: "gate-blocked" as const,
                    packages: [],
                    audit: auditResult,
                    blockers: outcome.findings.filter((f) => f.severity === "blocker"),
                  }
                : { status: "audit" as const, packages: [], audit: auditResult };
            }
            const outcome = await applyV1Tree(projectDir, input.dryRun);
            if (!outcome.ok) {
              return {
                status: "gate-blocked" as const,
                packages: [],
                blockers: outcome.blockers,
              };
            }
            return {
              status: input.dryRun ? ("dry-run" as const) : ("upgraded" as const),
              packages: [],
              migrated: outcome.outcome.migrated,
              notes: outcome.outcome.notes,
            };
          }

          return await upgradeTemplate(projectDir, input);
        },
        catch: (error) => ({
          status: "error" as const,
          packages: [],
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),

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
            generated: [...generated, ".bos/bos.resolved-config.json"],
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

    typecheck: builder.typecheck.effect(function* (_opts, input) {
      return yield* Effect.tryPromise({
        try: async () => {
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
            env: process.env.NODE_ENV === "production" ? "production" : "development",
            extendsChain: [...refreshed.chain],
            runtimeConfig: runtime,
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
        },
        catch: (error) => ({
          status: "error" as const,
          checked: [],
          skipped: [],
          results: [],
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),

    mfCheck: builder.mfCheck.effect(function* (_opts, input) {
      const platformManifest = yield* PlatformManifestService;
      return yield* Effect.promise(async () => {
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

        // #546: the UI composition compat gate — sibling UI manifests must
        // agree on named shared singletons (the mf-check mirror of the
        // host's boot guard). Absent when no UI slots exist.
        const ui = await checkUiCompositionCompat(authored, { timeoutMs: input.timeoutMs });

        // ADR 0034 pt 5 — the platform compat gate, additive to the federation
        // check (a sibling, never a relaxation). Absent when no manifest
        // resolves (in-image hosts self-describe; the smoke gate covers them).
        let platform: { ok: boolean; violations: PlatformCompatViolation[] } | undefined;
        try {
          const configPath = findConfigPath();
          if (configPath) {
            const projectDir = resolve(dirname(configPath));
            const resolved = await platformManifest.resolvePlatformManifest({
              configDir: projectDir,
              localConfig: authored as Record<string, unknown>,
            });
            if (resolved) {
              const root = findWorkspaceRoot(projectDir)?.dir ?? projectDir;
              const violations = platformManifest.checkPlatformCompat(resolved.manifest, {
                platformVersion: readInstalledFrameworkVersion(projectDir, "everything-dev"),
                catalog: readWorkspaceCatalog(root),
              });
              platform = { ok: violations.length === 0, violations };
            }
          }
        } catch (e) {
          platform = {
            ok: false,
            violations: [
              {
                kind: "minChild",
                message: `platform manifest resolution failed: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }

        return {
          status: report.ok && (platform?.ok ?? true) ? ("ok" as const) : ("fail" as const),
          hostVersion: report.hostVersion,
          hostReachable: report.hostReachable,
          hostReason: report.hostReason,
          remotes: report.remotes,
          ...(ui.slots.length > 0 ? { ui: { ok: ui.ok, slots: ui.slots } } : {}),
          ...(platform ? { platform } : {}),
        };
      });
    }),

    platformManifest: builder.platformManifest.effect(function* (_opts, input) {
      const platformManifest = yield* PlatformManifestService;
      return yield* Effect.promise(async () => {
        // In-image: the booted host self-describes (ADR 0034 pt 1) — the
        // staged manifest is the release's own bytes; a compat check of the
        // image against itself is trivially consistent.
        const inImage = platformManifest.readInImagePlatformManifest();
        if (inImage) {
          return {
            status: "ok" as const,
            version: inImage.frameworkVersion,
            source: "in-image",
            ...(input.check ? { compat: { ok: true, violations: [] } } : {}),
          };
        }

        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "absent" as const,
            version: null,
            error: `${MISSING_CONFIG_MESSAGE} — and the in-image platform manifest is absent (non-framework image)`,
          };
        }
        const projectDir = resolve(dirname(configPath));
        try {
          const authoredConfig =
            ((await readAuthoredConfigInput()) as Record<string, unknown> | null) ?? {};
          let resolved: ResolvedPlatformManifest | null;
          let drift: { pinned: string; published: string } | undefined;
          try {
            resolved = await platformManifest.resolvePlatformManifest({
              configDir: projectDir,
              localConfig: authoredConfig,
            });
          } catch (pinError) {
            // The pin names a release the chain no longer serves — the root
            // republished past it (issue #546). Resolve the latest published
            // manifest so the report names the drift instead of the cryptic
            // pin-not-found error.
            const latest = await platformManifest.resolvePlatformManifest({
              configDir: projectDir,
              localConfig: { ...authoredConfig, platform: undefined },
            });
            if (!latest) throw pinError;
            resolved = latest;
            const pinned =
              typeof authoredConfig.platform === "string" ? authoredConfig.platform : undefined;
            drift = pinned ? { pinned, published: latest.manifest.frameworkVersion } : undefined;
          }
          if (!resolved) {
            return { status: "absent" as const, version: null };
          }
          if (drift) {
            return {
              status: "fail" as const,
              version: drift.published,
              source: `bos://${resolved.source.account}/${resolved.source.gateway}`,
              drift,
              error: `parent platform is ${drift.published} (published at bos://${resolved.source.account}/${resolved.source.gateway}), you pinned ${drift.pinned} — run \`bos upgrade\` to realign`,
            };
          }
          const base = {
            status: "ok" as const,
            version: resolved.manifest.frameworkVersion,
            source: `bos://${resolved.source.account}/${resolved.source.gateway}`,
            fromCache: resolved.fromCache,
          };
          if (!input.check) {
            return base;
          }
          const root = findWorkspaceRoot(projectDir)?.dir ?? projectDir;
          const violations = platformManifest.checkPlatformCompat(resolved.manifest, {
            platformVersion: readInstalledFrameworkVersion(projectDir, "everything-dev"),
            catalog: readWorkspaceCatalog(root),
          });
          return { ...base, compat: { ok: violations.length === 0, violations } };
        } catch (e) {
          return {
            status: "fail" as const,
            version: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      });
    }),
  };
}
