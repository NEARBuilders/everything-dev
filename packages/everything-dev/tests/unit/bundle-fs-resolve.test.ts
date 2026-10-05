import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BundleNamespace,
  bundleUrlToLocalPath,
  installBundleFetchFromEnv,
  installGlobalBundleFetch,
} from "../../src/bundle-fs-resolve";
import { defaultConfigEnv } from "../../src/config";

const NAMESPACE: BundleNamespace = {
  bundleDir: join(tmpdir(), "bundle-fs-resolve-test"),
  account: "v1.citynode.near",
  gateway: "citynode.app",
};

const manifestBody = JSON.stringify({ schemaVersion: 1, kind: "every-plugin/manifest" });

function stageFixture(): void {
  mkdirSync(NAMESPACE.bundleDir, { recursive: true });
  const pluginDir = join(NAMESPACE.bundleDir, NAMESPACE.account, NAMESPACE.gateway, "apps");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.manifest.json"), manifestBody);
}

describe("bundleUrlToLocalPath", () => {
  beforeAll(stageFixture);
  afterAll(() => rmSync(NAMESPACE.bundleDir, { recursive: true, force: true }));

  it("resolves an own-namespace URL into the staged directory", () => {
    const resolved = bundleUrlToLocalPath(
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/plugin.manifest.json",
      NAMESPACE,
    );
    expect(resolved).toBe(
      join(
        NAMESPACE.bundleDir,
        NAMESPACE.account,
        NAMESPACE.gateway,
        "apps",
        "plugin.manifest.json",
      ),
    );
  });

  it("rejects a foreign namespace (children keep the network fetch)", () => {
    expect(
      bundleUrlToLocalPath(
        "https://other.dev/bundles/other.account.near/other.dev/apps/plugin.manifest.json",
        NAMESPACE,
      ),
    ).toBeNull();
  });

  it("rejects non-http(s) schemes and malformed input", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/plain,hi",
      "not a url",
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/",
    ]) {
      expect(bundleUrlToLocalPath(url, NAMESPACE)).toBeNull();
    }
  });

  it("contains traversal inside the own namespace and rejects escapes", () => {
    for (const url of [
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/../apps/plugin.manifest.json",
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/%2e%2e/apps/plugin.manifest.json",
    ]) {
      const resolved = bundleUrlToLocalPath(url, NAMESPACE);
      expect(
        resolved?.startsWith(join(NAMESPACE.bundleDir, NAMESPACE.account, NAMESPACE.gateway)),
      ).toBe(true);
    }
    for (const url of [
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/..%2f..%2fetc%2fpasswd",
      "https://citynode.app/bundles/v1.citynode.near/citynode.app/../other.namespace/apps/plugin.manifest.json",
    ]) {
      expect(bundleUrlToLocalPath(url, NAMESPACE)).toBeNull();
    }
  });

  it("rejects a prefix collision with a longer account name", () => {
    expect(
      bundleUrlToLocalPath(
        "https://citynode.app/bundles/v1.citynode.near.evil/citynode.app/apps/plugin.manifest.json",
        NAMESPACE,
      ),
    ).toBeNull();
  });
});

describe("BundleResolver global fetch adapter", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(stageFixture);
  afterAll(() => rmSync(NAMESPACE.bundleDir, { recursive: true, force: true }));

  it("serves own-namespace URLs from disk with manifest semantics", async () => {
    const handle = installGlobalBundleFetch({ namespace: NAMESPACE });
    try {
      const res = await fetch(
        "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/plugin.manifest.json",
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual(JSON.parse(manifestBody));
    } finally {
      await handle.uninstall();
    }
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("falls through to the original fetch for own-namespace files that are not staged", async () => {
    const fallthrough = new Response("from-network", { status: 200 });
    globalThis.fetch = async () => fallthrough;
    const handle = installGlobalBundleFetch({ namespace: NAMESPACE });
    try {
      const res = await fetch(
        "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/missing.js",
      );
      expect(res).toBe(fallthrough);
    } finally {
      await handle.uninstall();
      globalThis.fetch = originalFetch;
    }
  });

  it("own-namespace misses bypass the write-through cache", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "bundle-cache-"));
    const fallthrough = new Response("from-network", { status: 200 });
    globalThis.fetch = async () => fallthrough;
    const handle = installGlobalBundleFetch({ namespace: NAMESPACE, cacheDir });
    try {
      const missing = "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/missing.js";
      expect(await fetch(missing)).toBe(fallthrough);
      expect(await fetch(missing)).toBe(fallthrough);
      expect(existsSync(join(cacheDir, NAMESPACE.account, NAMESPACE.gateway, "apps"))).toBe(false);
    } finally {
      await handle.uninstall();
      globalThis.fetch = originalFetch;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("falls through to the original fetch for foreign URLs", async () => {
    const fallthrough = new Response("from-network", { status: 200 });
    globalThis.fetch = async () => fallthrough;
    const handle = installGlobalBundleFetch({ namespace: NAMESPACE });
    try {
      const res = await fetch("https://api.fastnear.com/v0/account/test");
      expect(res).toBe(fallthrough);
    } finally {
      await handle.uninstall();
      globalThis.fetch = originalFetch;
    }
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("caches foreign-namespace bundles stale-if-error", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "bundle-cache-"));
    let failOrigin = false;
    globalThis.fetch = async () => {
      if (failOrigin) throw new Error("origin down");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const handle = installGlobalBundleFetch({
      namespace: NAMESPACE,
      cacheDir,
    });
    try {
      const foreign =
        "https://base.everything.near/bundles/base.near/everything.dev/auth/plugin.manifest.json";
      const fresh = await fetch(foreign);
      expect(fresh.headers.get("x-bundle-cache")).toBeNull();
      expect(await fresh.json()).toEqual({ ok: true });

      failOrigin = true;
      const stale = await fetch(foreign);
      expect(stale.status).toBe(200);
      expect(stale.headers.get("x-bundle-cache")).toBe("stale");
      expect(await stale.json()).toEqual({ ok: true });

      const uncached =
        "https://base.everything.near/bundles/base.near/everything.dev/votes/plugin.manifest.json";
      await expect(fetch(uncached)).rejects.toThrow("origin down");
      rmSync(cacheDir, { recursive: true, force: true });
    } finally {
      await handle.uninstall();
      globalThis.fetch = originalFetch;
    }
  });

  it("does not cache when no cache dir is configured", async () => {
    const fallthrough = new Response("from-network", { status: 200 });
    globalThis.fetch = async () => fallthrough;
    const handle = installGlobalBundleFetch({ namespace: NAMESPACE });
    try {
      const res = await fetch(
        "https://base.everything.near/bundles/base.near/everything.dev/auth/plugin.manifest.json",
      );
      expect(res).toBe(fallthrough);
    } finally {
      await handle.uninstall();
      globalThis.fetch = originalFetch;
    }
  });
});

describe("installBundleFetchFromEnv", () => {
  const originalFetch = globalThis.fetch;
  const { BOS_BUNDLE_DIR, BOS_ACCOUNT, BOS_GATEWAY } = process.env;

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (BOS_BUNDLE_DIR === undefined) delete process.env.BOS_BUNDLE_DIR;
    else process.env.BOS_BUNDLE_DIR = BOS_BUNDLE_DIR;
    if (BOS_ACCOUNT === undefined) delete process.env.BOS_ACCOUNT;
    else process.env.BOS_ACCOUNT = BOS_ACCOUNT;
    if (BOS_GATEWAY === undefined) delete process.env.BOS_GATEWAY;
    else process.env.BOS_GATEWAY = BOS_GATEWAY;
  });

  it("is inert without BOS_BUNDLE_DIR", () => {
    delete process.env.BOS_BUNDLE_DIR;
    expect(installBundleFetchFromEnv({ configPath: null })).toBeNull();
  });

  it("enables the foreign-namespace cache with an explicit cache dir and no staged bundle dir", async () => {
    delete process.env.BOS_BUNDLE_DIR;
    const cacheDir = mkdtempSync(join(tmpdir(), "bundle-cache-"));
    process.env.BOS_BUNDLE_CACHE_DIR = cacheDir;
    const originalFetch = globalThis.fetch;
    let failOrigin = false;
    globalThis.fetch = async () => {
      if (failOrigin) throw new Error("origin down");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const handle = installBundleFetchFromEnv({ configPath: null });
      expect(handle).not.toBeNull();
      const foreign =
        "https://base.everything.near/bundles/base.near/everything.dev/auth/plugin.manifest.json";
      const fresh = await fetch(foreign);
      expect(await fresh.json()).toEqual({ ok: true });
      failOrigin = true;
      const stale = await fetch(foreign);
      expect(stale.status).toBe(200);
      expect(stale.headers.get("x-bundle-cache")).toBe("stale");
      await handle!.uninstall();
      rmSync(cacheDir, { recursive: true, force: true });
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.BOS_BUNDLE_CACHE_DIR;
    }
  });

  it("derives the namespace from registry env, else config fields", () => {
    delete process.env.BOS_ACCOUNT;
    delete process.env.BOS_GATEWAY;
    process.env.BOS_BUNDLE_DIR = NAMESPACE.bundleDir;

    const configPath = mkdtempSync(join(tmpdir(), "bos-config-"));
    const configFile = join(configPath, "bos.config.json");
    writeFileSync(
      configFile,
      JSON.stringify({ account: NAMESPACE.account, domain: NAMESPACE.gateway }),
    );

    expect(installBundleFetchFromEnv({ configPath: configFile })).not.toBeNull();

    process.env.BOS_ACCOUNT = "registry.near";
    process.env.BOS_GATEWAY = "registry.dev";
    expect(installBundleFetchFromEnv({ configPath: configFile })).not.toBeNull();

    rmSync(configPath, { recursive: true, force: true });
  });

  it("is inert when the config has no identity fields", () => {
    delete process.env.BOS_ACCOUNT;
    delete process.env.BOS_GATEWAY;
    process.env.BOS_BUNDLE_DIR = NAMESPACE.bundleDir;
    const configPath = mkdtempSync(join(tmpdir(), "bos-config-"));
    const configFile = join(configPath, "bos.config.json");
    writeFileSync(configFile, "{}");
    expect(installBundleFetchFromEnv({ configPath: configFile })).toBeNull();
    rmSync(configPath, { recursive: true, force: true });
  });

  it("falls back to the registry tier when the identity namespace is not staged", async () => {
    stageFixture();
    delete process.env.BOS_ACCOUNT;
    delete process.env.BOS_GATEWAY;
    process.env.BOS_BUNDLE_DIR = NAMESPACE.bundleDir;
    process.env.BOS_ACCOUNT = "other.account.near";
    process.env.BOS_GATEWAY = "other.dev";

    const fallthrough = new Response("from-network", { status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => fallthrough;

    let notice = "";
    const originalWarn = console.warn;
    console.warn = (message: unknown) => {
      notice = String(message);
    };

    try {
      const handle = installBundleFetchFromEnv({ configPath: null });
      expect(handle).not.toBeNull();
      expect(notice).toContain("other.account.near/other.dev");
      const res = await fetch(
        "https://other.dev/bundles/other.account.near/other.dev/apps/plugin.manifest.json",
      );
      expect(res).toBe(fallthrough);
      await handle!.uninstall();
    } finally {
      console.warn = originalWarn;
      globalThis.fetch = originalFetch;
      delete process.env.BOS_ACCOUNT;
      delete process.env.BOS_GATEWAY;
    }
  });

  it("keeps the self-contained tier when the identity namespace is staged", async () => {
    stageFixture();
    process.env.BOS_BUNDLE_DIR = NAMESPACE.bundleDir;
    process.env.BOS_ACCOUNT = NAMESPACE.account;
    process.env.BOS_GATEWAY = NAMESPACE.gateway;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("from-network", { status: 200 });
    try {
      const handle = installBundleFetchFromEnv({ configPath: null });
      try {
        const res = await fetch(
          "https://citynode.app/bundles/v1.citynode.near/citynode.app/apps/plugin.manifest.json",
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(JSON.parse(manifestBody));
      } finally {
        await handle!.uninstall();
      }
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.BOS_ACCOUNT;
      delete process.env.BOS_GATEWAY;
    }
  });
});

describe("defaultConfigEnv", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  it("honors NODE_ENV for config resolution", () => {
    process.env.NODE_ENV = "production";
    expect(defaultConfigEnv()).toBe("production");
    process.env.NODE_ENV = "test";
    expect(defaultConfigEnv()).toBe("development");
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    expect(defaultConfigEnv()).toBe(
      originalNodeEnv === "production" ? "production" : "development",
    );
  });
});
