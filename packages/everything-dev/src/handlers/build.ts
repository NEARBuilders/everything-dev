import { Effect } from "effect";
import { generateCodeArtifacts } from "../code-artifacts";
import { MISSING_CONFIG_MESSAGE } from "../config";
import type { BosEnv } from "../services/resolution/merge";
import { ResolutionSessionService } from "../services/resolution/session";
import {
  type BuildTargetsInput,
  BuildTrainService,
  selectWorkspaceTargets,
} from "../services/workspace/build-train";
import type { BosBuilder } from "./shared";

export function registerBuild(builder: BosBuilder) {
  return {
    build: builder.build.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const train = yield* BuildTrainService;
      if (!session?.config) {
        return {
          status: "error" as const,
          error: MISSING_CONFIG_MESSAGE,
          built: [],
          skipped: [],
        };
      }
      const bosConfig = session.config;

      const buildEnv: BosEnv = "development";

      const targets = selectWorkspaceTargets(input.packages, bosConfig);
      if (targets.length === 0) {
        const allPackages = [
          ...Object.keys(bosConfig.app ?? {}),
          ...Object.keys(bosConfig.plugins ?? {}),
        ];
        return {
          status: "error" as const,
          error: `Unknown build target(s): ${input.packages} — valid targets: ${allPackages.join(", ") || "none"} (framework packages build via the prerequisite train: pnpm run build <target>)`,
          built: [],
          skipped: [],
        };
      }

      const runtimeConfig = yield* Effect.tryPromise({
        try: () =>
          session.buildRuntime({
            uiSource: bosConfig.app.ui?.development ? "local" : "remote",
            apiSource: bosConfig.app.api?.development ? "local" : "remote",
            authSource: bosConfig.app.auth?.development ? "local" : "remote",
            hostSource: bosConfig.app.host?.development ? "local" : "remote",
            env: buildEnv,
            plugins: session.runtime?.plugins,
          }),
        catch: () => ({
          status: "error" as const,
          error: "Could not build the runtime config",
          built: [],
          skipped: [],
        }),
      });
      for (const message of session.warnings) {
        console.warn(message);
      }

      yield* Effect.tryPromise({
        try: () =>
          generateCodeArtifacts(session.root, bosConfig, {
            env: buildEnv,
            runtimeConfig,
          }),
        catch: () => ({
          status: "error" as const,
          error: "Could not generate code artifacts",
          built: [],
          skipped: [],
        }),
      });

      const buildInput: BuildTargetsInput = {
        configDir: session.root,
        bosConfig,
        runtimeConfig,
        targets,
        deploy: false,
      };
      const { built, skipped } = yield* Effect.tryPromise({
        try: () => train.buildTargets(buildInput),
        catch: (error) => ({
          status: "error" as const,
          error: error instanceof Error ? error.message : "Unknown error",
          built: [],
          skipped: [],
        }),
      });

      if (built.length === 0) {
        return {
          status: "error" as const,
          error: `Nothing to build — no local targets matched${skipped.length > 0 ? `: ${skipped.join(", ")}` : ""}`,
          built: [],
          skipped,
        };
      }

      return {
        status: "success" as const,
        built,
        skipped,
      };
    }),
  };
}
