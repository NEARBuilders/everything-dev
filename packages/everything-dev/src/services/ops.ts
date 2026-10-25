import { dirname, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import type { KillResult, LogsResult, StatusResult } from "../contract";
import { ownerOfPort } from "../infra/port-ownership";
import { probePortBindable } from "../infra/ports";
import { readDevLatestLog, resolveDevLatestFile } from "./dev/logs";
import { killProcessGroupEscalating, reapGroup } from "./processes/kill";
import { isPidAlive, readRegistry, unregisterPid } from "./processes/registry";
import { fetchBosConfigFromFastKv } from "./registry/fastkv";
import { pointerFingerprint } from "./registry/fingerprint";
import type { ResolutionSession } from "./resolution/session";
import { getStatus } from "./status";
import { computeDeployedVersionStatus, type DeployedVersionStatus } from "./version/status";

export class OpsService extends Context.Service<
  OpsService,
  {
    status: (session: ResolutionSession | null) => Effect.Effect<StatusResult, never>;
    logs: (
      input: { tail?: number | undefined; service?: string | undefined },
      configDir: string,
    ) => Effect.Effect<LogsResult, never>;
    kill: (input: {
      all?: boolean | undefined;
      configDir?: string | undefined;
      signal?: "SIGTERM" | "SIGKILL" | undefined;
    }) => Effect.Effect<KillResult, never>;
  }
>()("bos/OpsService") {
  static Live = Layer.succeed(
    OpsService,
    OpsService.of({
      status: (session) =>
        Effect.tryPromise({
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
        }),

      logs: (input, configDir) =>
        Effect.tryPromise({
          try: async () => {
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
        }),

      kill: (input) =>
        Effect.tryPromise({
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
        }),
    }),
  );
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
