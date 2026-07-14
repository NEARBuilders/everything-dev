import { EventEmitter } from "node:events";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

type DeferredProc = Promise<{ exitCode: number; stdout?: string; stderr?: string }> & {
  stdout?: EventEmitter;
  stderr?: EventEmitter;
};

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import { ensureNearCli, executeTransaction, resolveNearSigningMode } from "../../src/near-cli";

function createDeferredProc(withStreams = true) {
  let resolve!: (value: { exitCode: number; stdout?: string; stderr?: string }) => void;
  const proc = new Promise<{ exitCode: number; stdout?: string; stderr?: string }>(
    (promiseResolve) => {
      resolve = promiseResolve;
    },
  ) as DeferredProc;

  if (withStreams) {
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
  }

  return { proc, resolve };
}

describe("near-cli", () => {
  afterEach(() => {
    execaMock.mockReset();
    vi.restoreAllMocks();
  });

  it("warns once when resolving interactive keychain mode", () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined as never);

    try {
      expect(resolveNearSigningMode()).toEqual({ _tag: "interactiveKeychain" });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "No NEAR_PRIVATE_KEY set — falling back to interactive keychain signing.",
        ),
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY,
      });
    }
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

  it("pipes stdout and stderr in interactive mode", async () => {
    const { proc, resolve } = createDeferredProc(false);
    execaMock.mockReturnValueOnce(proc);

    const promise = Effect.runPromise(
      executeTransaction(
        {
          account: "dev.everything.near",
          contract: "dev.everything.near",
          method: "__fastdata_kv",
          argsBase64: "e30=",
          network: "mainnet",
        },
        { _tag: "interactiveKeychain" },
      ),
    );

    await Promise.resolve();

    expect(execaMock).toHaveBeenCalledWith(
      "near",
      expect.arrayContaining(["sign-with-keychain", "send"]),
      expect.objectContaining({
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
        reject: false,
        timeout: 300000,
      }),
    );

    resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    await expect(promise).resolves.toEqual({ success: true, txHash: undefined, output: undefined });
  });

  it("parses tx hash from the final captured output in private-key mode", async () => {
    const { proc, resolve } = createDeferredProc();
    execaMock.mockReturnValueOnce(proc);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true as never);

    const promise = Effect.runPromise(
      executeTransaction(
        {
          account: "dev.everything.near",
          contract: "dev.everything.near",
          method: "__fastdata_kv",
          argsBase64: "e30=",
          network: "mainnet",
          privateKey: "ed25519:test",
          verbose: true,
        },
        { _tag: "privateKey", privateKey: "ed25519:test" },
      ),
    );

    await Promise.resolve();

    proc.stdout?.emit("data", Buffer.from("Publishing to https://kv...\n"));
    proc.stderr?.emit("data", Buffer.from("Transaction ID: ABC123\n"));

    expect(stdoutSpy).toHaveBeenCalledWith(Buffer.from("Publishing to https://kv...\n"));
    expect(stderrSpy).toHaveBeenCalledWith(Buffer.from("Transaction ID: ABC123\n"));

    resolve({
      exitCode: 0,
      stdout: "Publishing to https://kv...\nTransaction ID: ABC123",
      stderr: "Transaction complete",
    });

    await expect(promise).resolves.toEqual({
      success: true,
      txHash: "ABC123",
      output: "Publishing to https://kv...\nTransaction ID: ABC123\nTransaction complete",
    });
  });

  it("throws combined output when NEAR exits non-zero", async () => {
    const { proc, resolve } = createDeferredProc();
    execaMock.mockReturnValueOnce(proc);

    const promise = Effect.runPromise(
      executeTransaction(
        {
          account: "dev.everything.near",
          contract: "dev.everything.near",
          method: "__fastdata_kv",
          argsBase64: "e30=",
          network: "mainnet",
          privateKey: "ed25519:test",
        },
        { _tag: "privateKey", privateKey: "ed25519:test" },
      ),
    );

    await Promise.resolve();

    resolve({
      exitCode: 1,
      stdout: "Transaction ID: ABC123",
      stderr: "Transaction failed",
    });

    await expect(promise).rejects.toThrow(/Transaction ID: ABC123/);
    await expect(promise).rejects.toThrow(/Transaction failed/);
  });

  it("fails before spawning near when no tty is available", () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      expect(() => resolveNearSigningMode()).toThrow(/no TTY available for keychain signing/i);
      expect(execaMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY,
      });
    }
  });
});
