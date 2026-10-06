import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BosConfig } from "../../src/types";

const {
  verifyRollbackSnapshotMock,
  fetchBosConfigFromFastKvMock,
  resolveSigningStrategyMock,
  submitRegistryWriteMock,
  openResolutionMock,
  buildWorkspaceTargetsMock,
} = vi.hoisted(() => ({
  verifyRollbackSnapshotMock: vi.fn(),
  fetchBosConfigFromFastKvMock: vi.fn(),
  resolveSigningStrategyMock: vi.fn(),
  submitRegistryWriteMock: vi.fn(),
  openResolutionMock: vi.fn(),
  buildWorkspaceTargetsMock: vi.fn(),
}));

vi.mock("../../src/rollback", () => ({
  verifyRollbackSnapshot: verifyRollbackSnapshotMock,
}));

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return { ...actual, fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock };
});

vi.mock("../../src/near-signer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/near-signer")>();
  return {
    ...actual,
    resolveSigningStrategy: resolveSigningStrategyMock,
    submitRegistryWrite: submitRegistryWriteMock,
  };
});

vi.mock("../../src/resolution/session", () => ({
  openResolution: openResolutionMock,
}));

vi.mock("../../src/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/build")>();
  return { ...actual, buildWorkspaceTargets: buildWorkspaceTargetsMock };
});

import { publishToFastKv } from "../../src/publish";

const bosConfig = {
  account: "dev.everything.near",
  domain: "dev.everything.dev",
  cdn: { origin: "https://cdn.example.test" },
  app: {
    host: {
      development: "local:host",
      production: "https://host.example",
      pin: { manifest: "versions/aaaaaaaaaaaaaaaa.json", integrity: "sha384-host" },
    },
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
  build: false,
  dryRun: false,
  verbose: false,
  packages: "",
  privateKey: "ed25519:0000000000000000000000000000000000000000000000000000000000000000",
};

let configDir: string;

describe("publishToFastKv pin verification gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configDir = mkdtempSync(join(tmpdir(), "bos-pin-verify-"));
    writeFileSync(join(configDir, "bos.config.json"), JSON.stringify(bosConfig, null, 2));
    buildWorkspaceTargetsMock.mockResolvedValue({ built: [], skipped: [], deployResults: [] });
    openResolutionMock.mockResolvedValue({ config: bosConfig, rawConfig: bosConfig });
    fetchBosConfigFromFastKvMock.mockResolvedValue(JSON.parse(JSON.stringify(bosConfig)));
    resolveSigningStrategyMock.mockResolvedValue({
      strategy: "near-kit",
      privateKey: "ed25519:test",
      source: "provided",
    });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("blocks the publish when a pinned slot's bytes fail verification", async () => {
    verifyRollbackSnapshotMock.mockResolvedValue({
      verifiable: true,
      ok: false,
      slots: [
        {
          slot: "plugins.registry",
          manifest: "versions/309a65a9735d13e7.json",
          ok: false,
          reason: "manifest fetch failed: 404",
        },
      ],
    });

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Publish blocked");
    expect(result.error).toContain("plugins.registry");
    expect(result.error).toContain("manifest fetch failed: 404");
    expect(verifyRollbackSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ account: "dev.everything.near" }),
    );
    expect(submitRegistryWriteMock).not.toHaveBeenCalled();
  });

  it("publishes when every pinned slot verifies", async () => {
    verifyRollbackSnapshotMock.mockResolvedValue({
      verifiable: true,
      ok: true,
      slots: [
        {
          slot: "app.host",
          manifest: "versions/aaaaaaaaaaaaaaaa.json",
          ok: true,
        },
      ],
    });

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("published");
    expect(submitRegistryWriteMock).not.toHaveBeenCalled();
  });

  it("a config with no pins skips the gate", async () => {
    verifyRollbackSnapshotMock.mockResolvedValue({ verifiable: false, ok: false, slots: [] });

    const result = await publishToFastKv({ ...baseInput, configDir });

    expect(result.status).toBe("published");
    expect(submitRegistryWriteMock).not.toHaveBeenCalled();
  });
});
