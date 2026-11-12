import { createHash } from "node:crypto";
import {
  existsSync,
  writeFileSync as fsWriteFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let testDir: string;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function makeContractSource(key: string, filePath: string, importName?: string) {
  return { key, sourceFilePath: filePath, importName: importName ?? `${key}Contract` };
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  fsWriteFileSync(path, content, "utf-8");
}

describe("writeGeneratedFiles — auth types gen uses export type *", () => {
  it("uses `export type *` so new types added to auth-export flow through automatically", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-auth-test-"));

    const apiSrc = join(testDir, "api", "src");
    const uiLib = join(testDir, "ui", "src", "lib");
    const authDir = join(testDir, ".bos", "generated", "auth");
    const authSrc = join(testDir, "plugins", "auth", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    const authExportPath = join(authDir, "auth-export.d.ts");
    writeFile(
      authExportPath,
      `import type { InferInput, InferOutput } from "./contract";
export type Auth = { id: string };
export type { Auth as BaseAuth } from "better-auth";
export type AuthOrganization = NonNullable<InferOutput<"getFullOrganization">>;
export type AuthTeam = InferOutput<"listTeams">[number];
export type GetFullOrganizationInput = InferInput<"getFullOrganization">;
export type AuthServices = { auth: Auth; handler: (req: Request) => Promise<Response> };
`,
    );

    const authContractPath = join(authDir, "contract.d.ts");
    writeFile(
      authContractPath,
      `export type ContractType = Record<string, unknown>;
export type InferInput<T extends string> = Record<string, unknown>;
export type InferOutput<T extends string> = Record<string, unknown>;
`,
    );

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      ],
      pluginKeys: [],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      authExportPath,
      apiDependsOn: undefined,
    });

    const uiAuthTypes = readFileSync(join(uiLib, "auth-types.gen.ts"), "utf-8");

    expect(uiAuthTypes).toContain("export type * from");
    expect(uiAuthTypes).not.toContain("GetOrganizationInput");
    expect(uiAuthTypes).not.toContain("export type {\n  Auth,");
    expect(uiAuthTypes).toContain("AuthSessionUser");
    expect(uiAuthTypes).toContain("AuthPluginContext");
  });

  it("creates an auth export fallback when no authExportPath is provided", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-auth-test-"));

    const apiSrc = join(testDir, "api", "src");
    const authDir = join(testDir, ".bos", "generated", "auth");
    const authSrc = join(testDir, "plugins", "auth", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    writeFile(
      join(authDir, "contract.d.ts"),
      `export type ContractType = Record<string, unknown>;
export type InferOutput<T extends string> = Record<string, unknown>;
`,
    );

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      ],
      pluginKeys: [],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: undefined,
    });

    const uiAuthTypes = readFileSync(
      join(testDir, "ui", "src", "lib", "auth-types.gen.ts"),
      "utf-8",
    );

    expect(uiAuthTypes).toContain("export type * from");
    expect(uiAuthTypes).not.toContain("GetOrganizationInput");
    expect(readFileSync(join(authDir, "auth-export.d.ts"), "utf-8")).toContain(
      "AuthOrganizationContext",
    );
  });
});

describe("writeGeneratedFiles — apiDependsOn filtering", () => {
  it("includes all plugins + auth when apiDependsOn is not set", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const uiLib = join(testDir, "ui", "src", "lib");
    const apiLib = join(testDir, "api", "src", "lib");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    const resultPath = writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: undefined,
    });

    expect(resultPath).toBe(join(uiLib, "api-types.gen.ts"));

    const pluginsTypes = readFileSync(join(apiLib, "plugins-types.gen.ts"), "utf-8");
    expect(pluginsTypes).toContain("authContract");
    expect(pluginsTypes).toContain("pluginAContract");
    expect(pluginsTypes).toContain("pluginBContract");
  });

  it("filters plugins-types.gen.ts when apiDependsOn is set", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const apiLib = join(testDir, "api", "src", "lib");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: ["pluginA", "auth"],
    });

    const pluginsTypes = readFileSync(join(apiLib, "plugins-types.gen.ts"), "utf-8");
    expect(pluginsTypes).toContain("pluginAContract");
    expect(pluginsTypes).toContain("authContract");
    expect(pluginsTypes).not.toContain("pluginBContract");
  });

  it("generates per-plugin plugins-client.gen.ts from pluginDependsOn", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");
    const pluginBSrc = join(testDir, "plugins", "pluginB", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");
    mkdirSync(pluginASrc, { recursive: true });
    mkdirSync(pluginBSrc, { recursive: true });

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
        makeContractSource("pluginB", join(pluginBSrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA", "pluginB"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      apiDependsOn: ["pluginA", "pluginB"],
      pluginDependsOn: {
        pluginA: ["auth"],
        pluginB: ["pluginA"],
      },
      pluginLocalPaths: {
        pluginA: join(testDir, "plugins", "pluginA"),
        pluginB: join(testDir, "plugins", "pluginB"),
      },
    });

    const pluginAClientPath = join(pluginASrc, "lib", "plugins-client.gen.ts");
    expect(existsSync(pluginAClientPath)).toBe(true);
    const pluginAClient = readFileSync(pluginAClientPath, "utf-8");
    expect(pluginAClient).toContain("authContract");
    expect(pluginAClient).not.toContain("pluginBContract");

    const pluginBClientPath = join(pluginBSrc, "lib", "plugins-client.gen.ts");
    expect(existsSync(pluginBClientPath)).toBe(true);
    const pluginBClient = readFileSync(pluginBClientPath, "utf-8");
    expect(pluginBClient).toContain("pluginAContract");
    expect(pluginBClient).not.toContain("authContract");
  });

  it("generates plugins-client.gen.ts for a local auth plugin from authLocalPath", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const authSrc = join(testDir, "plugins", "auth", "src");
    const pluginASrc = join(testDir, "plugins", "pluginA", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");
    mkdirSync(authSrc, { recursive: true });
    mkdirSync(pluginASrc, { recursive: true });

    writeGeneratedFiles({
      configDir: testDir,
      sources: [
        makeContractSource("api", contractPath),
        makeContractSource("pluginA", join(pluginASrc, "contract.ts")),
      ],
      pluginKeys: ["pluginA"],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      pluginDependsOn: { pluginA: ["auth"] },
      pluginLocalPaths: { pluginA: join(testDir, "plugins", "pluginA") },
      authLocalPath: join(testDir, "plugins", "auth"),
      authDependsOn: ["pluginA"],
    });

    const authClientPath = join(authSrc, "lib", "plugins-client.gen.ts");
    expect(existsSync(authClientPath)).toBe(true);
    const authClient = readFileSync(authClientPath, "utf-8");
    expect(authClient).toContain('import type { PluginClientEntry } from "every-plugin";');
    expect(authClient).toContain("pluginAContract");
    expect(authClient).toContain("pluginA: PluginClientEntry<pluginAContract>");
    expect(authClient).not.toContain("type PluginClientEntry<");
  });

  it("generates an empty PluginsClient for a local auth plugin with no dependsOn", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-test-"));

    const apiSrc = join(testDir, "api", "src");
    const authSrc = join(testDir, "plugins", "auth", "src");

    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");
    mkdirSync(authSrc, { recursive: true });

    writeGeneratedFiles({
      configDir: testDir,
      sources: [makeContractSource("api", contractPath)],
      pluginKeys: [],
      authSource: makeContractSource("auth", join(authSrc, "contract.ts"), "authContract"),
      authLocalPath: join(testDir, "plugins", "auth"),
    });

    const authClientPath = join(authSrc, "lib", "plugins-client.gen.ts");
    expect(existsSync(authClientPath)).toBe(true);
    const authClient = readFileSync(authClientPath, "utf-8");
    expect(authClient).toContain("export type PluginsClient = Record<string, never>;");
  });
});

describe("writeGeneratedFiles — degraded auth resolution still writes auth-types targets", () => {
  it("overwrites a stale plugin auth-types.gen.ts with stub imports when auth failed to resolve", async () => {
    const { writeGeneratedFiles } = await import("../../src/services/codegen/api-contract");
    testDir = mkdtempSync(join(tmpdir(), "api-contract-degraded-"));

    const apiSrc = join(testDir, "api", "src");
    const templateLib = join(testDir, "plugins", "_template", "src", "lib");
    const contractPath = join(apiSrc, "contract.ts");
    writeFile(contractPath, "export type ContractType = { ping: string };");

    const staleContent = `export type * from "../../../auth/src/auth-export.ts";
import type { InferOutput } from "../../../auth/src/contract.d.ts";
`;
    writeFile(join(templateLib, "auth-types.gen.ts"), staleContent);

    writeGeneratedFiles({
      configDir: testDir,
      sources: [makeContractSource("api", contractPath)],
      pluginKeys: ["template"],
      authSource: null,
      authExportPath: null,
      apiDependsOn: undefined,
      pluginLocalPaths: { template: join(testDir, "plugins", "_template") },
    });

    const authDir = join(testDir, ".bos", "generated", "auth");
    expect(existsSync(join(authDir, "auth-export.d.ts"))).toBe(true);
    expect(existsSync(join(authDir, "contract.d.ts"))).toBe(true);

    const templateAuthTypes = readFileSync(join(templateLib, "auth-types.gen.ts"), "utf-8");
    expect(templateAuthTypes).not.toBe(staleContent);
    expect(templateAuthTypes).toContain(".bos/generated/auth/auth-export.d.ts");

    const uiAuthTypes = readFileSync(
      join(testDir, "ui", "src", "lib", "auth-types.gen.ts"),
      "utf-8",
    );
    expect(uiAuthTypes).toContain(".bos/generated/auth/auth-export.d.ts");
  });
});

describe("syncApiContractBridge — call-only plugin entries (#848)", () => {
  const CONTRACT_SOURCE =
    "export type ContractType = { getProjectBySlug(input: { slug: string }): { slug: string } };";
  // The production shape this feature exists for: the CONTRACT origin is the
  // stamped artifact CDN (serves plugin.manifest.json), the proxy origin is
  // the live app domain (serves /api/rpc) — different origins, two locators.
  const CONTRACT_ORIGIN =
    "https://cdn.everything.dev/bundles/nearbuilding.near/feedback.nearbuilders.org/api";
  const PROXY_ORIGIN = "https://feedback.nearbuilders.org";
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function serveContractAtContractOrigin({
    manifestSha,
    bodySha,
  }: {
    manifestSha?: string;
    bodySha?: string;
  } = {}) {
    const actualSha = createHash("sha256").update(CONTRACT_SOURCE).digest("hex");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${CONTRACT_ORIGIN}/plugin.manifest.json`) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            kind: "every-plugin/manifest",
            plugin: { name: "feedback-plugin", version: "1.0.0" },
            runtime: { remoteEntry: "/remoteEntry.js" },
            contract: {
              kind: "orpc",
              types: {
                path: "./contract.d.ts",
                exportName: "contract",
                typeName: "ContractType",
                ...(manifestSha !== undefined ? { sha256: manifestSha } : { sha256: actualSha }),
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === `${CONTRACT_ORIGIN}/contract.d.ts`) {
        return new Response(
          bodySha !== undefined ? "export type ContractType = tampered;" : CONTRACT_SOURCE,
          { status: 200, headers: { "content-type": "text/plain" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  }

  function callOnlyRuntimeConfig() {
    return {
      api: { name: "api", url: "", entry: "/mf-manifest.json", source: "local" as const },
      plugins: {
        feedback: {
          name: "feedback",
          url: PROXY_ORIGIN,
          entry: "",
          source: "remote" as const,
          proxy: PROXY_ORIGIN,
          contractUrl: CONTRACT_ORIGIN,
        },
      },
    } as any;
  }

  it("fetches the sha256-verified contract from the CONTRACT origin — never the proxy origin", async () => {
    const { syncApiContractBridge } = await import("../../src/services/codegen/api-contract");
    serveContractAtContractOrigin();
    testDir = mkdtempSync(join(tmpdir(), "api-contract-call-only-test-"));
    writeFile(
      join(testDir, "api", "src", "contract.ts"),
      "export type ContractType = { ping: string };",
    );
    mkdirSync(join(testDir, "api", "src", "lib"), { recursive: true });
    mkdirSync(join(testDir, "ui", "src", "lib"), { recursive: true });

    const bridge = await syncApiContractBridge({
      configDir: testDir,
      runtimeConfig: callOnlyRuntimeConfig(),
      apiBaseUrl: "",
    });

    const feedbackStatus = bridge.status.find((s) => s.key === "feedback");
    expect(feedbackStatus?.source).toBe("remote");
    expect(feedbackStatus?.url).toBe(CONTRACT_ORIGIN);
    expect(feedbackStatus?.error).toBeUndefined();

    const fetchedUrls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0]),
    );
    expect(fetchedUrls.some((url) => url.startsWith(CONTRACT_ORIGIN))).toBe(true);
    expect(fetchedUrls.some((url) => url.startsWith(PROXY_ORIGIN))).toBe(false);

    const contractPath = join(testDir, ".bos", "generated", "plugins", "feedback", "contract.d.ts");
    expect(readFileSync(contractPath, "utf-8")).toBe(CONTRACT_SOURCE);

    const apiTypes = readFileSync(join(testDir, "ui", "src", "lib", "api-types.gen.ts"), "utf-8");
    expect(apiTypes).toContain("feedbackContract");
    expect(apiTypes).toContain("feedback:");

    const pluginsTypes = readFileSync(
      join(testDir, "api", "src", "lib", "plugins-types.gen.ts"),
      "utf-8",
    );
    expect(pluginsTypes).toContain("feedback: PluginClientEntry<feedbackContract>");
  });

  it("fails the plugin loudly when the fetched contract fails checksum verification", async () => {
    const { syncApiContractBridge } = await import("../../src/services/codegen/api-contract");
    serveContractAtContractOrigin({ bodySha: "deadbeef" });
    testDir = mkdtempSync(join(tmpdir(), "api-contract-call-only-bad-test-"));
    writeFile(
      join(testDir, "api", "src", "contract.ts"),
      "export type ContractType = { ping: string };",
    );

    const bridge = await syncApiContractBridge({
      configDir: testDir,
      runtimeConfig: callOnlyRuntimeConfig(),
      apiBaseUrl: "",
    });

    const feedbackStatus = bridge.status.find((s) => s.key === "feedback");
    expect(feedbackStatus?.source).toBe("failed");
    expect(feedbackStatus?.error).toContain("checksum");
    expect(
      readFileSync(join(testDir, "ui", "src", "lib", "api-types.gen.ts"), "utf-8"),
    ).not.toContain("feedback:");
  });
});
