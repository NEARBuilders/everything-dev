import { colors, frames, gradients, icons } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import type { ResultRenderer } from "./context";

export const dbRenderers: Record<string, ResultRenderer> = {
  dbStudio: async (result, ctx) => {
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }

    return;
  },

  dbDoctor: async (result, ctx) => {
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Diagnosis failed"}`);
      process.exit(1);
    }

    const statusIcon = (() => {
      switch (result.diagnosis) {
        case "healthy":
          return "✓";
        case "empty":
          return "○";
        case "unapplied":
          return "○";
        case "untracked-existing-schema":
          return "○";
        case "drift-safe-repair":
          return "⚠";
        case "drift-manual":
          return "✗";
        default:
          return "?";
      }
    })();

    console.log(`\n${statusIcon}  ${result.plugin}`);
    console.log(`  ${colors.dim(`Journal:`)} ${result.journalSchema}.${result.journalTable}`);
    console.log(`  ${colors.dim(`Local migrations:`)} ${result.localMigrationCount}`);
    console.log(`  ${colors.dim(`Applied hashes:`)} ${result.appliedHashCount}`);
    if (result.expectedTables.length > 0) {
      console.log(`  ${colors.dim(`Expected tables:`)} ${result.expectedTables.join(", ")}`);
    }
    if (result.missingTables.length > 0) {
      console.log(`  ${colors.yellow(`Missing tables:`)} ${result.missingTables.join(", ")}`);
    }
    console.log(`  ${colors.dim(`Diagnosis:`)} ${result.diagnosis}`);
    if (result.workspaceDir) {
      console.log(`  ${colors.dim(`Workspace:`)} ${result.workspaceDir}`);
    }
    console.log();
    return;
  },

  dbRepair: async (result, ctx) => {
    if (result.status === "refused") {
      console.log(
        `\n${colors.yellow("!")}  Repair refused for ${result.diagnosis?.plugin ?? result.message}`,
      );
      console.log(`  ${result.message}`);
      console.log();
      process.exit(0);
    }

    if (exitCodeFor(result) === 1) {
      console.error(`\n${colors.error("✗")}  Repair failed`);
      console.error(`  ${result.message}`);
      console.error();
      process.exit(1);
    }

    console.log(`\n${colors.green("✓")}  Repair complete`);
    console.log(`  ${result.message}`);
    console.log();
    return;
  },
};
