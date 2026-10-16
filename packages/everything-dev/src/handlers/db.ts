import { Effect } from "effect";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import { DatabaseBindings, DrizzleKit } from "../db";
import type { BosBuilder } from "./shared";

export function registerDb(builder: BosBuilder) {
  return {
    dbStudio: builder.dbStudio.effect(function* (_opts, input) {
      const bindings = yield* DatabaseBindings;
      const drizzleKit = yield* DrizzleKit;
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: `${MISSING_CONFIG_MESSAGE} in current directory`,
        };
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const binding = await Effect.runPromise(bindings.forPluginKey(input.plugin));
          await Effect.runPromise(drizzleKit.studio(binding));

          return {
            status: "success" as const,
            plugin: binding.key,
            source: binding.source,
            section: binding.section,
            databaseSecret: binding.identity.secretName,
            databaseUrl: binding.url,
            workspaceDir: binding.identity.workspaceDir,
          };
        },
        catch: (error) => ({
          status: "error" as const,
          plugin: input.plugin,
          source: "remote" as const,
          section: "",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),

    dbDoctor: builder.dbDoctor.effect(function* (_opts, input) {
      const bindings = yield* DatabaseBindings;
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
          error: `${MISSING_CONFIG_MESSAGE} in current directory`,
        };
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const binding = await Effect.runPromise(bindings.forPluginKey(input.plugin));

          const { diagnosePlugin } = await import("../cli/db-doctor");
          const report = await diagnosePlugin(binding);

          return {
            status: "success" as const,
            ...report,
          };
        },
        catch: (error) => ({
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
        }),
      });
    }),

    dbRepair: builder.dbRepair.effect(function* (_opts, input) {
      const bindings = yield* DatabaseBindings;
      const drizzleKit = yield* DrizzleKit;
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "error" as const,
          message: MISSING_CONFIG_MESSAGE,
          diagnosis: null,
          error: "No config",
        };
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const binding = await Effect.runPromise(bindings.forPluginKey(input.plugin));

          const { repairPlugin } = await import("../cli/db-repair");
          const result = await repairPlugin(binding, input.mode ?? "history-reset", drizzleKit);

          return {
            ...result,
            error: result.status === "error" ? result.message : undefined,
          };
        },
        catch: (error) => ({
          status: "error" as const,
          message: error instanceof Error ? error.message : "Unknown error",
          diagnosis: null,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    }),
  };
}
