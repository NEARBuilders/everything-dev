import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSriHash, IntegrityRegistry } from "../../src/integrity";
import { installIntegrityFetchHook } from "../../src/mf";

const goodBytes = "console.log('the good entry');";
const corruptedBytes = "console.log('tampered');";
const pin = computeSriHash(goodBytes);

/** A fake MF instance capturing the loader fetch handler. */
function fakeMf() {
  let handler: ((url: unknown, init: unknown) => Promise<Response> | undefined) | null = null;
  const mf = {
    loaderHook: {
      lifecycle: {
        fetch: {
          on(fn: typeof handler) {
            handler = fn;
          },
        },
      },
    },
  };
  return {
    mf: mf as never,
    handler: (url: string) => handler!(url, {}),
  };
}

describe("installIntegrityFetchHook — integrity-mismatch cache fallback (ticket 09)", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "bos-integrity-fallback-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(corruptedBytes, { status: 200 })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const url = "https://cdn.example.test/bundles/a.near/g.app/ui/remoteEntry.8f3a.js";

  async function primeCache(bytes: string) {
    const { writeBundleCache } = await import("../../src/bundle-cache");
    await writeBundleCache(url, new TextEncoder().encode(bytes), { cacheDir });
  }

  it("serves last-known-good cached bytes when the origin serves an SRI mismatch", async () => {
    await primeCache(goodBytes);
    const { mf, handler } = fakeMf();
    const registry = new IntegrityRegistry();
    registry.register(url, pin);
    installIntegrityFetchHook(mf, registry, { cacheDir });

    const response = await handler(url);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe(goodBytes);
    expect(response!.headers.get("x-bundle-cache")).toBe("stale");
  });

  it("returns the integrity-failed 500 when there is no cached fallback", async () => {
    const { mf, handler } = fakeMf();
    const registry = new IntegrityRegistry();
    registry.register(url, pin);
    installIntegrityFetchHook(mf, registry, { cacheDir });

    const response = await handler(url);
    expect(response!.status).toBe(500);
  });

  it("never writes corrupted origin bytes into the cache", async () => {
    const { mf, handler } = fakeMf();
    const registry = new IntegrityRegistry();
    registry.register(url, pin);
    installIntegrityFetchHook(mf, registry, { cacheDir });

    await handler(url);
    const { readBundleCache } = await import("../../src/bundle-cache");
    expect(await readBundleCache(url, { cacheDir })).toBeNull();
  });

  it("writes through on verified origin bytes", async () => {
    const { mf, handler } = fakeMf();
    const registry = new IntegrityRegistry();
    registry.register(url, pin);
    installIntegrityFetchHook(mf, registry, { cacheDir });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(goodBytes, { status: 200 })) as unknown as typeof fetch,
    );
    const response = await handler(url);
    expect(response!.status).toBe(200);

    const { readBundleCache } = await import("../../src/bundle-cache");
    const cached = await readBundleCache(url, { cacheDir });
    expect(cached && new TextDecoder().decode(cached)).toBe(goodBytes);
  });

  it("unpinned URLs pass through untouched", async () => {
    const { mf, handler } = fakeMf();
    installIntegrityFetchHook(mf, new IntegrityRegistry(), { cacheDir });
    expect(handler(url)).toBeUndefined();
  });
});
