import { join, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import {
  buildInitPatterns,
  buildPluginRouteExclusions,
  buildStarterRouteExclusions,
  convertChildConfigToAppForm,
  copyFilteredFiles,
  detectGitRemoteUrl,
  fetchParentConfig,
  generateDatabaseMigrations,
  personalizeAgentsMd,
  personalizeConfig,
  removeInitLockfile,
  resolveSourceDir,
  runBunInstall,
  runTypesGen,
  scaffoldMinimalProject,
  stripOrphanedWorkspacesFromLockfile,
  writeDevOverlayTemplate,
  writeInitSnapshot,
} from "../cli/init";
import { pruneUnusedUiFiles } from "../cli/prune";
import { generateCodeArtifacts } from "../code-artifacts";
import type { OverrideSection, PhaseTiming } from "../contract";
import { makeProjectEnv } from "../env/project-env";
import { parseBosUrl } from "../fastkv";
import { materializeViaLayer } from "../infra/materializer";
import { timePhase } from "../progress";
import { openResolution } from "../resolution/session";
import { syncResolvedSharedDeps } from "../shared-deps";
import type { BosConfig, BosConfigInput, StarterLevel } from "../types";
import type { BosBuilder } from "./shared";

export async function fetchInitParent(
  extendsAccount: string,
  extendsGateway: string,
): Promise<{ parentConfig: BosConfig; parentPluginKeys: string[] }> {
  const parentConfig = await fetchParentConfig(extendsAccount, extendsGateway);
  const parentPluginKeys =
    parentConfig?.plugins && typeof parentConfig.plugins === "object"
      ? Object.keys(parentConfig.plugins)
      : [];
  return { parentConfig, parentPluginKeys };
}

function normalizeExtendsRef(extendsInput: string | undefined, fallback: string): string {
  if (!extendsInput) return fallback;
  return extendsInput.startsWith("bos://") ? extendsInput : `bos://${extendsInput}`;
}

export function registerInit(builder: BosBuilder) {
  return {
    init: builder.init.handler(async ({ input }) => {
      try {
        const timings: PhaseTiming[] = [];
        let extendsAccount = "";
        let extendsGateway = "";
        let directory = input.directory;
        const account = input.account;
        const domain = input.domain;
        let overrides = input.overrides as OverrideSection[] | undefined;
        let plugins = input.plugins;

        if (input.extends) {
          try {
            const { accountId, gatewayId } = parseBosUrl(normalizeExtendsRef(input.extends, ""));
            extendsAccount = accountId;
            extendsGateway = gatewayId;
          } catch {
            extendsAccount = "";
            extendsGateway = "";
          }
        }

        extendsAccount = extendsAccount || "dev.everything.near";
        extendsGateway = extendsGateway || "everything.dev";

        directory = directory || domain || extendsGateway;
        const targetDir = resolve(directory);
        const extendsRef = `bos://${extendsAccount}/${extendsGateway}`;

        let parentPluginKeys: string[] = [];
        let parentConfig: BosConfig | null = null;
        try {
          const parent = await timePhase(timings, "parent config", () =>
            fetchInitParent(extendsAccount, extendsGateway),
          );
          parentConfig = parent.parentConfig;
          parentPluginKeys = parent.parentPluginKeys;
        } catch (e) {
          console.warn(
            `[init] Failed to fetch parent config from ${extendsAccount}/${extendsGateway}: ${
              e instanceof Error ? e.message : e
            }`,
          );
          return {
            status: "error" as const,
            directory,
            extendsRef,
            account,
            domain,
            extends: extendsRef,
            plugins,
            overrides,
            filesCopied: 0,
            timings,
            error: `No config found at ${extendsRef} — are you sure this is the right parent?`,
          };
        }

        overrides = overrides?.length ? overrides : (["ui", "api"] as OverrideSection[]);
        const level: StarterLevel = input.level ?? "simple";
        if (overrides.includes("plugins") && plugins === undefined) {
          plugins = parentPluginKeys;
        }
        plugins = plugins ?? [];

        const pluginDirMap: Record<string, string> = {};
        if (parentConfig?.plugins) {
          for (const plugin of plugins) {
            const entry = (parentConfig.plugins as Record<string, unknown>)?.[plugin];
            if (entry && typeof entry === "object") {
              const dev = (entry as Record<string, unknown>).development;
              if (typeof dev === "string") {
                const match = dev.match(/^local:plugins\/(.+)$/);
                if (match?.[1] && match[1] !== plugin) pluginDirMap[plugin] = match[1];
              }
            }
          }
        }

        const repository =
          (await detectGitRemoteUrl(process.cwd()).catch(() => undefined)) ??
          parentConfig?.repository;

        const {
          sourceDir,
          parentConfig: resolvedParentConfig,
          cleanup,
        } = await timePhase(timings, "template source", () =>
          resolveSourceDir({
            extendsAccount,
            extendsGateway,
            source: input.source,
          }),
        );

        parentConfig = resolvedParentConfig;

        const isMinimalScaffold = sourceDir === "";

        try {
          let filesCopied: number;
          let childBosConfig: BosConfigInput | null = null;

          if (isMinimalScaffold) {
            filesCopied = await timePhase(timings, "scaffold project", () =>
              scaffoldMinimalProject(targetDir, parentConfig as unknown as BosConfigInput, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain,
                plugins,
                overrides,
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
                starter: level,
              }),
            );

            await timePhase(timings, "personalize config", () =>
              personalizeConfig(targetDir, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain: domain || extendsGateway,
                plugins,
                overrides,
                mode: "init",
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
                testnet: parentConfig?.testnet,
                staging: parentConfig?.staging,
                starter: level,
              }),
            );

            childBosConfig = await timePhase(timings, "authored config form", () =>
              convertChildConfigToAppForm(targetDir),
            );

            writeDevOverlayTemplate(targetDir, {
              extendsRef: `bos://${extendsAccount}/${extendsGateway}`,
            });
          } else {
            const patterns = buildInitPatterns(overrides, plugins, pluginDirMap);
            const routeExclusions = overrides.includes("ui")
              ? buildPluginRouteExclusions(parentConfig, plugins)
              : [];
            const starterExclusions = overrides.includes("ui")
              ? buildStarterRouteExclusions(level, parentConfig)
              : [];
            const copyIgnore = [...routeExclusions, ...starterExclusions];

            filesCopied = await timePhase(timings, "copy files", () =>
              copyFilteredFiles(sourceDir, targetDir, patterns, {
                overrides,
                plugins,
                ignore: copyIgnore,
              }),
            );

            await timePhase(timings, "personalize config", () =>
              personalizeConfig(targetDir, {
                extendsAccount,
                extendsGateway,
                account: account || extendsAccount,
                domain: domain || extendsGateway,
                plugins,
                overrides,
                workspaceOpts: { sourceDir },
                repository,
                title: parentConfig?.title,
                description: parentConfig?.description,
                testnet: parentConfig?.testnet,
                staging: parentConfig?.staging,
                starter: level,
              }),
            );

            childBosConfig = await timePhase(timings, "authored config form", () =>
              convertChildConfigToAppForm(targetDir),
            );

            writeDevOverlayTemplate(targetDir, {
              extendsRef: `bos://${extendsAccount}/${extendsGateway}`,
            });

            if (overrides.includes("ui")) {
              await timePhase(timings, "prune unused ui files", async () =>
                pruneUnusedUiFiles(targetDir, { log: console.log }),
              );
            }

            await timePhase(timings, "write snapshot", () =>
              writeInitSnapshot(targetDir, extendsAccount, extendsGateway, sourceDir, patterns, {
                overrides,
                plugins,
                ignore: copyIgnore,
                starter: level,
              }),
            );

            await timePhase(timings, "personalize agents", () =>
              personalizeAgentsMd(targetDir, { overrides, plugins }),
            );
          }

          await timePhase(timings, "sync shared deps", () =>
            syncResolvedSharedDeps({
              configDir: targetDir,
              hostMode: "local",
              bosConfig: childBosConfig
                ? (childBosConfig as unknown as Record<string, unknown>)
                : undefined,
            }),
          );

          const lockfilePath = join(targetDir, "bun.lock");
          const allowedWorkspaces = computeAllowedWorkspaces(overrides, plugins);
          stripOrphanedWorkspacesFromLockfile(lockfilePath, allowedWorkspaces);
          removeInitLockfile(lockfilePath);

          const initConfig = await timePhase(timings, "resolve config", () =>
            openResolution({ cwd: targetDir }).catch((error: unknown) => {
              console.warn(
                "[init] Skipping config resolution — the child has no node_modules yet; `bos dev` resolves after `bun install`.",
                error instanceof Error ? error.message : error,
              );
              return null;
            }),
          );
          const initRuntime = initConfig?.runtime;
          if (initRuntime) {
            await timePhase(timings, "generate env/docker", async () => {
              await materializeViaLayer(targetDir, initRuntime);
            });
          }
          await timePhase(timings, "create env file", async () => {
            await Effect.runPromise(makeProjectEnv().ensureFile(targetDir));
          });

          if (!input.noInstall) {
            await timePhase(timings, "install dependencies", () => runBunInstall(targetDir));
            await timePhase(timings, "generate types", () => runTypesGen(targetDir));
            await timePhase(timings, "generate migrations", () =>
              generateDatabaseMigrations(targetDir),
            );
          }

          const initArtifactsConfig = initConfig?.config;
          if (input.noInstall && initArtifactsConfig) {
            await timePhase(timings, "generate code artifacts", () =>
              generateCodeArtifacts(targetDir, initArtifactsConfig),
            );
          }

          return {
            status: "initialized" as const,
            directory,
            extendsRef,
            account,
            domain,
            extends: extendsRef,
            plugins,
            overrides,
            filesCopied,
            timings,
            targetDir,
          };
        } finally {
          await cleanup();
        }
      } catch (error) {
        const extendsRef = normalizeExtendsRef(
          input.extends,
          "bos://dev.everything.near/everything.dev",
        );
        return {
          status: "error" as const,
          directory: input.directory ?? "",
          extendsRef,
          account: input.account,
          domain: input.domain,
          extends: extendsRef,
          plugins: input.plugins ?? [],
          overrides: input.overrides,
          filesCopied: 0,
          timings: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
  };
}

function computeAllowedWorkspaces(overrides: string[], plugins?: string[]): string[] {
  const workspaces: string[] = [];
  for (const section of overrides) {
    if (section === "host") workspaces.push("host");
    if (section === "ui") workspaces.push("ui");
    if (section === "api") workspaces.push("api");
  }
  if (plugins && plugins.length > 0) {
    workspaces.push("plugins/*");
  }
  return workspaces;
}
