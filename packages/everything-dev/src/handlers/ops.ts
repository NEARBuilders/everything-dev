import { dirname, resolve } from "node:path";
import process from "node:process";
import { Effect } from "effect";
import { probePortBindable } from "../app";
import { buildCiInfraPlan, type CiInfraPlan } from "../cli/infra";
import { getStatus } from "../cli/status";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import { readDevLatestLog, resolveDevLatestFile } from "../dev-logs";
import { ownerOfPort } from "../infra/port-ownership";
import { killProcessGroupEscalating, reapGroup } from "../process-kill";
import { isPidAlive, readRegistry, unregisterPid } from "../process-registry";
import { fetchBosConfigFromFastKv } from "../services/registry/fastkv";
import { pointerFingerprint } from "../services/registry/fingerprint";
import {
  openResolution,
  type ResolutionSession,
  ResolutionSessionService,
} from "../services/resolution/session";
import { computeDeployedVersionStatus, type DeployedVersionStatus } from "../version-status";
import type { BosBuilder } from "./shared";

export function registerOps(builder: BosBuilder) {
  return {
    status: builder.status.effect(function* () {
      const session = yield* ResolutionSessionService;
      return yield* Effect.tryPromise({
        try: async () => {
          const configPath = findConfigPath();
          if (!configPath) {
            return {
              status: "error" as const,
              packages: [],
              envFile: "missing" as const,
              error: `${MISSING_CONFIG_MESSAGE} in current directory`,
            };
          }

          const projectDir = resolve(dirname(configPath));
          const status = await getStatus(projectDir);
          return {
            ...status,
            deployedVersion: await deployedVersionStatus(session),
          };
        },
        catch: (error) => ({
          status: "error" as const,
          packages: [],
          envFile: "missing" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),

    logs: builder.logs.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      return yield* Effect.tryPromise({
        try: async () => {
          const configDir = session?.root ?? process.cwd();
          const text = await readDevLatestLog(configDir, { tail: input.tail });
          const service = input.service;
          const lines = text
            .split("\n")
            .filter((line) => line.length > 0)
            .filter((line) => {
              if (!service) return true;
              const match = /\] \[([^\]]+)\] \[(?:OUT|ERR)\] /.exec(line);
              return match?.[1] === service || match?.[1] === `plugin:${service}`;
            });
          return {
            logFile: resolveDevLatestFile(configDir),
            lines,
          };
        },
        catch: (error) => ({
          logFile: "unknown",
          lines: [
            error instanceof Error
              ? `Failed to read logs: ${error.message}`
              : "Failed to read logs",
          ],
        }),
      });
    }),

    kill: builder.kill.effect(function* (_opts, input) {
      return yield* Effect.tryPromise({
        try: async () => {
          const configPath = findConfigPath();
          const targetConfigDir = input.all
            ? undefined
            : (input.configDir ?? (configPath ? resolve(dirname(configPath)) : undefined));

          const targets = targetConfigDir
            ? readRegistry().filter((entry) => entry.configDir === targetConfigDir)
            : readRegistry();

          const killed: Array<{ pid: number; configDir: string }> = [];
          const skipped: Array<{ pid: number; reason: string }> = [];

          for (const entry of targets) {
            const wasAlive = isPidAlive(entry.pid);
            if (wasAlive) {
              await Effect.runPromise(
                killProcessGroupEscalating(entry.pid, {
                  terminateMs: 5000,
                  signal: input.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM",
                }),
              );
            }

            const reapedChildren: number[] = [];
            for (const childPid of entry.childPids ?? []) {
              if (isPidAlive(childPid)) {
                reapGroup(childPid);
                reapedChildren.push(childPid);
              }
            }

            const ports = Object.values(entry.ports ?? {}).filter(
              (port) => Number.isFinite(port) && port > 0,
            );
            const stillBound: number[] = [];
            for (const port of ports) {
              let bindable = false;
              for (let attempt = 0; attempt < 4; attempt++) {
                bindable = await Effect.runPromise(probePortBindable(port));
                if (bindable) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              if (!bindable) stillBound.push(port);
            }

            if (stillBound.length > 0) {
              const owner = await Effect.runPromise(ownerOfPort(stillBound[0]));
              skipped.push({
                pid: entry.pid,
                reason: `ports still bound after kill: ${stillBound.join(", ")}${
                  owner ? ` — held by pid ${owner.pid} (${owner.command})` : " — owner unknown"
                }`,
              });
              continue;
            }

            unregisterPid(entry.pid);
            killed.push({ pid: entry.pid, configDir: entry.configDir });
            if (!wasAlive && reapedChildren.length > 0) {
              skipped.push({
                pid: entry.pid,
                reason: `process already exited; reaped orphaned children ${reapedChildren.join(", ")}`,
              });
            }
          }

          return {
            status: "killed" as const,
            killed,
            skipped,
          };
        },
        catch: (error) => ({
          status: "error" as const,
          killed: [],
          skipped: [],
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),

    infraExport: builder.infraExport.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const configDir = input.configDir ?? session?.root ?? process.cwd();
      const ci = session?.runtime ? buildCiInfraPlan(session.runtime) : null;
      if (!ci) {
        const refreshed = yield* Effect.promise(() => openResolution({ cwd: configDir }));
        if (!refreshed?.runtime) {
          throw new Error("No resolved runtime config available for infra export");
        }
        return buildCiInfraPlan(refreshed.runtime);
      }
      const result: CiInfraPlan & { account: string; gateway: string } = {
        ...ci,
        account: session?.config?.account ?? ci.account,
        gateway: ci.gateway ?? session?.config?.domain ?? session?.config?.account ?? ci.account,
      };
      return result;
    }),
  };
}

async function deployedVersionStatus(
  session: ResolutionSession | null,
): Promise<DeployedVersionStatus | undefined> {
  const config = session?.config;
  if (!config?.account || !config.domain) return undefined;
  const { account, domain } = config;
  let publishedFingerprint: string | undefined;
  try {
    const published = await fetchBosConfigFromFastKv<Record<string, unknown>>(
      `bos://${account}/${domain}`,
    );
    publishedFingerprint = pointerFingerprint(published as never);
  } catch {
    return undefined;
  }

  const hostUrl = session?.runtime?.host?.url;
  if (!hostUrl) {
    return computeDeployedVersionStatus({ publishedFingerprint, servedFingerprint: null });
  }
  try {
    const response = await fetch(new URL("/.well-known/version", hostUrl));
    if (!response.ok) {
      return computeDeployedVersionStatus({
        publishedFingerprint,
        servedFingerprint: null,
        servedError: `version endpoint returned ${response.status}`,
      });
    }
    const body = (await response.json()) as { fingerprint?: string };
    return computeDeployedVersionStatus({
      publishedFingerprint,
      servedFingerprint: body.fingerprint ?? null,
    });
  } catch (error) {
    return computeDeployedVersionStatus({
      publishedFingerprint,
      servedFingerprint: null,
      servedError: error instanceof Error ? error.message : String(error),
    });
  }
}
