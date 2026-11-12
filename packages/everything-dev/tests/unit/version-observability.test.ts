import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDeployManifests } from "../../src/services/registry/fastkv";
import { computeDeployedVersionStatus } from "../../src/services/version/status";
import { clearHttpCache } from "../../src/utils/http-client";

beforeEach(() => {
  clearHttpCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDeployManifests", () => {
  it("lists the manifests key family newest-first with parsed payloads", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entries: [
              {
                block_height: 300,
                block_timestamp: "1700000100000000000",
                key: "apps/a.near/gw/deploys/2026-01-02T00-00-00-000z.json",
                value: JSON.stringify({ publishedAt: "2026-01-02T00:00:00.000Z" }),
              },
              {
                block_height: 200,
                block_timestamp: "1700000000000000000",
                key: "apps/a.near/gw/deploys/2026-01-01T00-00-00-000z.json",
                value: JSON.stringify({ publishedAt: "2026-01-01T00:00:00.000Z" }),
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const manifests = await fetchDeployManifests({ accountId: "a.near", gatewayId: "gw" });

    expect(manifests).toHaveLength(2);
    expect(manifests[0]?.key).toContain("deploys/2026-01-02");
    expect(manifests[0]?.value).toEqual({ publishedAt: "2026-01-02T00:00:00.000Z" });
  });
});

describe("computeDeployedVersionStatus", () => {
  it("reports in-sync when the published pointer digest matches the served one", () => {
    const delta = computeDeployedVersionStatus({
      publishedDigest: "abc123",
      servedDigest: "abc123",
    });
    expect(delta).toEqual({
      publishedDigest: "abc123",
      servedDigest: "abc123",
      inSync: true,
    });
  });

  it("flags the split-brain when the host serves a different pointer digest than published", () => {
    const delta = computeDeployedVersionStatus({
      publishedDigest: "new-fp",
      servedDigest: "old-fp",
    });
    expect(delta?.inSync).toBe(false);
  });

  it("reports unknown served state when the host version endpoint is unreachable", () => {
    const delta = computeDeployedVersionStatus({
      publishedDigest: "abc123",
      servedDigest: null,
      servedError: "fetch failed",
    });
    expect(delta?.inSync).toBe(false);
    expect(delta?.servedDigest).toBeUndefined();
    expect(delta?.error).toBe("fetch failed");
  });
});
