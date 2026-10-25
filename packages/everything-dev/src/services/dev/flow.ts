import process from "node:process";
import { Context, Effect, Layer, References } from "effect";
import { MISSING_CONFIG_MESSAGE } from "../../config";
import type { DevOptions, DevResult, PhaseTiming, StartOptions, StartResult } from "../../contract";
import { ProjectEnvLive } from "../../env/project-env";
import { PortAllocatorLive } from "../../infra/ports";
import { openResolution, type ResolutionSession } from "../resolution/session";
import { startBootstrap } from "../start/boot";
import { devBootstrap } from "./boot";
import { type LogLevelEnv, resolveLogLevel, toEffectLogLevel } from "./logs";

const bootstrapLayers = Layer.mergeAll(ProjectEnvLive, PortAllocatorLive);

export class DevFlowService extends Context.Service<
  DevFlowService,
  {
    dev: (session: ResolutionSession | null, input: DevOptions) => Effect.Effect<DevResult, never>;
    start: (
      session: ResolutionSession | null,
      input: StartOptions,
    ) => Effect.Effect<StartResult, never>;
  }
>()("bos/DevFlowService") {
  static Live = Layer.succeed(
    DevFlowService,
    DevFlowService.of({
      dev: (session, input) =>
        Effect.gen(function* () {
          const devTimings: PhaseTiming[] = [];

          const outcome = yield* devBootstrap({ session }, input, devTimings).pipe(
            Effect.provideService(
              References.MinimumLogLevel,
              toEffectLogLevel(resolveLogLevel(process.env as LogLevelEnv, input.logLevel)),
            ),
            Effect.provide(bootstrapLayers),
            Effect.catchTags({
              DevConfigMissing: () => Effect.succeed({ failed: MISSING_CONFIG_MESSAGE }),
              DevProxyMissing: () =>
                Effect.succeed({
                  failed: "No valid proxy URL configured in the authored config",
                }),
              DevPreflightFailed: (error) =>
                Effect.succeed({ failed: `Infra preflight failed: ${error.messages.join("; ")}` }),
            }),
          );

          if ("failed" in outcome) {
            return {
              status: "error" as const,
              description: outcome.failed,
              processes: [],
              timings: devTimings,
            };
          }

          return {
            status: "started" as const,
            description: outcome.description,
            processes: outcome.processes,
            timings: devTimings,
            session: outcome.session,
          };
        }),

      start: (session, input) =>
        Effect.gen(function* () {
          let activeSession = session;
          if (input.configPath) {
            const override = yield* Effect.promise(() =>
              openResolution({ path: input.configPath }),
            );
            if (!override) {
              return {
                status: "error" as const,
                url: "",
                error: `No config found at ${input.configPath}`,
              };
            }
            activeSession = override;
          }

          const outcome = yield* startBootstrap({ session: activeSession }, input).pipe(
            Effect.provide(bootstrapLayers),
            Effect.catchTags({
              StartRemoteConfigMissing: (error) => Effect.succeed({ failed: error.message }),
              StartFetchFailed: (error) => Effect.succeed({ failed: error.message }),
              StartConfigMissing: () =>
                Effect.succeed({
                  failed:
                    "No configuration found. Provide --account and --gateway flags, or create a local authored config (bos.app.ts or bos.config.json).",
                }),
              InfraError: (error) => Effect.succeed({ failed: `${error.phase}: ${error.message}` }),
              DevStepError: (error) =>
                Effect.succeed({
                  failed: `${error.phase} failed: ${
                    error.cause instanceof Error ? error.cause.message : String(error.cause)
                  }`,
                }),
            }),
          );

          if ("failed" in outcome) {
            return {
              status: "error" as const,
              url: "",
              error: outcome.failed,
            };
          }

          return {
            status: "running" as const,
            url: outcome.url,
            session: outcome.session,
            summary: outcome.summary,
          };
        }),
    }),
  );
}
