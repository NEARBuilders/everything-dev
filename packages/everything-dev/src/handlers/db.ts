import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import { DbOpsService } from "../services/db/ops";
import type { BosBuilder } from "./shared";

function missingConfig() {
  return `${MISSING_CONFIG_MESSAGE} in current directory`;
}

export function registerDb(builder: BosBuilder) {
  return {
    dbStudio: builder.dbStudio.effect(function* (_opts, input) {
      if (!findConfigPath()) {
        return {
          status: "error",
          plugin: input.plugin,
          source: "remote",
          section: "",
          error: missingConfig(),
        };
      }
      const db = yield* DbOpsService;
      return yield* db.studio(input.plugin);
    }),

    dbDoctor: builder.dbDoctor.effect(function* (_opts, input) {
      if (!findConfigPath()) {
        return {
          status: "error",
          plugin: input.plugin,
          slug: "",
          journalTable: "",
          journalSchema: "",
          diagnosis: "error",
          localMigrationCount: 0,
          appliedHashCount: 0,
          expectedTables: [],
          missingTables: [],
          error: missingConfig(),
        };
      }
      const db = yield* DbOpsService;
      return yield* db.doctor(input.plugin);
    }),

    dbRepair: builder.dbRepair.effect(function* (_opts, input) {
      if (!findConfigPath()) {
        return {
          status: "error",
          message: MISSING_CONFIG_MESSAGE,
          diagnosis: null,
          error: "No config",
        };
      }
      const db = yield* DbOpsService;
      return yield* db.repair(input.plugin, input.mode ?? "history-reset");
    }),
  };
}
