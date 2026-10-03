import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import { ensureNearCli, executeKeychainTransaction } from "../../src/near-cli";

const KEYCHAIN_ARGS = {
  account: "v1.citynode.near",
  contract: "dev.everything.near",
  method: "__fastdata_kv",
  args: { "apps/v1.citynode.near/citynode.app/bos.config.json": '{"account":"v1.citynode.near"}' },
  network: "mainnet" as const,
};

function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
}

describe("near-cli", () => {
  const originalTty = process.stdin.isTTY;

  afterEach(() => {
    execaMock.mockReset();
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalTty,
    });
    vi.restoreAllMocks();
  });

  it("prints manual install guidance when NEAR CLI is missing", async () => {
    execaMock.mockRejectedValueOnce(new Error("near not found"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as never);

    await expect(Effect.runPromise(ensureNearCli)).rejects.toThrow("NEAR CLI not found");

    expect(execaMock).toHaveBeenCalledWith("near", ["--version"], { stdio: "pipe" });
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "To install manually: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.23.5/near-cli-rs-installer.sh | sh",
    );
  });

  it("submits with sign-with-keychain and returns the transaction hash", async () => {
    setTty(true);
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "Transaction ID: ABC123",
      stderr: "",
    });

    const result = await executeKeychainTransaction(KEYCHAIN_ARGS);

    expect(result).toEqual({ success: true, txHash: "ABC123" });
    const [cmd, args] = vi.mocked(execaMock).mock.calls[0]!;
    expect(cmd).toBe("near");
    expect(args).toContain("sign-with-keychain");
    const argsBase64 = (args as string[])[(args as string[]).indexOf("base64-args") + 1]!;
    expect(Buffer.from(argsBase64, "base64").toString("utf-8")).toBe(
      JSON.stringify(KEYCHAIN_ARGS.args),
    );
  });

  it("tolerates CodeDoesNotExist execution failures — the registry is action-indexed", async () => {
    setTty(true);
    execaMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr:
        'Smart contract panicked: {"CompilationError":{"CodeDoesNotExist":{"account_id":"dev.everything.near"}}}',
    });

    const result = await executeKeychainTransaction(KEYCHAIN_ARGS);

    expect(result).toEqual({ success: true, txHash: undefined });
  });

  it("throws combined output on real failures", async () => {
    setTty(true);
    execaMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "Access key exhausted",
    });

    await expect(executeKeychainTransaction(KEYCHAIN_ARGS)).rejects.toThrow(/Access key exhausted/);
  });

  it("refuses to run without a TTY", async () => {
    setTty(false);

    await expect(executeKeychainTransaction(KEYCHAIN_ARGS)).rejects.toThrow(
      /No TTY available for keychain signing/,
    );
    expect(execaMock).not.toHaveBeenCalled();
  });
});
