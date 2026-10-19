import * as p from "@clack/prompts";
import { colors, frames, gradients, icons } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import { failedDeployLegs, renderDeployLegs } from "../render/deploy";
import { renderBuildWarnings } from "../render/deploy-train";
import type { CommandContext, ResultRenderer } from "./context";

export const rollbackPreCall = async (ctx: CommandContext): Promise<void> => {
  const input = ctx.input;
  const client = ctx.client;
  const descriptor = ctx.descriptor;
  const rollbackInput = input as {
    listOnly?: boolean;
    version?: string;
    previous?: boolean;
    [key: string]: unknown;
  };
  if (
    descriptor.key === "rollback" &&
    !rollbackInput.listOnly &&
    !rollbackInput.version &&
    !rollbackInput.previous
  ) {
    const listing = await (client as any).rollback({ ...rollbackInput, listOnly: true });
    if (listing.status !== "list" || !listing.history?.length) {
      console.error(listing.error ?? "No publish history found");
      process.exit(1);
    }
    console.log();
    const selection = await p.select({
      message: "Roll back to which publish?",
      options: listing.history.map(
        (entry: {
          blockHeight: number;
          blockTimestamp: string;
          txHash?: string;
          summary: string;
        }) => ({
          value: String(entry.blockHeight),
          label: `${entry.blockTimestamp}  (block ${entry.blockHeight})`,
          hint: entry.summary,
        }),
      ),
    });
    if (p.isCancel(selection)) {
      return;
    }
    rollbackInput.version = selection as string;
  }
};

export const publishRenderers: Record<string, ResultRenderer> = {
  pluginAdd: async (result, _ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Added plugin ${result.key}`));
    if (result.development) console.log(`  ${colors.dim("Development:")} ${result.development}`);
    if (result.production) console.log(`  ${colors.dim("Production:")} ${result.production}`);
    console.log();
    return;
  },

  pluginRemove: async (result, _ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Removed plugin ${result.key}`));
    console.log();
    return;
  },

  pluginList: async (result, _ctx) => {
    console.log();
    console.log(colors.cyan(frames.top(52)));
    console.log(`  ${icons.config} ${gradients.cyber("PLUGINS")}`);
    console.log(colors.cyan(frames.bottom(52)));
    console.log();
    if (result.plugins.length === 0) {
      console.log(colors.dim("  No plugins configured"));
    } else {
      for (const pluginItem of result.plugins) {
        console.log(`  ${colors.cyan(pluginItem.key)}`);
        if (pluginItem.development)
          console.log(`    ${colors.dim("Development:")} ${pluginItem.development}`);
        if (pluginItem.production)
          console.log(`    ${colors.dim("Production:")} ${pluginItem.production}`);
      }
    }
    console.log();
    return;
  },

  pluginPublish: async (result, _ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Published plugin ${result.key}`));
    if (result.path) console.log(`  ${colors.dim("Path:")} ${result.path}`);
    if (result.production) console.log(`  ${colors.dim("Production:")} ${result.production}`);
    if (result.version) console.log(`  ${colors.dim("Version:")} ${result.version}`);
    if (result.fingerprint) console.log(`  ${colors.dim("Fingerprint:")} ${result.fingerprint}`);
    console.log();
    return;
  },

  registryUse: async (result, _ctx) => {
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(colors.error(`${icons.err} ${result.error || "Unknown error"}`));
      process.exit(1);
    }
    console.log(
      colors.green(
        `${icons.ok} ${result.status === "dry-run" ? "Dry run" : "Composed"} from ${result.from}`,
      ),
    );
    for (const section of result.applied) {
      console.log(`  ${colors.green("+")} ${section}`);
    }
    if (result.configPath) {
      console.log(`  ${colors.dim("Config:")} ${result.configPath}`);
    }
    if (result.status === "updated") {
      console.log(colors.dim("  Run bos types gen to refresh generated types."));
    }
    console.log();
    return;
  },

  publish: async (result, _ctx) => {
    if (result.status === "dry-run") {
      console.log();
      console.log(colors.cyan(`${icons.ok} Dry run complete`));
      console.log(`  ${colors.dim("Registry URL:")} ${result.registryUrl}`);
      console.log();
      return;
    }

    if (exitCodeFor(result) === 1) {
      console.log();
      console.log(colors.error(`${icons.err} Publish failed`));
      if (result.error) {
        console.log(`  ${colors.dim("Error:")} ${result.error}`);
      }
      if (result.deployResults && result.deployResults.length > 0) {
        const failures = result.deployResults.filter((r: any) => !r.success);
        if (failures.length > 0) {
          console.log();
          for (const f of failures) {
            const errorLine = (f.error ?? "Failed").split("\n")[0];
            console.log(`  ${colors.error(icons.err)} ${f.key}: ${errorLine}`);
          }
        }
      }
      console.log();
      process.exit(1);
    }

    if (result.status === "published") {
      console.log();
      console.log(colors.green(`${icons.ok} Published successfully`));
      console.log(`  ${colors.dim("Registry URL:")} ${result.registryUrl}`);
      if (result.txHash) {
        console.log(`  ${colors.dim("Transaction:")} ${result.txHash}`);
      }
      if (result.built && result.built.length > 0) {
        console.log(`  ${colors.dim("Built:")} ${result.built.join(", ")}`);
      }
      if (result.skipped && result.skipped.length > 0) {
        console.log(`  ${colors.dim("Skipped:")} ${result.skipped.join(", ")}`);
      }
      if (result.deployResults) {
        const warnings = result.deployResults.flatMap((r: any) => r.warnings ?? []);
        if (warnings.length > 0) {
          console.log();
          console.log(`  ${colors.yellow("⚠")} Build warnings:`);
          for (const w of warnings) {
            console.log(`    ${colors.dim(w)}`);
          }
        }
      }
      console.log();
      return;
    }
  },

  rollback: async (result, _ctx) => {
    const rollbackResult = result as any;
    if (rollbackResult.status === "error") {
      console.log();
      console.log(colors.error(`${icons.err} Roll back failed`));
      if (rollbackResult.error) {
        console.log(`  ${colors.dim("Error:")} ${rollbackResult.error}`);
      }
      if (rollbackResult.verification) {
        console.log();
        for (const check of rollbackResult.verification) {
          const mark = check.ok ? colors.green(icons.ok) : colors.error(icons.err);
          const reason = check.reason ? colors.dim(` — ${check.reason}`) : "";
          console.log(`  ${mark} ${check.slot}${reason}`);
        }
      }
      console.log();
      process.exit(1);
    }

    if (rollbackResult.status === "dry-run") {
      console.log();
      console.log(colors.cyan(`${icons.ok} Rollback dry run complete`));
      console.log(`  ${colors.dim("Registry URL:")} ${rollbackResult.registryUrl}`);
      console.log();
      return;
    }

    console.log();
    console.log(colors.green(`${icons.ok} Rolled back`));
    console.log(`  ${colors.dim("Registry URL:")} ${rollbackResult.registryUrl}`);
    if (rollbackResult.txHash) {
      console.log(`  ${colors.dim("Transaction:")} ${rollbackResult.txHash}`);
    }
    console.log();
    return;
  },

  deploy: async (result, _ctx) => {
    const deployResult = result as any;
    if (deployResult.status === "list") {
      console.log();
      console.log(colors.cyan("Recent publishes (audit trail)"));
      for (const entry of deployResult.history ?? []) {
        console.log(
          `  ${entry.blockTimestamp}  ${colors.dim(`block ${entry.blockHeight}`)}${entry.publishedAt ? colors.dim(`  ${entry.publishedAt}`) : ""}`,
        );
      }
      console.log();
      return;
    }
    if (deployResult.fingerprint) {
      console.log(`  ${colors.dim("Fingerprint:")} ${deployResult.fingerprint}`);
    }
    if (deployResult.status === "dry-run") {
      console.log();
      console.log(colors.cyan(`${icons.ok} Dry run complete`));
      console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
      console.log();
      return;
    }

    if (deployResult.status === "error") {
      console.log();
      console.log(colors.error(`${icons.err} Deploy failed`));
      if (deployResult.error) {
        console.log(`  ${colors.dim("Error:")} ${deployResult.error}`);
      }
      if (deployResult.deployResults && deployResult.deployResults.length > 0) {
        const failures = deployResult.deployResults.filter((r: any) => !r.success);
        if (failures.length > 0) {
          console.log();
          for (const f of failures) {
            const errorLine = (f.error ?? "Failed").split("\n")[0];
            console.log(`  ${colors.error(icons.err)} ${f.key}: ${errorLine}`);
          }
        }
      }
      console.log();
      process.exit(1);
    }

    if (deployResult.status === "deployed") {
      console.log();
      console.log(colors.green(`${icons.ok} Deployed successfully`));
      console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
      if (deployResult.txHash) {
        console.log(`  ${colors.dim("Transaction:")} ${deployResult.txHash}`);
      }
      if (deployResult.built && deployResult.built.length > 0) {
        console.log(`  ${colors.dim("Built:")} ${deployResult.built.join(", ")}`);
      }
      if (deployResult.skipped && deployResult.skipped.length > 0) {
        console.log(`  ${colors.dim("Skipped:")} ${deployResult.skipped.join(", ")}`);
      }
      if (deployResult.deployResults) {
        renderBuildWarnings(
          deployResult.deployResults as Array<{ key: string; warnings?: string[] }>,
        );
      }
      if (deployResult.image) {
        console.log(`  ${colors.dim("Image:")} ${deployResult.image}`);
      }
      if (deployResult.service) {
        console.log(`  ${colors.dim("Railway:")} deployed ${deployResult.service}`);
      }
      renderDeployLegs(deployResult.legs);
      console.log();
      return;
    }

    if (deployResult.status === "published") {
      const failedLegs = failedDeployLegs(deployResult.legs);
      console.log();
      console.log(
        colors.yellow(
          failedLegs.length > 0
            ? `${icons.err} Config published, but the ${failedLegs.join(" and ")} leg(s) failed`
            : `${icons.err} Config published, but a deploy leg failed`,
        ),
      );
      console.log(`  ${colors.dim("Registry URL:")} ${deployResult.registryUrl}`);
      if (deployResult.txHash) {
        console.log(`  ${colors.dim("Transaction:")} ${deployResult.txHash}`);
      }
      if (deployResult.error) {
        console.log(`  ${colors.dim("Error:")} ${deployResult.error}`);
      }
      renderDeployLegs(deployResult.legs);
      console.log();
      process.exit(1);
    }
  },
};
