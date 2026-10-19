import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerKeys } from "../../src/handlers/keys";
import type { BosBuilder } from "../../src/handlers/shared";
import { ResolutionSession, ResolutionSessionService } from "../../src/services/resolution/session";
import type { BosConfig, RuntimeConfig } from "../../src/types";

const mocks = vi.hoisted(() => ({
  listPublishKeys: vi.fn(),
  addFunctionCallAccessKey: vi.fn(),
  deleteAccessKeys: vi.fn(),
}));

vi.mock("../../src/services/auth/near-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/auth/near-cli")>();
  const { Effect } = await import("effect");
  return {
    ...actual,
    ensureNearCli: Effect.void as typeof actual.ensureNearCli,
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

function getKeyPublishHandler() {
  const callables = new Map<string, unknown>();
  const builder = new Proxy(
    {},
    {
      get: (_target, prop) => ({
        handler: (handler: unknown) => {
          callables.set(prop as string, handler);
          return { route: prop, handler };
        },
        // Mirrors @orpc/experimental-effect's handlerGen: run the generator,
        // then provide the plugin services from the ambient layers.
        effect: (fn: (opts: unknown, input: unknown) => Generator) => {
          const callable = (opts: unknown, input: unknown) =>
            Effect.gen(() => fn(opts, input)).pipe(
              Effect.provideService(ResolutionSessionService, session),
            );
          callables.set(prop as string, callable);
          return callable;
        },
      }),
    },
  ) as BosBuilder;
  registerKeys(builder);
  const handler = callables.get("keyPublish") as unknown as (
    opts: unknown,
    input: unknown,
  ) => Effect.Effect<unknown, unknown, never>;
  return (args: { input: unknown; context: unknown }) =>
    Effect.runPromise(handler(args, args.input)) as Promise<any>;
}

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
    });

    expect(mocks.deleteAccessKeys).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });

  it("defaults to keeping old keys when removeOldKeys is unset (#247)", async () => {
    mocks.listPublishKeys.mockResolvedValue(OLD_KEYS);
    mocks.addFunctionCallAccessKey.mockResolvedValue({
      publicKey: "ed25519:newpub",
      privateKey: "ed25519:newpriv",
    });
    mocks.deleteAccessKeys.mockResolvedValue(undefined);
    const handler = getKeyPublishHandler();

    const result = await handler({
      input: { allowance: "1NEAR", env: "production" },
    });

    expect(mocks.deleteAccessKeys).not.toHaveBeenCalled();
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
    });

    expect(mocks.deleteAccessKeys).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });
});
