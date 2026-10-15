import { execa } from "execa";
import type { CustodyWalletRecord } from "./auth-session";

export interface OutlayerCliResult {
  status: "linked" | "cli-missing" | "error";
  network: "mainnet" | "testnet";
  detail?: string;
}

export async function loginOutlayerCli(
  custodyWallet: CustodyWalletRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OutlayerCliResult> {
  try {
    await execa("outlayer", ["--version"], { env, stdio: "pipe" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "cli-missing", network: custodyWallet.network };
    }
    return {
      status: "error",
      network: custodyWallet.network,
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }

  const args =
    custodyWallet.network === "testnet"
      ? ["login", "testnet", "--wallet-key", custodyWallet.apiKey]
      : ["login", "--wallet-key", custodyWallet.apiKey];
  const login = await execa("outlayer", args, { env, stdio: "pipe", reject: false });
  if (login.failed) {
    return {
      status: "error",
      network: custodyWallet.network,
      detail:
        [login.stderr, login.stdout].filter(Boolean).join("\n").trim() ||
        "OutLayer CLI login failed",
    };
  }

  const whoami = await execa("outlayer", ["whoami"], { env, stdio: "pipe" }).catch(() => null);
  return {
    status: "linked",
    network: custodyWallet.network,
    detail: whoami?.stdout.trim(),
  };
}
