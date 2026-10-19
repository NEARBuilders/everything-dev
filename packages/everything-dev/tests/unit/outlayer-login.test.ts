import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginOutlayerCli } from "../../src/services/auth/outlayer";
import type { CustodyWalletRecord } from "../../src/services/auth/session";

const FAKE_CLI = `#!/bin/sh
printf '%s\\n' "$*" >> "$RECORD_LOG"
case "$1" in
  --version) echo "outlayer 0.1.2"; exit 0 ;;
  whoami) echo "Account: 7f024c.testnet"; echo "Auth: wallet_key"; exit 0 ;;
  login)
    if [ -n "$FAKE_LOGIN_FAIL" ]; then
      echo "coordinator refused" >&2
      exit 1
    fi
    exit 0 ;;
esac
exit 0
`;

const wallet = (network: "mainnet" | "testnet"): CustodyWalletRecord => ({
  apiKey: "wk_test",
  walletId: "wallet-1",
  nearAccountId: "7f024c0b41f284a7959f1b6fbb7370cce8d42b99ace10664499c674aad870391",
  network,
  handoffUrl: null,
  registeredAt: new Date().toISOString(),
});

describe("loginOutlayerCli", () => {
  let binDir: string;
  let recordLog: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "outlayer-cli-"));
    recordLog = join(binDir, "argv.log");
    writeFileSync(join(binDir, "outlayer"), FAKE_CLI);
    chmodSync(join(binDir, "outlayer"), 0o755);
    env = { ...process.env, PATH: binDir, RECORD_LOG: recordLog, FAKE_LOGIN_FAIL: "" };
  });

  afterEach(() => {
    delete process.env.RECORD_LOG;
    delete process.env.FAKE_LOGIN_FAIL;
  });

  const recordedInvocations = (): string[] => readFileSync(recordLog, "utf-8").trim().split("\n");

  it("links a testnet wallet — network arg passed, key forwarded, whoami echoed", async () => {
    const result = await loginOutlayerCli(wallet("testnet"), env);
    expect(result.status).toBe("linked");
    expect(result.network).toBe("testnet");
    expect(result.detail).toContain("Auth: wallet_key");
    expect(recordedInvocations()).toEqual([
      "--version",
      "login testnet --wallet-key wk_test",
      "whoami",
    ]);
  });

  it("omits the network arg on mainnet", async () => {
    const result = await loginOutlayerCli(wallet("mainnet"), env);
    expect(result.status).toBe("linked");
    expect(result.network).toBe("mainnet");
    expect(recordedInvocations()).toEqual(["--version", "login --wallet-key wk_test", "whoami"]);
  });

  it("reports a missing CLI quietly", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "outlayer-empty-"));
    const result = await loginOutlayerCli(wallet("mainnet"), { ...env, PATH: emptyDir });
    expect(result.status).toBe("cli-missing");
    expect(result.detail).toBeUndefined();
  });

  it("maps a login failure to an error with the CLI's stderr", async () => {
    const result = await loginOutlayerCli(wallet("mainnet"), { ...env, FAKE_LOGIN_FAIL: "1" });
    expect(result.status).toBe("error");
    expect(result.detail).toContain("coordinator refused");
  });
});
