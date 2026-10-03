import { describe, expect, it } from "vitest";
import { createAuthClient } from "../../src/ui/auth";

const runtimeConfig = {
  hostUrl: "https://host.test",
  networkId: "mainnet",
  auth: {
    variables: {
      siwn: {
        recipient: "app.near",
      },
    },
  },
} as never;

describe("createAuthClient", () => {
  it("creates a better-auth client from runtime config", () => {
    const client = createAuthClient({ runtimeConfig });
    expect(typeof client.getSession).toBe("function");
    expect(typeof client.near.relayHistory).toBe("function");
  });

  it("throws without auth runtime configuration", () => {
    expect(() => createAuthClient({ runtimeConfig: {} as never })).toThrow(
      "Missing auth runtime configuration",
    );
  });

  it("throws without a SIWN recipient", () => {
    expect(() =>
      createAuthClient({
        runtimeConfig: {
          hostUrl: "https://host.test",
          auth: { variables: { siwn: {} } },
        } as never,
      }),
    ).toThrow("Missing auth SIWN recipient");
  });

  it("picks the testnet recipient when networkId is testnet", () => {
    const client = createAuthClient({
      runtimeConfig: {
        hostUrl: "https://host.test",
        networkId: "testnet",
        auth: {
          variables: {
            siwn: {
              recipient: "app.near",
              recipients: { mainnet: "app.near", testnet: "app.testnet" },
            },
          },
        },
      } as never,
    });
    expect(typeof client.getSession).toBe("function");
  });
});
