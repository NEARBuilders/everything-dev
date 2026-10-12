import { createPluginRuntime } from "every-plugin";
import { defaultMissingSecretWarnings } from "../../src/runtime/errors";
import { WarningsPlugin } from "../fixtures/warnings-plugin/src/index";

const REGISTRY = {
  "warnings-plugin": {
    module: WarningsPlugin,
  },
} as const;

describe("defaultMissingSecretWarnings", () => {
  it("returns one consolidated warning for missing declared secrets", () => {
    const warnings = defaultMissingSecretWarnings(
      "auth",
      ["GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
      ["GOOGLE_CLIENT_SECRET"],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].pluginKey).toBe("auth");
    expect(warnings[0].message).toContain("GITHUB_CLIENT_SECRET");
    expect(warnings[0].message).not.toContain("GOOGLE_CLIENT_SECRET");
  });

  it("excludes *_DATABASE_URL keys (fallback, or a real failure not a warning)", () => {
    const warnings = defaultMissingSecretWarnings(
      "template",
      ["TEMPLATE_DATABASE_URL", "TEMPLATE_API_KEY"],
      [],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("TEMPLATE_API_KEY");
    expect(warnings[0].message).not.toContain("TEMPLATE_DATABASE_URL");
  });

  it("returns nothing when all declared secrets resolved", () => {
    const warnings = defaultMissingSecretWarnings(
      "auth",
      ["GITHUB_CLIENT_SECRET"],
      ["GITHUB_CLIENT_SECRET"],
    );

    expect(warnings).toEqual([]);
  });
});

describe("plugin warnings channel", () => {
  const runtime = createPluginRuntime({ registry: REGISTRY, secrets: {} });

  afterAll(async () => {
    await runtime.shutdown();
  });

  it("normalizes string warnings with the registry key", async () => {
    const result = await runtime.usePlugin("warnings-plugin", {
      variables: { provider: "string" },
      secrets: {},
    });

    expect(result.initialized.warnings).toEqual([
      { pluginKey: "warnings-plugin", message: "OPTIONAL_TOKEN is not set" },
    ]);
  });

  it("passes structured warnings through", async () => {
    const result = await runtime.usePlugin("warnings-plugin", {
      variables: { provider: "structured" },
      secrets: {},
    });

    expect(result.initialized.warnings).toEqual([
      { pluginKey: "ignored", message: "structured message", hint: "do a thing" },
    ]);
  });

  it("returns no warnings when the plugin is fully configured", async () => {
    const result = await runtime.usePlugin("warnings-plugin", {
      variables: { provider: "string" },
      secrets: { OPTIONAL_TOKEN: "token" },
    });

    expect(result.initialized.warnings).toEqual([]);
  });

  it("fails safe when the warnings function throws", async () => {
    const result = await runtime.usePlugin("warnings-plugin", {
      variables: { provider: "throw" },
      secrets: {},
    });

    expect(result.initialized.warnings).toHaveLength(1);
    expect(result.initialized.warnings[0].pluginKey).toBe("warnings-plugin");
    expect(result.initialized.warnings[0].message).toContain("boom");
  });
});
