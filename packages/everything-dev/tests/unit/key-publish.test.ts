import { Context } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerKeys } from "../../src/commands/keys";
import type { BosBuilder, BosDeps } from "../../src/commands/shared";
import { BosDepsTag } from "../../src/commands/shared";
import { ResolutionSession } from "../../src/resolution/session";
import type { BosConfig, RuntimeConfig } from "../../src/types";

const mocks = vi.hoisted(() => ({
  listPublishKeys: vi.fn(),
  addFunctionCallAccessKey: vi.fn(),
  deleteAccessKeys: vi.fn(),
}));

vi.mock("../../src/near-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-cli")>();
  const { Effect } = await import("effect");
  return {
    ...actual,
    ensureNearCli: Effect.succeed(undefined) as typeof actual.ensureNearCli,
    listPublishKeys: mocks.listPublishKeys,
    addFunctionCallAccessKey: mocks.addFunctionCallAccessKey,
    deleteAccessKeys: mocks.deleteAccessKeys,
  };
});

const session = ResolutionSession.fromParts({
  config: { account: "test.near" } as BosConfig,
  runtime: {} as RuntimeConfig,
  root: "/fixture-root",
});

const deps: BosDeps = {
  session,
  databaseBindings: undefined as never,
  drizzleKit: undefined as never,
};

function getKeyPublishHandler() {
  const records = new Map<string, unknown>();
  const builder = new Proxy(
    {},
    {
      get: (_target, prop) => ({
        handler: (handler: unknown) => {
          records.set(prop as string, handler);
          return { route: prop, handler };
        },
      }),
    },
  ) as BosBuilder;
  registerKeys(builder);
  return records.get("keyPublish") as (args: unknown) => Promise<any>;
}

const context = { "effect/context": Context.make(BosDepsTag, deps) };

const OLD_KEYS = ["ed25519:oldkey1", "ed25519:oldkey2"];

describe("keyPublish handler removeOldKeys branches", () => {
  beforeEach(() => {
    mocks.listPublishKeys.mockReset();
    mocks.addFunctionCallAccessKey.mockReset();
    mocks.deleteAccessKeys.mockReset();
  });

  it("removes old keys when removeOldKeys is true", async () => {
    mocks.listPublishKeys.mockResolvedValue(OLD_KEYS);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    mocks.deleteAccessKeys.mockResolvedValue(undefined);
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production", removeOldKeys: true },
      context,
    });

    expect(mocks.deleteAccessKeys).toHaveBeenCalledWith("test.near", OLD_KEYS, "mainnet");
    expect(result.status).toBe("published");
    expect(result.publicKey).toBe("ed25519:newpub");
    expect(result.privateKey).toBe("ed25519:newpriv");
  });

  it("retains old keys when removeOldKeys is false", async () => {
    mocks.listPublishKeys.mockResolvedValue(OLD_KEYS);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production", removeOldKeys: false },
      context,
    });

    expect(mocks.deleteAccessKeys).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });

  it("defaults to removing old keys when removeOldKeys is unset (old readline default)", async () => {
    mocks.listPublishKeys.mockResolvedValue(OLD_KEYS);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    mocks.deleteAccessKeys.mockResolvedValue(undefined);
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production" },
      context,
    });

    expect(mocks.deleteAccessKeys).toHaveBeenCalledWith("test.near", OLD_KEYS, "mainnet");
    expect(result.status).toBe("published");
  });

  it("still publishes the new key when removing old keys fails", async () => {
    mocks.listPublishKeys.mockResolvedValue(OLD_KEYS);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    mocks.deleteAccessKeys.mockRejectedValue(new Error("rpc down"));
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production", removeOldKeys: true },
      context,
    });

    expect(result.status).toBe("published");
    expect(result.publicKey).toBe("ed25519:newpub");
  });

  it("never touches deleteAccessKeys when there are no old keys", async () => {
    mocks.listPublishKeys.mockResolvedValue([]);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production", removeOldKeys: true },
      context,
    });

    expect(mocks.deleteAccessKeys).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });
});
