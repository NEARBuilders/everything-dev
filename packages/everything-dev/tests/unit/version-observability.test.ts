import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDeployManifests } from "../../src/fastkv";
import { clearHttpCache } from "../../src/http-client";
import { computeDeployedVersionStatus } from "../../src/version-status";

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
                key: "apps/a.near/gw/manifests/2026-01-02T00-00-00-000z.json",
                value: JSON.stringify({ publishedAt: "2026-01-02T00:00:00.000Z" }),
              },
              {
                block_height: 200,
                block_timestamp: "1700000000000000000",
                key: "apps/a.near/gw/manifests/2026-01-01T00-00-00-000z.json",
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
    expect(manifests[0]?.key).toContain("manifests/2026-01-02");
    expect(manifests[0]?.value).toEqual({ publishedAt: "2026-01-02T00:00:00.000Z" });
  });
});

describe("computeDeployedVersionStatus", () => {
  it("reports in-sync when the published pointer fingerprint matches the served one", () => {
    const delta = computeDeployedVersionStatus({
      publishedFingerprint: "abc123",
      servedFingerprint: "abc123",
    });
    expect(delta).toEqual({
      publishedFingerprint: "abc123",
      servedFingerprint: "abc123",
      inSync: true,
    });
  });

  it("flags the split-brain when the host serves a different fingerprint than the published pointer", () => {
    const delta = computeDeployedVersionStatus({
      publishedFingerprint: "new-fp",
      servedFingerprint: "old-fp",
    });
    expect(delta?.inSync).toBe(false);
  });

  it("reports unknown served state when the host version endpoint is unreachable", () => {
    const delta = computeDeployedVersionStatus({
      publishedFingerprint: "abc123",
      servedFingerprint: null,
      servedError: "fetch failed",
    });
    expect(delta?.inSync).toBe(false);
    expect(delta?.servedFingerprint).toBeUndefined();
    expect(delta?.error).toBe("fetch failed");
  });
});
