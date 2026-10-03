import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFederationCompat } from "../../src/mf";
import type { BosConfig } from "../../src/types";

const HOST_URL = "https://host.example";
const API_URL = "https://api.example";
const AUTH_URL = "https://auth.example";
const APPS_URL = "https://apps.example";

const HOST_MANIFEST = {
  metaData: { pluginVersion: "2.8.2" },
  shared: [
    { name: "zod", version: "4.4.3", requiredVersion: "^4.4.3", singleton: true },
    { name: "effect", version: "3.21.2", requiredVersion: "^3.21.2", singleton: true },
    { name: "@orpc/server", version: "1.14.3", requiredVersion: "^1.14.3", singleton: true },
  ],
};

function manifest(version: string, extraShared: Array<{ name: string; version: string }> = []) {
  return {
    metaData: { pluginVersion: version },
    shared: [...HOST_MANIFEST.shared, ...extraShared],
  };
}

function replyWith(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockManifests(byUrlPattern: Array<[RegExp, unknown]>) {
  globalThis.fetch = vi.fn(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, body] of byUrlPattern) {
      if (pattern.test(url)) return replyWith(body);
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

function bosConfig(overrides?: Partial<BosConfig>): BosConfig {
  return {
    account: "x",
    app: {
      host: { development: "local:host", production: HOST_URL },
      ui: { production: "https://ui.example" },
      api: { development: "local:api", production: API_URL },
      auth: { development: "local:plugins/auth", production: AUTH_URL },
    },
    plugins: {
      apps: { development: "local:plugins/apps", production: APPS_URL },
    },
    ...overrides,
  } as BosConfig;
}

describe("checkFederationCompat", () => {
  it("returns ok:true when all remotes match host pluginVersion and shared versions satisfy", async () => {
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, manifest("2.8.2")],
      [/auth\.example/, manifest("2.8.2")],
      [/apps\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.hostVersion).toBe("2.8.2");
    expect(report.ok).toBe(true);
    expect(report.remotes.every((r) => r.ok && r.reachable)).toBe(true);
  });

  it("flags pluginVersion mismatch on a single remote", async () => {
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, manifest("2.8.2")],
      [/auth\.example/, manifest("2.5.1")],
      [/apps\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const auth = report.remotes.find((r) => r.role === "auth");
    expect(auth?.ok).toBe(false);
    expect(auth?.pluginVersion).toBe("2.5.1");
    expect(auth?.reason).toMatch(/expected pluginVersion=2\.8\.2/i);
  });

  it("flags missing shared dep required by host", async () => {
    const apiMissingShared = {
      metaData: { pluginVersion: "2.8.2" },
      shared: [{ name: "zod", version: "4.4.3", requiredVersion: null, singleton: true }],
    };
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, apiMissingShared],
      [/auth\.example/, manifest("2.8.2")],
      [/apps\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const api = report.remotes.find((r) => r.role === "api");
    expect(api?.ok).toBe(false);
    expect(api?.reason).toMatch(/missing shared/i);
  });

  it("flags shared dep with version below host requiredVersion range", async () => {
    const apiTooOld = {
      metaData: { pluginVersion: "2.8.2" },
      shared: [
        { name: "zod", version: "4.4.3", requiredVersion: null, singleton: true },
        { name: "effect", version: "3.10.0", requiredVersion: null, singleton: true },
        { name: "@orpc/server", version: "1.14.3", requiredVersion: null, singleton: true },
      ],
    };
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, apiTooOld],
      [/auth\.example/, manifest("2.8.2")],
      [/apps\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const api = report.remotes.find((r) => r.role === "api");
    expect(api?.ok).toBe(false);
    expect(api?.reason).toMatch(/effect.*remote=3\.10\.0/);
  });

  it("flags exact-version skew on a critical dep even when the semver range is satisfied", async () => {
    const hostRcManifest = {
      metaData: { pluginVersion: "2.8.2" },
      shared: [
        { name: "zod", version: "4.4.3", requiredVersion: "^4.4.3", singleton: true },
        {
          name: "effect",
          version: "4.0.0-rc.112",
          requiredVersion: "^4.0.0-rc.112",
          singleton: true,
        },
        {
          name: "@orpc/server",
          version: "1.14.3",
          requiredVersion: "^1.14.3",
          singleton: true,
        },
      ],
    };
    const rcSkew = {
      metaData: { pluginVersion: "2.8.2" },
      shared: [
        { name: "zod", version: "4.4.3", requiredVersion: "^4.4.3", singleton: true },
        {
          name: "effect",
          version: "4.0.0-rc.120",
          requiredVersion: "^4.0.0-rc.112",
          singleton: true,
        },
        {
          name: "@orpc/server",
          version: "1.14.3",
          requiredVersion: "^1.14.3",
          singleton: true,
        },
      ],
    };
    mockManifests([
      [/host\.example/, hostRcManifest],
      [/api\.example/, manifest("2.8.2")],
      [/auth\.example/, rcSkew],
      [
        /apps\.example/,
        {
          metaData: { pluginVersion: "2.8.2" },
          shared: hostRcManifest.shared,
        },
      ],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const auth = report.remotes.find((r) => r.role === "auth");
    expect(auth?.ok).toBe(false);
    expect(auth?.reason).toMatch(/effect[\s\S]*exact-version skew/i);
  });

  it("passes when critical shared versions match exactly", async () => {
    const shared = [
      {
        name: "effect",
        version: "4.0.0-rc.112",
        requiredVersion: "4.0.0-rc.112",
        singleton: true,
      },
      {
        name: "@orpc/server",
        version: "1.14.3",
        requiredVersion: "1.14.3",
        singleton: true,
      },
    ];
    mockManifests([
      [/host\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/api\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/auth\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/apps\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(true);
    expect(report.remotes.every((r) => r.ok)).toBe(true);
  });

  it("passes when a caret constraint matches the exact prerelease", async () => {
    const shared = [
      {
        name: "effect",
        version: "4.0.0-rc.112",
        requiredVersion: "^4.0.0-rc.112",
        singleton: true,
      },
      {
        name: "@orpc/server",
        version: "1.14.3",
        requiredVersion: "^1.14.3",
        singleton: true,
      },
    ];
    mockManifests([
      [/host\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/api\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/auth\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
      [/apps\.example/, { metaData: { pluginVersion: "2.8.2" }, shared }],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(true);
  });

  it("fails when a critical dep's remote version is below the caret prerelease", async () => {
    const hostShared = [
      {
        name: "effect",
        version: "4.0.0-rc.112",
        requiredVersion: "^4.0.0-rc.112",
        singleton: true,
      },
    ];
    const staleShared = [
      {
        name: "effect",
        version: "4.0.0-rc.110",
        requiredVersion: "^4.0.0-rc.110",
        singleton: true,
      },
    ];
    mockManifests([
      [/host\.example/, { metaData: { pluginVersion: "2.8.2" }, shared: hostShared }],
      [/api\.example/, { metaData: { pluginVersion: "2.8.2" }, shared: hostShared }],
      [/auth\.example/, { metaData: { pluginVersion: "2.8.2" }, shared: staleShared }],
      [/apps\.example/, { metaData: { pluginVersion: "2.8.2" }, shared: hostShared }],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const auth = report.remotes.find((r) => r.role === "auth");
    expect(auth?.ok).toBe(false);
    expect(auth?.reason).toMatch(/effect/);
  });

  it("treats unreachable remote as failure and reports reason", async () => {
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, manifest("2.8.2")],
      [/auth\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.ok).toBe(false);
    const apps = report.remotes.find((r) => r.role === "apps");
    expect(apps?.reachable).toBe(false);
    expect(apps?.reason).toBeDefined();
  });

  it("returns ok:true with empty remotes when no host production URL is configured", async () => {
    const cfg = bosConfig();
    (cfg.app as any).host = { development: "local:host" };
    const report = await checkFederationCompat(cfg);
    expect(report.ok).toBe(true);
    expect(report.remotes).toEqual([]);
  });

  it("does not include ui slot in remotes (browser-loaded, not host-side federation)", async () => {
    mockManifests([
      [/host\.example/, HOST_MANIFEST],
      [/api\.example/, manifest("2.8.2")],
      [/auth\.example/, manifest("2.8.2")],
      [/apps\.example/, manifest("2.8.2")],
    ]);

    const report = await checkFederationCompat(bosConfig(), { timeoutMs: 5_000 });

    expect(report.remotes.map((r) => r.role)).not.toContain("ui");
    expect(report.remotes.map((r) => r.role).toSorted()).toEqual(["api", "apps", "auth"]);
  });
});
