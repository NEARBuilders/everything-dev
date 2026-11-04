import { afterEach, describe, expect, it, vi } from "vitest";
import { ManifestTagSchema } from "../../src/services/platform/manifest-schema";
import { readManifestTag, readVersionRecord } from "../../src/services/registry/pointer";
import { clearHttpCache } from "../../src/utils/http-client";

/**
 * The wire-shape regression: the pointer reads fetch the runtime-prefixed
 * key exactly once. The Nov-03 release-train deploy failed its smoke and
 * burned a version slot because these reads passed a FULL key into
 * `fetchRegistryKey` (which wraps with `apps/<account>/<gateway>/`), so
 * every pointer/slot read resolved
 * `apps/<a>/<g>/apps/<a>/<g>/manifest.json` — a key that can never exist —
 * and returned null. The unit seam asserted outcomes, never URLs; these
 * tests pin the URLs.
 */

const ACCOUNT = "dev.everything.near";
const GATEWAY = "everything.dev";

const fetchedUrls: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  clearHttpCache();
  fetchedUrls.length = 0;
});

function stubRegistry(value: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      fetchedUrls.push(String(input));
      if (value === undefined) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ entries: [{ value }] }), { status: 200 });
    }),
  );
}

describe("readManifestTag / readVersionRecord — the read wire keys", () => {
  it("readManifestTag fetches apps/<account>/<gateway>/manifest.json — prefixed exactly once", async () => {
    stubRegistry({ frameworkVersion: "2.0.0-rc.35" });

    const pointer = await readManifestTag<{ frameworkVersion: string }>(ACCOUNT, GATEWAY);

    expect(pointer?.frameworkVersion).toBe("2.0.0-rc.35");
    expect(fetchedUrls).toEqual([
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/" +
        `apps%2F${ACCOUNT}%2F${GATEWAY}%2Fmanifest.json`,
    ]);
  });

  it("readVersionRecord fetches apps/<account>/<gateway>/versions/<v>.json — prefixed exactly once", async () => {
    stubRegistry({ frameworkVersion: "2.0.0-rc.36" });

    const slot = await readVersionRecord<{ frameworkVersion: string }>(
      ACCOUNT,
      GATEWAY,
      "2.0.0-rc.36",
    );

    expect(slot?.frameworkVersion).toBe("2.0.0-rc.36");
    expect(fetchedUrls).toEqual([
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/" +
        `apps%2F${ACCOUNT}%2F${GATEWAY}%2Fversions%2F2.0.0-rc.36.json`,
    ]);
  });

  it("an absent record reads null through the same single-prefixed key", async () => {
    stubRegistry(undefined);

    await expect(readVersionRecord(ACCOUNT, GATEWAY, "9.9.9")).resolves.toBeNull();
    expect(fetchedUrls).toEqual([
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/" +
        `apps%2F${ACCOUNT}%2F${GATEWAY}%2Fversions%2F9.9.9.json`,
    ]);
  });
});

describe("the thin tag decodes through ManifestTagSchema as served over the wire", () => {
  it("a registry-served thin tag decodes to its version — the smoke manifest leg's decode path", async () => {
    stubRegistry(
      JSON.stringify({ schemaVersion: 1, version: "2.0.0-rc.37", digest: "a".repeat(64) }),
    );

    const bytes = await readManifestTag<unknown>(ACCOUNT, GATEWAY);
    const decoded = bytes ? ManifestTagSchema.safeParse(bytes) : null;

    expect(decoded?.success).toBe(true);
    if (decoded?.success) {
      expect(decoded.data.version).toBe("2.0.0-rc.37");
      expect(decoded.data.schemaVersion).toBe(1);
    }
    expect(fetchedUrls).toEqual([
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/" +
        `apps%2F${ACCOUNT}%2F${GATEWAY}%2Fmanifest.json`,
    ]);
  });

  it("the pre-cutover rich shape served on the wire fails the thin-tag decode", async () => {
    stubRegistry(JSON.stringify({ frameworkVersion: "2.0.0-rc.37" }));

    const bytes = await readManifestTag<unknown>(ACCOUNT, GATEWAY);
    const decoded = bytes ? ManifestTagSchema.safeParse(bytes) : null;

    expect(decoded?.success).toBe(false);
  });
});
