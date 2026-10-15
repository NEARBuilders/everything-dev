import { dirname } from "node:path";
import process from "node:process";
import * as p from "@clack/prompts";
import type { ImportDeps } from "../cli/import";
import { importWorkspace } from "../cli/import";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../config";
import type { ImportOptions, ImportResult } from "../contract";
import type { BosBuilder } from "./shared";

export function registerImport(builder: BosBuilder) {
  return {
    import: builder.import.handler(async ({ input }): Promise<ImportResult> => {
      const configPath = findConfigPath();
      if (!configPath) {
        return {
          status: "error",
          workspace: input.workspace,
          from: input.from,
          ref: "",
          added: [],
          updated: [],
          unchanged: [],
          preservedLocal: [],
          merged: [],
          conflicts: [],
          heldBackMigrations: [],
          migrationCollisions: [],
          error: `${MISSING_CONFIG_MESSAGE} in current directory`,
        };
      }

      const options = input as ImportOptions;
      const projectDir = dirname(configPath);
      const interactive =
        !options.yes && !options.dryRun && process.stdin.isTTY && process.stdout.isTTY;

      const confirm = interactive
        ? async (info: Parameters<NonNullable<ImportDeps["confirm"]>>[0]): Promise<boolean> => {
            const collisionNote =
              info.migrationCollisionCount > 0
                ? ` + ${info.migrationCollisionCount} unresolvable migration collision(s)`
                : "";
            const heldNote =
              info.heldCount > 0
                ? `; ${info.heldCount} migration-chain file(s) will be held back`
                : "";
            const appendedNote =
              info.appendedCount > 0
                ? `; ${info.appendedCount} upstream migration(s) will be renumbered and appended to the local chain`
                : "";
            const answer = await p.confirm({
              message:
                info.conflictCount > 0 || info.migrationCollisionCount > 0
                  ? `${info.conflictCount} conflicting file(s)${collisionNote} in ${info.workspace} — apply upstream over conflicting files (local copies backed up)${heldNote}?`
                  : `Migration chain reconciliation in ${info.workspace}: apply upstream migrations${appendedNote}${heldNote}?`,
              initialValue: false,
            });
            if (p.isCancel(answer)) return false;
            return answer === true;
          }
        : undefined;

      return importWorkspace(projectDir, options, { confirm });
    }),
  };
}
