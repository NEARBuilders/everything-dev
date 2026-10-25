import { describe, expect, it, vi } from "vitest";
import { siwnClient } from "./client.js";

const MOCK_RECIPIENT = "example.near";

const connectorInstances: Array<{
  registerWallet: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@hot-labs/near-connect", () => ({
  NearConnector: vi.fn().mockImplementation(function (this: unknown) {
    const instance = {
      registerWallet: vi
        .fn<{ id: string; name?: string }>()
        .mockRejectedValueOnce(new Error("wallet manifest init crashed"))
        .mockResolvedValue({}),
      connect: vi.fn(() => Promise.resolve({})),
      disconnect: vi.fn(() => Promise.resolve()),
      getConnectedWallet: vi.fn(() => Promise.resolve({ wallet: {}, accounts: [] })),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      wallet: vi.fn(() => Promise.resolve({})),
      switchNetwork: vi.fn(),
    };
    connectorInstances.push(instance);
    return instance;
  }),
}));

vi.mock("near-kit", () => ({
  Near: class MockNear {},
  fromNearConnect: vi.fn(() => ({})),
}));

describe("siwn client init", () => {
  it("logs a failing wallet registration with cause and still initializes the connector", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const failingManifest = { id: "failing-wallet", name: "Failing" };
      const workingManifest = { id: "passkey", name: "Passkey" };
      const plugin = siwnClient({
        recipient: MOCK_RECIPIENT,
        wallets: [failingManifest, workingManifest],
      } as never);
      const actions = plugin.getActions(vi.fn() as never, {} as never, undefined);

      await vi.waitFor(() => {
        expect(connectorInstances).toHaveLength(1);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('"Failing"'),
          expect.anything(),
        );
      });
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("Passkey"))).toBe(false);
      expect(actions).toBeDefined();
    } finally {
      errorSpy.mockRestore();
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
