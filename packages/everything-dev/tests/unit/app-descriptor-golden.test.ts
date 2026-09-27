import { describe, expect, it } from "vitest";
import everythingDevApp from "../../../../bos.app";
import { App, Plugin } from "../../src/descriptor/constructors";
import { resolveApp } from "../../src/descriptor/resolve";

const PIPELINE_FIELDS = ["production", "integrity", "ssr", "ssrIntegrity"] as const;

function stripPipeline(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPipeline);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (!PIPELINE_FIELDS.includes(key as (typeof PIPELINE_FIELDS)[number])) {
        out[key] = stripPipeline(val);
      }
    }
    return out;
  }
  return value;
}

/**
 * Canonicalize a hand-maintained config into the generator's form:
 * pipeline-owned state (deploy-written URLs + SRI) is stripped everywhere.
 */
function canonicalize(value: unknown): unknown {
  return stripPipeline(value);
}

function exampleChildApp() {
  return App({
    name: "example.app",
    extends: everythingDevApp,
    account: "child.example",
    domain: "child.example",
    title: "Example",
    auth: Plugin("auth").path("plugins/auth", {
      name: "@everything-dev/auth-plugin",
      secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
      variables: {
        siwn: {
          recipients: { mainnet: "child.example", testnet: "child.testnet" },
          relayer: {
            mainnet: {
              whitelistedContracts: ["child.example"],
              maxGasPerTransaction: "400000000000000",
              maxDepositPerTransaction: "0",
            },
            testnet: {
              whitelistedContracts: ["child.testnet"],
              maxGasPerTransaction: "400000000000000",
              maxDepositPerTransaction: "0",
            },
          },
          sessionGasKey: {
            mainnet: { receiverId: "child.example", methodNames: ["__fastdata_kv"] },
            testnet: { receiverId: "child.testnet", methodNames: ["__fastdata_kv"] },
          },
        },
      },
    }),
  });
}

describe("descriptor golden fixture — bos.app.ts ↔ bos.config.json", () => {
  it("the everything.dev base resolves to local-ref composition", () => {
    const resolved = resolveApp("everything.dev", { "everything.dev": everythingDevApp });
    expect(resolved.account).toBe("dev.everything.near");
    expect(resolved.domain).toBe("everything.dev");
    expect(resolved.app?.host).toEqual({ development: "local:host" });
    expect(resolved.app?.auth).toMatchObject({
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
    });
    expect(resolved.extends).toBeUndefined();
  });

  it("a child runtime flattens with its extends lineage and siwn variables", () => {
    const resolved = resolveApp("example.app", { "example.app": exampleChildApp() });
    expect(resolved.account).toBe("child.example");
    expect(resolved.domain).toBe("child.example");
    expect(canonicalize(resolved.app?.auth?.variables?.siwn)).toEqual({
      recipients: { mainnet: "child.example", testnet: "child.testnet" },
      relayer: {
        mainnet: {
          whitelistedContracts: ["child.example"],
          maxGasPerTransaction: "400000000000000",
          maxDepositPerTransaction: "0",
        },
        testnet: {
          whitelistedContracts: ["child.testnet"],
          maxGasPerTransaction: "400000000000000",
          maxDepositPerTransaction: "0",
        },
      },
      sessionGasKey: {
        mainnet: { receiverId: "child.example", methodNames: ["__fastdata_kv"] },
        testnet: { receiverId: "child.testnet", methodNames: ["__fastdata_kv"] },
      },
    });
  });

  it("the child inherits base slots it does not override", () => {
    const child = exampleChildApp();
    delete (child as Record<string, unknown>).plugins;
    const resolved = resolveApp("example.app", { "example.app": child });
    expect(resolved.plugins?.apps).toMatchObject({ development: "local:plugins/apps" });
  });
});
