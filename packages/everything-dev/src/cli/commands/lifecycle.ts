import { dirname } from "node:path";
import * as p from "@clack/prompts";
import { readAuthoredConfigInput } from "../../config";
import type { KeyPublishOptions } from "../../contract";
import { listPublishKeys } from "../../services/auth/near-cli";
import { getRegistryNamespaceForAccount } from "../../services/registry/fastkv";
import { getNetworkIdForAccount } from "../../utils/network";
import { colors, frames, gradients, icons } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import type { CommandContext, ResultRenderer } from "./context";

export const keyPublishPreCall = async (ctx: CommandContext): Promise<void> => {
  const input = ctx.input;
  const configPath = ctx.configPath;
  const keyPublishInput = input as KeyPublishOptions;
  if (keyPublishInput.removeOldKeys === undefined) {
    if (process.stdin.isTTY) {
      const authored = configPath ? await readAuthoredConfigInput(dirname(configPath)) : null;
      const account =
        keyPublishInput.env === "staging"
          ? (authored?.staging?.account ?? authored?.account)
          : authored?.account;
      let listed: string[] | null = null;
      if (account) {
        const network = getNetworkIdForAccount(account);
        const contract = getRegistryNamespaceForAccount(account, keyPublishInput.registry);
        try {
          listed = await listPublishKeys({ account, contract, network });
        } catch {
          listed = null;
        }
      }
      if (listed?.length) {
        const removeOldKeys = await p.confirm({
          message: `Remove ${listed.length} existing publish key${listed.length > 1 ? "s" : ""}?`,
          initialValue: false,
        });
        if (p.isCancel(removeOldKeys)) {
          return;
        }
        keyPublishInput.removeOldKeys = removeOldKeys;
      } else if (listed !== null) {
        keyPublishInput.removeOldKeys = false;
      } else {
        keyPublishInput.removeOldKeys = false;
      }
    } else {
      keyPublishInput.removeOldKeys = false;
    }
  }
};

export const lifecycleRenderers: Record<string, ResultRenderer> = {
  login: async (result, ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Logged in to ${result.siteUrl}`));
    if (result.accountId) console.log(`  ${colors.dim("Account:")} ${result.accountId}`);
    if (result.expiresAt) console.log(`  ${colors.dim("Expires:")} ${result.expiresAt}`);
    if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
    if (result.deployKey) {
      console.log(
        `  ${colors.dim("Deploy key:")} ${result.deployKey.account}/${result.deployKey.gateway} scope${result.publishKey ? "" : colors.dim(" — upload credentials for deploys")}`,
      );
      if (!process.stdout.isTTY) {
        process.stderr.write(
          `  ⚠ Non-interactive stdout: this API key will be captured in any log or pipe (GitHub Actions logs persist stdout).\n`,
        );
      }
      process.stdout.write(
        `  Set this as BOS_STORAGE_API_KEY in GitHub Actions or before calling deploy:\n`,
      );
      process.stdout.write(`BOS_STORAGE_API_KEY=${result.deployKey.key}\n`);
    }
    if (result.publishKey) {
      console.log(
        `  ${colors.dim("Publish key:")} ${result.publishKey.publicKey} ${colors.dim(
          `(${result.publishKey.network}, exported to ${result.publishKey.exportedTo})`,
        )}`,
      );
    }
    if (result.custodyWallet) {
      console.log(
        `  ${colors.dim("Custody wallet:")} ${result.custodyWallet.nearAccountId} ${colors.dim(
          `(${result.custodyWallet.network})`,
        )}`,
      );
      if (result.custodyWallet.handoffUrl) {
        console.log(`  ${colors.dim("Policy & funding:")} ${result.custodyWallet.handoffUrl}`);
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

  logout: async (result, ctx) => {
    console.log();
    console.log(colors.green(`${icons.ok} Logged out`));
    if (result.revokedApiKey) console.log(`  ${colors.dim("Revoked API key")}`);
    if (result.removedPublishKey) console.log(`  ${colors.dim("Removed exported publish key")}`);
    if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
    console.log();
    return;
  },

  keyPublish: async (result, ctx) => {
    process.stdout.write(`Generated publish key for ${result.account}\n`);
    process.stdout.write(`  Network: ${result.network}\n`);
    process.stdout.write(`  Allowance: ${result.allowance}\n`);
    process.stdout.write(`\n`);
    const secretName = result.env === "staging" ? "NEAR_TESTNET_PRIVATE_KEY" : "NEAR_PRIVATE_KEY";
    if (!process.stdout.isTTY) {
      process.stderr.write(
        `  ⚠ Non-interactive stdout: this private key will be captured in any log or pipe (GitHub Actions logs persist stdout).\n`,
      );
    }
    process.stdout.write(
      `  Set this as ${secretName} in GitHub Actions or before calling publish:\n`,
    );
    process.stdout.write(`${secretName}=${result.privateKey}\n`);
  },
};
