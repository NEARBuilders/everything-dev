import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../src/services/config";
import { buildAuthBaseVariables } from "../../src/services/plugins";

function config(input: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    domain: "test.app",
    networkId: "mainnet",
    ...input,
  } as RuntimeConfig;
}

/** Runs the build with an explicit env provider — hermetic against the
 * runner's ambient environment (vitest sets BASE_URL="/" as its Vite base;
 * Effect's default provider snapshots process.env once). */
function build(
  input: Partial<RuntimeConfig>,
  corsOrigins: string[] = [],
  env: Record<string, string> = {},
) {
  return Effect.runPromise(
    buildAuthBaseVariables(config(input), corsOrigins).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
    ),
  );
}

describe("buildAuthBaseVariables", () => {
  it("derives baseUrl from the bos config host url in development", async () => {
    const variables = await build(
      {
        env: "development",
        host: { name: "host", url: "http://localhost:4100", entry: "", source: "local" },
      },
      [],
      {},
    );

    expect(variables.baseUrl).toBe("http://localhost:4100");
    expect(variables.domain).toBe("http://localhost:4100");
  });

  it("passes an empty dev host url through — the plugin's parseTrustedOrigins owns the localhost:3000 fallback", async () => {
    const variables = await build(
      {
        env: "development",
        host: { name: "host", url: "", entry: "", source: "local" },
      },
      [],
      {},
    );

    expect(variables.baseUrl).toBe("");
  });

  it("uses the bos config domain as baseUrl in production (protocol-normalized)", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {});

    expect(variables.baseUrl).toBe("https://citynode.app");
  });

  it("keeps trustedOrigins from corsOrigins", async () => {
    const variables = await build(
      {
        env: "development",
        host: { name: "host", url: "http://localhost:4100", entry: "", source: "local" },
      },
      ["http://localhost:4100", "http://localhost:3000"],
      {},
    );

    expect(variables.trustedOrigins).toEqual(["http://localhost:4100", "http://localhost:3000"]);
  });

  it("BASE_URL env wins over the derived origin", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {
      BASE_URL: "http://localhost:4100",
    });

    expect(variables.baseUrl).toBe("http://localhost:4100");
  });

  it("BASE_URL env beats the authored config variable too", async () => {
    const variables = await build(
      {
        env: "production",
        domain: "citynode.app",
        auth: {
          name: "auth",
          url: "http://localhost:4102",
          entry: "",
          source: "remote",
          variables: { baseUrl: "https://authored.example.com" },
        },
      } as Partial<RuntimeConfig>,
      [],
      { BASE_URL: "http://localhost:4100" },
    );

    expect(variables.baseUrl).toBe("http://localhost:4100");
  });

  it("an authored variables.baseUrl wins over the derivation when no env is set", async () => {
    const variables = await build(
      {
        env: "production",
        domain: "citynode.app",
        auth: {
          name: "auth",
          url: "http://localhost:4102",
          entry: "",
          source: "remote",
          variables: { baseUrl: "https://authored.example.com" },
        },
      } as Partial<RuntimeConfig>,
      [],
      {},
    );

    expect(variables.baseUrl).toBe("https://authored.example.com");
  });

  it("ignores a blank BASE_URL env", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {
      BASE_URL: "   ",
    });

    expect(variables.baseUrl).toBe("https://citynode.app");
  });

  it("ignores a non-origin BASE_URL — vitest sets '/' as its Vite base", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {
      BASE_URL: "/",
    });

    expect(variables.baseUrl).toBe("https://citynode.app");
  });

  it("ignores a BASE_URL missing the scheme (operator typo)", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {
      BASE_URL: "citynode.app",
    });

    expect(variables.baseUrl).toBe("https://citynode.app");
  });

  it("normalizes a trailing slash in the env override", async () => {
    const variables = await build({ env: "production", domain: "citynode.app" }, [], {
      BASE_URL: "http://localhost:4100/",
    });

    expect(variables.baseUrl).toBe("http://localhost:4100");
  });
});
