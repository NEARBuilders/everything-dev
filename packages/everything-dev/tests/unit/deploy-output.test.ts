import { afterEach, describe, expect, it } from "vitest";
import { resolveNearReadRpcUrl } from "../../src/services/auth/near-signer";
import { formatElapsed, nearblocksUrl } from "../../src/services/deploy/output";

const READ_RPC_ENV = "NEAR_READ_RPC_URL";

afterEach(() => {
  delete process.env[READ_RPC_ENV];
});

describe("nearblocksUrl", () => {
  it("links mainnet transactions on nearblocks.io", () => {
    expect(nearblocksUrl("Ank9abc")).toBe("https://nearblocks.io/txns/Ank9abc");
  });

  it("links testnet transactions on the testnet host", () => {
    expect(nearblocksUrl("Ank9abc", "testnet")).toBe("https://testnet.nearblocks.io/txns/Ank9abc");
  });
});

describe("formatElapsed", () => {
  it("reports short waits in seconds", () => {
    expect(formatElapsed(29_400)).toBe("29s");
  });

  it("reports long waits in minutes and seconds", () => {
    expect(formatElapsed(92_000)).toBe("1m 32s");
  });
});

describe("resolveNearReadRpcUrl", () => {
  it("defaults reads to the FastNEAR free RPC on mainnet", () => {
    expect(resolveNearReadRpcUrl("mainnet")).toBe("https://free.rpc.fastnear.com");
  });

  it("keeps the official RPC for testnet reads", () => {
    expect(resolveNearReadRpcUrl("testnet")).toBe("https://rpc.testnet.near.org");
  });

  it("honors NEAR_READ_RPC_URL over the default", () => {
    process.env[READ_RPC_ENV] = "https://rpc.example.internal";
    expect(resolveNearReadRpcUrl("mainnet")).toBe("https://rpc.example.internal");
    expect(resolveNearReadRpcUrl("testnet")).toBe("https://rpc.example.internal");
  });
});
