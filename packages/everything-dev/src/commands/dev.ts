import process from "node:process";
import { Context, Effect, References } from "effect";
import type { PhaseTiming } from "../contract";
import { type LogLevelEnv, resolveLogLevel, toEffectLogLevel } from "../dev-log-pipeline";
import { bootstrapLayers, devBootstrap, resolveProxyUrl, startBootstrap } from "../dev-program";
import { openResolution } from "../resolution/session";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerDev(builder: BosBuilder) {
  return {
    dev: builder.dev.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const devTimings: PhaseTiming[] = [];

      const outcome = await Effect.runPromise(
        devBootstrap(deps, input, devTimings, { resolveProxyUrl }).pipe(
          Effect.provideService(
            References.MinimumLogLevel,
            toEffectLogLevel(resolveLogLevel(process.env as LogLevelEnv, input.logLevel)),
          ),
          Effect.provide(bootstrapLayers),
          Effect.catchTags({
            DevConfigMissing: () => Effect.succeed({ failed: "No bos.config.json found" }),
            DevProxyMissing: () =>
              Effect.succeed({ failed: "No valid proxy URL configured in bos.config.json" }),
            DevPreflightFailed: (error) =>
              Effect.succeed({ failed: `Infra preflight failed: ${error.messages.join("; ")}` }),
          }),
        ),
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

    start: builder.start.handler(async ({ input, context }) => {
      const baseDeps = Context.get(context["effect/context"], BosDepsTag);
      let deps = baseDeps;
      if (input.configPath) {
        const override = await openResolution({ path: input.configPath });
        if (!override) {
          return {
            status: "error" as const,
            url: "",
            error: `No config found at ${input.configPath}`,
          };
        }
        deps = { ...baseDeps, session: override };
      }

      const outcome = await Effect.runPromise(
        startBootstrap(deps, input, { resolveProxyUrl }).pipe(
          Effect.provide(bootstrapLayers),
          Effect.catchTags({
            StartRemoteConfigMissing: (error) => Effect.succeed({ failed: error.message }),
            StartFetchFailed: (error) => Effect.succeed({ failed: error.message }),
            StartConfigMissing: () =>
              Effect.succeed({
                failed:
                  "No configuration found. Provide --account and --gateway flags, or create a local bos.config.json.",
              }),
            InfraError: (error) => Effect.succeed({ failed: `${error.phase}: ${error.message}` }),
            DevStepError: (error) =>
              Effect.succeed({
                failed: `${error.phase} failed: ${
                  error.cause instanceof Error ? error.cause.message : String(error.cause)
                }`,
              }),
          }),
        ),
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
  };
}
