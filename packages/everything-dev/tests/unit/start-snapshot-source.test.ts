import { describe, expect, it, vi } from "vitest";
import { pointerDigest } from "../../src/services/registry/fingerprint";
import { type BootSnapshot, bootSnapshotOf } from "../../src/services/snapshot/schema";
import {
  BOOT_SNAPSHOT_ENV_KEY,
  bootSnapshotEnv,
  createRegistryConfigSource,
} from "../../src/services/start/snapshot-source";
import { BosConfigSchema } from "../../src/types";

/**
 * The degraded boot rung's decision table (ADR 0041, ticket 02): transport
 * failures fall back to the approved snapshot; definitive negatives and
 * disabled rungs do not; a corrupt snapshot refuses loudly, naming both
 * causes. Persist is the writer seam on every registry resolution.
 */

const config = BosConfigSchema.parse({
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
});

const ACCOUNT = "dev.everything.near";
const GATEWAY = "citynode.app";
const FETCH_ERROR = new Error("connect ECONNREFUSED registry (the outage)");

const snapshot = (): BootSnapshot =>
  bootSnapshotOf({
    account: ACCOUNT,
    gateway: GATEWAY,
    config,
    manifestTag: { version: "2.0.0-rc.37", digest: "b143bf5f" },
    writtenAt: "2026-11-04T12:00:00.000Z",
  });

type Deps = Parameters<typeof createRegistryConfigSource>[0];

function makeSource(overrides?: Partial<Deps>) {
  const deps: Deps = {
    fetchPublishedConfig: vi.fn(async () => {
      throw FETCH_ERROR;
    }),
    loadSnapshot: vi.fn(async () => null),
    persistSnapshot: vi.fn(async () => undefined),
    ...overrides,
  };
  const source = createRegistryConfigSource(deps);
  const resolve = (allowSnapshot = true) =>
    source.resolve({ account: ACCOUNT, gateway: GATEWAY, allowSnapshot });
  return { resolve, ...deps };
}

describe("boot marker env", () => {
  it("marks only snapshot-sourced resolutions", () => {
    expect(bootSnapshotEnv("snapshot")).toEqual({ [BOOT_SNAPSHOT_ENV_KEY]: "1" });
    expect(bootSnapshotEnv("registry")).toEqual({});
    expect(bootSnapshotEnv(undefined)).toEqual({});
    expect(bootSnapshotEnv(null)).toEqual({});
  });
});

describe("registry path", () => {
  it("serves the fetched config and persists it through the writer seam", async () => {
    const { resolve, persistSnapshot, loadSnapshot } = makeSource({
      fetchPublishedConfig: vi.fn(async () => config),
    });
    const resolved = await resolve();
    expect(resolved).toEqual({ config, source: "registry", warnings: [] });
    expect(persistSnapshot).toHaveBeenCalledWith(ACCOUNT, GATEWAY, config);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it("records a persist failure as a non-fatal warning", async () => {
    const { resolve } = makeSource({
      fetchPublishedConfig: vi.fn(async () => config),
      persistSnapshot: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const resolved = await resolve();
    expect(resolved?.source).toBe("registry");
    expect(resolved?.warnings.join(" ")).toContain("approved-snapshot persist failed");
    expect(resolved?.warnings.join(" ")).toContain("disk full");
  });

  it("a definitive negative (no config published) returns null — no snapshot attempt", async () => {
    const { resolve, loadSnapshot } = makeSource({ fetchPublishedConfig: vi.fn(async () => null) });
    expect(await resolve()).toBeNull();
    expect(loadSnapshot).not.toHaveBeenCalled();
  });
});

describe("degraded path", () => {
  it("a disabled rung rethrows the transport error without loading the snapshot", async () => {
    const { resolve, loadSnapshot } = makeSource({ loadSnapshot: vi.fn(async () => snapshot()) });
    await expect(resolve(false)).rejects.toThrow("ECONNREFUSED");
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it("an absent snapshot rethrows the original transport error", async () => {
    const { resolve, loadSnapshot } = makeSource(); // load → null
    await expect(resolve()).rejects.toThrow("ECONNREFUSED");
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it("a verified snapshot serves the degraded generation with its provenance", async () => {
    const { resolve } = makeSource({ loadSnapshot: vi.fn(async () => snapshot()) });
    const resolved = await resolve();
    expect(resolved?.source).toBe("snapshot");
    expect(resolved?.config).toEqual(config);
    expect(resolved?.config).toMatchObject({
      app: { host: { digest: { manifest: "versions/aaa.json" } } },
    });
    const warning = resolved?.warnings.join(" ") ?? "";
    expect(warning).toContain("registry unreachable");
    expect(warning).toContain("2026-11-04T12:00:00.000Z");
    expect(warning).toContain("2.0.0-rc.37");
    expect(warning).toContain("pointer watch");
  });

  it("a tampered snapshot refuses loudly, naming both causes", async () => {
    const tampered = { ...snapshot(), pointerDigest: "0".repeat(16) };
    expect(tampered.pointerDigest).not.toBe(pointerDigest(config));
    const { resolve } = makeSource({ loadSnapshot: vi.fn(async () => tampered) });
    await expect(resolve()).rejects.toThrow(/registry is unreachable.*digest mismatch/s);
  });

  it("an unloadable snapshot refuses loudly, naming both causes", async () => {
    const { resolve } = makeSource({
      loadSnapshot: vi.fn(async () => {
        throw new Error("unexpected end of JSON input");
      }),
    });
    await expect(resolve()).rejects.toThrow(/registry is unreachable.*unexpected end of JSON/s);
  });
});
