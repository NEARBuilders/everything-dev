import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosConfig } from "../../src/types";

const {
  buildWorkspaceTargetsMock,
  generateCodeArtifactsMock,
  fetchBosConfigFromFastKvMock,
  resolveSigningStrategyMock,
  openResolutionMock,
  collectDistFilesMock,
  uploadWorkspaceDistMock,
  uploadBundleMock,
  readBuildReportMock,
  platformUrlDeployEntriesMock,
  probeStorageOriginMock,
} = vi.hoisted(() => ({
  buildWorkspaceTargetsMock: vi.fn(),
  generateCodeArtifactsMock: vi.fn(),
  fetchBosConfigFromFastKvMock: vi.fn(),
  resolveSigningStrategyMock: vi.fn(),
  openResolutionMock: vi.fn(),
  collectDistFilesMock: vi.fn(),
  uploadWorkspaceDistMock: vi.fn(),
  uploadBundleMock: vi.fn(),
  readBuildReportMock: vi.fn(),
  platformUrlDeployEntriesMock: vi.fn(() => []),
  probeStorageOriginMock: vi.fn(),
}));

vi.mock("../../src/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/build")>();
  return { ...actual, buildWorkspaceTargets: buildWorkspaceTargetsMock };
});

vi.mock("../../src/code-artifacts", () => ({
  generateCodeArtifacts: generateCodeArtifactsMock,
}));

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return { ...actual, fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock };
});

vi.mock("../../src/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-signer")>();
  return { ...actual, resolveSigningStrategy: resolveSigningStrategyMock };
});

vi.mock("../../src/resolution/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/resolution/session")>();
  return { ...actual, openResolution: openResolutionMock };
});

vi.mock("../../src/storage-upload", () => ({
  collectDistFiles: collectDistFilesMock,
  uploadWorkspaceDist: uploadWorkspaceDistMock,
  uploadBundle: uploadBundleMock,
}));

vi.mock("../../src/platform-deploy", () => ({
  platformUrlDeployEntries: platformUrlDeployEntriesMock,
  pluginUiUrlDeployEntries: vi.fn(() => []),
}));

vi.mock("../../src/version-manifest-deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/version-manifest-deploy")>();
  return { ...actual, readBuildReport: readBuildReportMock };
});

vi.mock("../../src/cdn-deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cdn-deploy")>();
  return { ...actual, probeStorageOrigin: probeStorageOriginMock };
});

import { writeSessionHandle } from "../../src/auth-session";
import { publishToFastKv } from "../../src/publish";

const bosConfig = {
  account: "dev.everything.near",
  domain: "dev.everything.dev",
  cdn: { origin: "https://cdn.example.test" },
  app: {
    host: { development: "local:host", production: "https://host.example" },
    ui: { development: "local:ui", production: "https://ui.example" },
    api: { development: "local:api", production: "https://api.example" },
  },
  plugins: {
    votes: {
      development: "local:plugins/votes",
      production: "https://votes.example",
    },
  },
} as BosConfig;

const baseInput = {
  bosConfig,
  runtimeConfig: null,
  env: "production" as const,
  build: true,
  dryRun: false,
  verbose: false,
  packages: "",
  privateKey: "ed25519:0000000000000000000000000000000000000000000000000000000000000000",
};

let configDir: string;
let savedEnv: Record<string, string | undefined>;

describe("publishToFastKv preflight ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probeStorageOriginMock.mockResolvedValue(undefined);
    readBuildReportMock.mockReturnValue(null);
    configDir = mkdtempSync(join(tmpdir(), "bos-preflight-"));
    savedEnv = {
      BOS_BUNDLE_CDN_ORIGIN: process.env.BOS_BUNDLE_CDN_ORIGIN,
      BOS_STORAGE_API_KEY: process.env.BOS_STORAGE_API_KEY,
      BOS_STORAGE_ORIGIN: process.env.BOS_STORAGE_ORIGIN,
    };
    delete process.env.BOS_BUNDLE_CDN_ORIGIN;
    delete process.env.BOS_STORAGE_API_KEY;
    delete process.env.BOS_STORAGE_ORIGIN;

    resolveSigningStrategyMock.mockResolvedValue({
      strategy: "near-kit",
      privateKey: "ed25519:test",
      source: "provided",
    });
    openResolutionMock.mockResolvedValue({ config: bosConfig } as never);
    writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(bosConfig, null, 2));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it("aborts before the build train when CDN storage credentials are missing", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    fetchBosConfigFromFastKvMock.mockRejectedValue(new Error("No config found"));

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("CDN deploy requires bundle-upload credentials");
    expect(result.error).toContain("BOS_STORAGE_API_KEY");
    expect(generateCodeArtifactsMock).not.toHaveBeenCalled();
    expect(buildWorkspaceTargetsMock).not.toHaveBeenCalled();
    expect(uploadWorkspaceDistMock).not.toHaveBeenCalled();
    expect(result.registryUrl).toContain("dev.everything.near");
  });

  it("aborts before the build train on a session account mismatch", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    writeSessionHandle(configDir, {
      version: 1,
      credential: {
        kind: "session",
        apiKey: "api_session",
        apiKeyId: "key-1",
        accountId: "someone.else.near",
        label: "test",
        siteUrl: "https://site.example",
        createdAt: new Date().toISOString(),
        expiresAt: null,
      },
      publishKey: null,
      delegateKey: null,
    });

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("someone.else.near");
    expect(buildWorkspaceTargetsMock).not.toHaveBeenCalled();
  });

  it("reads the registry before building and publishes when already up to date", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({ built: [], skipped: [], deployResults: [] });
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("published");
    expect(buildWorkspaceTargetsMock).toHaveBeenCalledTimes(1);
    expect(uploadWorkspaceDistMock).not.toHaveBeenCalled();
    expect(fetchBosConfigFromFastKvMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildWorkspaceTargetsMock.mock.invocationCallOrder[0]!,
    );
  });

  it("uploads workspace dists with the resolved storage credentials", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({
      built: ["host"],
      skipped: [],
      deployResults: [{ key: "host", kind: "app", success: true }],
    });
    collectDistFilesMock.mockResolvedValue([]);
    uploadWorkspaceDistMock.mockResolvedValue({
      stored: 1,
      totalBytes: 3,
      integrity: { "remoteEntry.8f3ac1d2.js": "sha384-entry" },
      storage: "s3",
    });
    readBuildReportMock.mockReturnValue({ entry: "remoteEntry.8f3ac1d2.js" });
    uploadBundleMock.mockImplementation(async (input: { files: Array<{ path: string }> }) => ({
      stored: 1,
      totalBytes: 3,
      integrity: { [input.files[0]!.path]: "sha384-manifest" },
      storage: "s3",
    }));
    let fetchCalls = 0;
    fetchBosConfigFromFastKvMock.mockImplementation(async () => {
      fetchCalls += 1;
      return fetchCalls === 1 ? bosConfig : JSON.parse(JSON.stringify(bosConfig));
    });

    const result = await publishToFastKv({ ...baseInput, configDir, packages: "all" });

    expect(result.status).toBe("published");
    expect(uploadWorkspaceDistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://dev.everything.dev",
        apiKey: "api_ci_key",
        account: "dev.everything.near",
        gateway: "dev.everything.dev",
        workspace: "host",
      }),
    );
  });

  it("a packages-scoped publish (single-plugin redeploy) uploads and pins only the selected workspace", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({
      built: ["votes"],
      skipped: ["host", "ui", "api"],
      deployResults: [{ key: "votes", kind: "plugin", success: true }],
    });
    collectDistFilesMock.mockResolvedValue([]);
    uploadWorkspaceDistMock.mockResolvedValue({
      stored: 1,
      totalBytes: 3,
      integrity: { "remoteEntry.8f3ac1d2.js": "sha384-entry" },
      storage: "s3",
    });
    readBuildReportMock.mockReturnValue({ entry: "remoteEntry.8f3ac1d2.js" });
    uploadBundleMock.mockImplementation(async (input: { files: Array<{ path: string }> }) => ({
      stored: 1,
      totalBytes: 3,
      integrity: { [input.files[0]!.path]: "sha384-manifest" },
      storage: "s3",
    }));
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir, packages: "votes" });

    expect(result.status).toBe("published");
    expect(uploadWorkspaceDistMock).toHaveBeenCalledTimes(1);
    expect(uploadWorkspaceDistMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: "votes" }),
    );
  });

  it("aborts before publish when the receiving storage backend is in-memory", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({
      built: ["host"],
      skipped: [],
      deployResults: [{ key: "host", kind: "app", success: true }],
    });
    collectDistFilesMock.mockResolvedValue([]);
    uploadWorkspaceDistMock.mockResolvedValue({
      stored: 1,
      totalBytes: 3,
      integrity: { "remoteEntry.8f3ac1d2.js": "sha384-entry" },
      storage: "memory",
    });
    readBuildReportMock.mockReturnValue({ entry: "remoteEntry.8f3ac1d2.js" });
    uploadBundleMock.mockImplementation(async (input: { files: Array<{ path: string }> }) => ({
      stored: 1,
      totalBytes: 3,
      integrity: { [input.files[0]!.path]: "sha384-manifest" },
      storage: "memory",
    }));
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir, packages: "all" });

    expect(result.status).toBe("error");
    expect(result.error).toContain("BOS_STORAGE_*");
  });

  it("aborts the train when an uploaded dist cannot pin a version manifest (no build report)", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({
      built: ["host"],
      skipped: [],
      deployResults: [{ key: "host", kind: "app", success: true }],
    });
    collectDistFilesMock.mockResolvedValue([]);
    uploadWorkspaceDistMock.mockResolvedValue({
      stored: 1,
      totalBytes: 3,
      integrity: { "remoteEntry.js": "sha384-entry" },
      storage: "s3",
    });
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir, packages: "all" });

    expect(result.status).toBe("error");
    expect(result.error).toContain("version manifest missing");
    expect(result.error).toContain("host");
    expect(uploadBundleMock).not.toHaveBeenCalled();
  });

  it("pins the version manifest: composes from the server SRI map, uploads it, passes the pointer", async () => {
    process.env.BOS_BUNDLE_CDN_ORIGIN = "https://cdn.example.test";
    process.env.BOS_STORAGE_API_KEY = "api_ci_key";
    buildWorkspaceTargetsMock.mockResolvedValue({
      built: ["host"],
      skipped: [],
      deployResults: [{ key: "host", kind: "app", success: true }],
    });
    collectDistFilesMock.mockResolvedValue([]);
    uploadWorkspaceDistMock.mockResolvedValue({
      stored: 1,
      totalBytes: 3,
      integrity: { "remoteEntry.8f3ac1d2.js": "sha384-entry" },
      storage: "s3",
    });
    readBuildReportMock.mockReturnValue({ entry: "remoteEntry.8f3ac1d2.js" });
    uploadBundleMock.mockImplementation(async (input: { files: Array<{ path: string }> }) => ({
      stored: 1,
      totalBytes: 3,
      integrity: { [input.files[0]!.path]: "sha384-manifest" },
      storage: "s3",
    }));
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir, packages: "all" });

    expect(result.status).toBe("published");
    expect(uploadBundleMock).toHaveBeenCalledTimes(1);
    expect(platformUrlDeployEntriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pin: {
          file: expect.stringMatching(/^versions\/[0-9a-f]{16}\.json$/),
          integrity: "sha384-manifest",
        },
      }),
    );
  });

  it("a config-only publish (build: false) never invokes the build train", async () => {
    buildWorkspaceTargetsMock.mockResolvedValue({ built: [], skipped: [], deployResults: [] });
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));

    const result = await publishToFastKv({ ...baseInput, configDir, build: false });

    expect(result.status).toBe("published");
    expect(generateCodeArtifactsMock).not.toHaveBeenCalled();
    expect(buildWorkspaceTargetsMock).not.toHaveBeenCalled();
    expect(uploadWorkspaceDistMock).not.toHaveBeenCalled();
  });
});
