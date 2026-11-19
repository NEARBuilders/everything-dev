import { colors, icons } from "../../utils/theme";
import type { ResultRenderer } from "./context";

export const lifecycleRenderers: Record<string, ResultRenderer> = {
  login: async (result, _ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Logged in to ${result.siteUrl}`));
    if (result.accountId) console.log(`  ${colors.dim("account:")} ${result.accountId}`);
    if (result.expiresAt) console.log(`  ${colors.dim("expires:")} ${result.expiresAt}`);
    for (const warning of result.warnings ?? []) {
      console.log(`  ${colors.yellow("⚠")} ${warning}`);
    }
    if (result.deployKey) {
      console.log(
        `  ${colors.dim("deploy key:")} ${result.deployKey.account}/${result.deployKey.gateway} scope ${colors.dim("(also stored in .bos/session.json)")}`,
      );
      if (!process.stdout.isTTY) {
        process.stderr.write(
          `  ⚠ Non-interactive stdout: this API key will be captured in any log or pipe (GitHub Actions logs persist stdout).\n`,
        );
      }
      process.stdout.write(`  For CI (no browser), export it as BOS_STORAGE_API_KEY:\n`);
      process.stdout.write(`BOS_STORAGE_API_KEY=${result.deployKey.key}\n`);
    }
    if (result.publishKey) {
      console.log(
        `  ${colors.dim("publish key:")} ${result.publishKey.publicKey} ${colors.dim(
          `(${result.publishKey.network}, exported to ${result.publishKey.exportedTo})`,
        )}`,
      );
    }
    if (result.custodyWallet) {
      console.log(
        `  ${colors.dim("custody wallet:")} ${result.custodyWallet.nearAccountId} ${colors.dim(
          `(${result.custodyWallet.network})`,
        )}`,
      );
      if (result.custodyWallet.handoffUrl) {
        console.log(`  ${colors.dim("policy & funding:")} ${result.custodyWallet.handoffUrl}`);
      }
    }
    if (result.outlayerCli?.status === "linked") {
      console.log(
        `  ${colors.dim("OutLayer CLI:")} logged in on ${result.outlayerCli.network}${result.outlayerCli.detail ? ` — ${result.outlayerCli.detail.split("\n")[0]}` : ""}`,
      );
    } else if (result.outlayerCli?.status === "cli-missing") {
      console.log(
        colors.dim(
          "  OutLayer CLI not installed — cargo install outlayer-cli, then re-run `bos login --custody` to link it.",
        ),
      );
    }
    console.log();
    return;
  },

  logout: async (result, _ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Logged out`));
    if (result.revokedApiKey) console.log(`  ${colors.dim("revoked the API key")}`);
    if (result.removedPublishKey)
      console.log(`  ${colors.dim("removed the exported publish key")}`);
    for (const warning of result.warnings ?? []) {
      console.log(`  ${colors.yellow("⚠")} ${warning}`);
    }
    console.log();
    return;
  },
};
