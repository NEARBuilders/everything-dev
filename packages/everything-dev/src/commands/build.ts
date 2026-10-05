import { Context } from "effect";
import { buildWorkspaceTargets, selectWorkspaceTargets } from "../build";
import { generateCodeArtifacts } from "../code-artifacts";
import { MISSING_CONFIG_MESSAGE } from "../config";
import type { BosEnv } from "../merge";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerBuild(builder: BosBuilder) {
  return {
    build: builder.build.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
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

      const runtimeConfig = await session.buildRuntime({
        uiSource: bosConfig.app.ui?.development ? "local" : "remote",
        apiSource: bosConfig.app.api?.development ? "local" : "remote",
        authSource: bosConfig.app.auth?.development ? "local" : "remote",
        hostSource: bosConfig.app.host?.development ? "local" : "remote",
        env: buildEnv,
        plugins: session.runtime?.plugins,
      });
      for (const message of session.warnings) {
        console.warn(message);
      }

      await generateCodeArtifacts(session.root, bosConfig, {
        env: buildEnv,
        runtimeConfig,
      });

      const { built, skipped } = await buildWorkspaceTargets({
        configDir: session.root,
        bosConfig,
        runtimeConfig: runtimeConfig,
        targets,
        deploy: false,
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
