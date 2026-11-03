import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composePlatformReleaseManifest,
  type Manifest,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";

/** The real-transport contract: the default seams reach FastKV through
 * `fetchRegistryKey`, which owns the `apps/<account>/<gateway>/` prefix.
 * A seam that passes a full key double-prefixes the URL and reads absent
 * forever — every pinned resolution fails "no version slot" while the
 * record sits published (the stranded-pin incident). These legs stub fetch
 * and pin the exact wire. */

let tmpRoot: string;

afterEach(() => {
  vi.unstubAllGlobals();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeManifest(frameworkVersion: string): Manifest {
  return composePlatformReleaseManifest({
    frameworkVersion,
    everyPluginVersion: "3.0.0-rc.9",
    imageRef: "ghcr.io/nearbuilders/everything-dev",
    catalog: {},
    templateInventory: [],
    compatMinChild: frameworkVersion,
  });
}

function stubFastKv(records: Record<string, unknown>): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      const key = decodeURIComponent(url.split("/").pop() ?? "");
      const value = records[key];
      return new Response(
        JSON.stringify({ entries: value === undefined ? [] : [{ value: JSON.stringify(value) }] }),
        { status: 200 },
      );
    }),
  );
  return { urls };
}

describe("the default seams' FastKV wire (transport-contract regression)", () => {
  it("the version-record read targets the single-prefixed key — never double-prefixed", async () => {
    const manifest = makeManifest("2.0.0-rc.36");
    const { urls } = stubFastKv({
      "apps/root.near/root/platform.json": manifest,
      "apps/root.near/root/platform-versions/2.0.0-rc.36.json": manifest,
    });

    const resolved = await resolvePlatformManifest({
      configDir: tmpRoot,
      localConfig: { extends: "bos://root.near/root", release: "2.0.0-rc.36" },
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.manifest.frameworkVersion).toBe("2.0.0-rc.36");
    const recordUrls = urls.filter((url) => url.includes("platform-versions"));
    expect(recordUrls.length).toBeGreaterThan(0);
    for (const url of recordUrls) {
      expect(url).toContain("apps%2Froot.near%2Froot%2Fplatform-versions%2F2.0.0-rc.36.json");
      expect(url).not.toContain("apps%2Froot.near%2Froot%2Fapps%2F");
    }
  });

  it("an absent record still surfaces as the pin-not-found failure — through the real transport", async () => {
    const manifest = makeManifest("2.0.0-rc.36");
    stubFastKv({
      "apps/root.near/root/platform.json": manifest,
    });

    await expect(
      resolvePlatformManifest({
        configDir: tmpRoot,
        localConfig: { extends: "bos://root.near/root", release: "2.0.0-rc.99" },
      }),
    ).rejects.toThrow(/never published/);
  });
});
