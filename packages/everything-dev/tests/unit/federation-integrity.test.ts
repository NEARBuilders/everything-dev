import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrityRegistry } from "../../src/services/deploy/integrity";
import {
  clearRemoteVersionCache,
  resolvedIntegrityMap,
  resolveRemoteVersion,
} from "../../src/services/deploy/version-manifest";
import {
  createPluginRuntime,
  installIntegrityFetchHook,
} from "../../src/services/federation/service";

let cacheDir: string;

beforeEach(() => {
  clearRemoteVersionCache();
  cacheDir = mkdtempSync(join(tmpdir(), "federation-integrity-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  vi.resetModules();
  vi.doUnmock("@module-federation/enhanced/runtime");
});

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const base = "https://cdn.test/bundles/a.test/gw.test/registry/";
const dirId = "0123456789abcdef";
const dir = `versions/${dirId}`;
const entryName = "remoteEntry.8f3a.js";
const chunkName = "__federation_expose_admin.js";

const entryBytes = "the container entry";
const chunkBytes = "the lazily-fetched admin chunk";

const manifestDoc = (): string =>
  JSON.stringify({
    version: "8f3ac1d2feedbeef",
    entry: entryName,
    entryIntegrity: sriOf(entryBytes),
    dir,
    files: {
      [entryName]: sriOf(entryBytes),
      [chunkName]: sriOf(chunkBytes),
    },
  });

const objects = (): Record<string, string> => ({
  [`${base}versions/8f3ac1d2feedbeef.json`]: manifestDoc(),
  [`${base}${dir}/${entryName}`]: entryBytes,
  [`${base}${dir}/${chunkName}`]: chunkBytes,
});

const fixtureCdn = (objectsById: Record<string, string>) =>
  (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = objectsById[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;

const digest = { manifest: "versions/8f3ac1d2feedbeef.json", integrity: sriOf(manifestDoc()) };

type CapturedHook = (url: unknown, init?: unknown) => unknown;

const hookHarness = () => {
  const captured: CapturedHook[] = [];
  const mf = {
    loaderHook: {
      lifecycle: {
        fetch: { on: (fn: CapturedHook) => captured.push(fn) },
      },
    },
  };
  return { mf, captured };
};

beforeEach(() => {
  clearRemoteVersionCache();
});

describe("#642 revival — the integrity-in-pipeline gate", () => {
  it("keys the registry by the resolved hashed URLs the runtime fetches, never fixed names", async () => {
    const registry = new IntegrityRegistry();
    const resolved = await resolveRemoteVersion({
      base,
      digest,
      fetchImpl: fixtureCdn(objects()),
    });
    for (const [url, integrity] of Object.entries(resolvedIntegrityMap(resolved))) {
      registry.register(url, integrity);
    }
    expect(registry.get(`${base}${dir}/${entryName}`)).toBe(sriOf(entryBytes));
    expect(registry.get(`${base}${dir}/${chunkName}`)).toBe(sriOf(chunkBytes));
    expect(registry.get(resolveEntryName(base))).toBeUndefined();
  });

  it("verifies a lazily-fetched file against the pin's files map and names the mismatch", async () => {
    const registry = new IntegrityRegistry();
    const resolved = await resolveRemoteVersion({
      base,
      digest,
      fetchImpl: fixtureCdn(objects()),
    });
    for (const [url, integrity] of Object.entries(resolvedIntegrityMap(resolved))) {
      registry.register(url, integrity);
    }

    const tampered = objects();
    tampered[`${base}${dir}/${chunkName}`] = "the parent republished this chunk";
    vi.stubGlobal("fetch", fixtureCdn(tampered));
    const { mf, captured } = hookHarness();
    installIntegrityFetchHook(mf as never, registry, { cacheDir });
    const handler = captured[0]!;

    const response = (await handler(`${base}${dir}/${chunkName}`)) as Response;
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("IntegrityMismatch");
    expect(body).toContain(sriOf(chunkBytes));
    expect(body).toContain(sriOf("the parent republished this chunk"));
    vi.unstubAllGlobals();
  });

  it("serves verified bytes through and writes the bundle cache", async () => {
    const registry = new IntegrityRegistry();
    const resolved = await resolveRemoteVersion({
      base,
      digest,
      fetchImpl: fixtureCdn(objects()),
    });
    for (const [url, integrity] of Object.entries(resolvedIntegrityMap(resolved))) {
      registry.register(url, integrity);
    }
    const { mf, captured } = hookHarness();
    installIntegrityFetchHook(mf as never, registry, { cacheDir });
    const handler = captured[0]!;

    vi.stubGlobal("fetch", fixtureCdn(objects()));
    const response = (await handler(`${base}${dir}/${chunkName}`)) as Response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(chunkBytes);
    vi.unstubAllGlobals();
  });

  it("passes unregistered urls through untouched", async () => {
    const registry = new IntegrityRegistry();
    const { mf, captured } = hookHarness();
    installIntegrityFetchHook(mf as never, registry, { cacheDir });
    expect(await captured[0]!("https://unrelated.test/whatever.js")).toBeUndefined();
  });

  it("createPluginRuntime installs the hook itself — no __mfInstance probe", async () => {
    const { mf, captured } = hookHarness();
    vi.doMock("@module-federation/enhanced/runtime", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@module-federation/enhanced/runtime")>();
      return {
        ...actual,
        getInstance: () => mf,
        createInstance: () => mf,
      };
    });
    const { createPluginRuntime: wrapped } = await import("../../src/services/federation/service");
    const registry = new IntegrityRegistry();
    wrapped({ registry: {}, secrets: {} } as never, { integrityRegistry: registry, cacheDir });
    expect((mf as Record<string, unknown>).__everythingDevIntegrityHook).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    vi.doUnmock("@module-federation/enhanced/runtime");
    vi.resetModules();
  });
});

function resolveEntryName(slotBase: string): string {
  return `${slotBase.replace(/\/$/, "")}/remoteEntry.js`;
}
