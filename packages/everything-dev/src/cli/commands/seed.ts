import * as p from "@clack/prompts";
import type { SeedResult } from "../../contract";
import { colors, icons } from "../../utils/theme";
import type { CommandContext, ResultRenderer } from "./context";

/**
 * Production seeding is explicit (#865): `bos seed --env production` must be
 * confirmed, and the owner bootstrap demands env-provided credentials
 * (enforced in the handler) — never config defaults, never boot side effects.
 */
export const seedPreCall = async (ctx: CommandContext): Promise<void> => {
  const input = ctx.input as { env?: string; yes?: boolean; [key: string]: unknown };
  if (input.env !== "production" || input.yes === true) return;
  console.log();
  const confirmed = await p.confirm({
    message: "Seed the production databases? This writes data outside the deploy train.",
    initialValue: false,
  });
  if (p.isCancel(confirmed) || confirmed !== true) {
    console.log(colors.dim("Aborted — nothing was written."));
    process.exit(1);
  }
  input.yes = true;
};

export const seedRenderers: Record<string, ResultRenderer> = {
  seed: async (result, _ctx) => {
    const r = result as SeedResult;
    console.log();
    if (r.status === "error") {
      console.error(colors.error(`${icons.err} ${r.error ?? "bos seed failed"}`));
      return;
    }
    if (r.status === "skipped") {
      console.log(`  ${colors.dim(icons.ok)} skipped — ${r.error ?? "nothing to seed"}`);
      return;
    }
    const verb = r.status === "already-seeded" ? "already seeded" : "seeded";
    console.log(`  ${colors.green(icons.ok)} ${verb} (version ${r.version}) [${r.env}]`);
    if (r.workspaces?.length) {
      console.log(colors.dim(`  schemas ensured: ${r.workspaces.join(", ")}`));
    }
    if (r.owner) {
      console.log(
        `  ${colors.green(icons.ok)} owner admin (${r.owner.mode}) → ${r.owner.accountId}`,
      );
    }
    for (const step of r.steps ?? []) {
      console.log(`  ${colors.green(icons.ok)} step ${step.step}`);
    }
    if (r.status === "already-seeded") {
      console.log(colors.dim("  bump seed.version (or pass --force) to re-run"));
    }
    console.log();
  },
};
