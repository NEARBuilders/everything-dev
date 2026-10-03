import { Context, Effect } from "effect";
import { findConfigPath } from "../config";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerDb(builder: BosBuilder) {
  return {
    dbStudio: builder.dbStudio.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: "No bos.config.json found in current directory",
        };
      }

      try {
        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));
        await Effect.runPromise(deps.drizzleKit.studio(binding));

        return {
          status: "success" as const,
          plugin: binding.key,
          source: binding.source,
          section: binding.section,
          databaseSecret: binding.identity.secretName,
          databaseUrl: binding.url,
          workspaceDir: binding.identity.workspaceDir,
        };
      } catch (error) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    dbDoctor: builder.dbDoctor.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            plugin: input.plugin,
            slug: "",
            journalTable: "",
            journalSchema: "",
            diagnosis: "error",
            localMigrationCount: 0,
            appliedHashCount: 0,
            expectedTables: [],
            missingTables: [],
            error: "No bos.config.json found in current directory",
          };
        }

        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));

        const { diagnosePlugin } = await import("../cli/db-doctor");
        const report = await diagnosePlugin(binding);

        return {
          status: "success" as const,
          ...report,
        };
      } catch (error) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          slug: "",
          journalTable: "",
          journalSchema: "",
          diagnosis: "error",
          localMigrationCount: 0,
          appliedHashCount: 0,
          expectedTables: [],
          missingTables: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

    dbRepair: builder.dbRepair.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      try {
        const configPath = findConfigPath();
        if (!configPath) {
          return {
            status: "error" as const,
            message: "No bos.config.json found",
            diagnosis: null,
            error: "No config",
          };
        }

        const binding = await Effect.runPromise(deps.databaseBindings.forPluginKey(input.plugin));

        const { repairPlugin } = await import("../cli/db-repair");
        const result = await repairPlugin(binding, input.mode ?? "history-reset", deps.drizzleKit);

        return {
          ...result,
          error: result.status === "error" ? result.message : undefined,
        };
      } catch (error) {
        return {
          status: "error" as const,
          message: error instanceof Error ? error.message : "Unknown error",
          diagnosis: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
  };
}
