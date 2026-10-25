import { Context, Effect, Layer } from "effect";
import type { DbDoctorResult, DbRepairResult, DbStudioResult } from "../../contract";
import { DatabaseBindings, DrizzleKit } from "../../db/index";

export class DbOpsService extends Context.Service<
  DbOpsService,
  {
    studio: (plugin: string) => Effect.Effect<DbStudioResult, never>;
    doctor: (plugin: string) => Effect.Effect<DbDoctorResult, never>;
    repair: (
      plugin: string,
      mode: "history-reset" | "recreate",
    ) => Effect.Effect<DbRepairResult, never>;
  }
>()("bos/DbOpsService") {
  static Live = Layer.effect(
    DbOpsService,
    Effect.map(Effect.all([DatabaseBindings, DrizzleKit]), ([bindings, drizzleKit]) => {
      return DbOpsService.of({
        studio: (plugin) =>
          Effect.tryPromise({
            try: async () => {
              const binding = await Effect.runPromise(bindings.forPluginKey(plugin));
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
              plugin,
              source: "remote" as const,
              section: "",
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          }).pipe(Effect.catch((failure) => Effect.succeed(failure))),

        doctor: (plugin) =>
          Effect.tryPromise({
            try: async () => {
              const binding = await Effect.runPromise(bindings.forPluginKey(plugin));

              const { diagnosePlugin } = await import("./doctor");
              const report = await diagnosePlugin(binding);

              return {
                status: "success" as const,
                ...report,
              };
            },
            catch: (error) => ({
              status: "error" as const,
              plugin,
              slug: "",
              journalTable: "",
              journalSchema: "",
              diagnosis: "error" as const,
              localMigrationCount: 0,
              appliedHashCount: 0,
              expectedTables: [] as string[],
              missingTables: [] as string[],
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          }).pipe(Effect.catch((failure) => Effect.succeed(failure))),

        repair: (plugin, mode) =>
          Effect.tryPromise({
            try: async () => {
              const binding = await Effect.runPromise(bindings.forPluginKey(plugin));

              const { repairPlugin } = await import("./repair");
              const result = await repairPlugin(binding, mode, drizzleKit);

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
          }).pipe(Effect.catch((failure) => Effect.succeed(failure))),
      });
    }),
  );
}
