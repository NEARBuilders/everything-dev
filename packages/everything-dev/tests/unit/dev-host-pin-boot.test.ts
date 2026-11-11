import { createHash } from "node:crypto";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedManifestDocumentUrl } from "../../src/services/deploy/version-manifest";
import { OrchestratorError, spawnRemoteHost } from "../../src/services/dev/orchestrator";
import { DevRuntimeConfigLive } from "../../src/services/dev/service-descriptor";
import type { RuntimeConfig } from "../../src/types";

const HOST_BASE = "http://cdn.example/bundles/dev.everything.near/everything.dev/host";

const registerRemoteCalls: Array<{ name: string; entry: string }> = [];
let loadRemoteFailure: Error | null = null;

vi.mock("../../src/services/federation/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/federation/service")>();
  return {
    ...actual,
    registerRemote: async (input: { name: string; entry: string }) => {
      registerRemoteCalls.push(input);
    },
    loadRemoteModule: async () => {
      if (loadRemoteFailure) throw loadRemoteFailure;
      return {
        runServer: () => ({
          ready: Promise.resolve(),
          shutdown: async () => {},
        }),
      };
    },
  };
});

const manifestFetches: string[] = [];

vi.mock("../../src/utils/http-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/http-client")>();
  return {
    ...actual,
    fetchWithRetryEff: (url: string) => {
      manifestFetches.push(url);
      return Effect.succeed({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          metaData: { pluginVersion: "9.9.9-test" },
          exposes: {},
          shared: [],
        }),
      });
    },
  };
});

vi.mock("../../src/services/platform/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/platform/manifest")>();
  return {
    ...actual,
    readInImagePlatformManifest: () => ({
      frameworkVersion: "2.0.0-rc.42",
    }),
  };
});

const callbacks = {
  onStatus: () => {},
  onLog: () => {},
};

function runtimeConfig(input: {
  env?: "development" | "production";
  digest?: { manifest: string; integrity: string };
}): RuntimeConfig {
  return {
    env: input.env ?? "production",
    account: "child.near",
    networkId: "mainnet",
    host: {
      name: "host",
      url: "http://127.0.0.1:3000",
      entry: `${HOST_BASE}/mf-manifest.json`,
      source: "remote",
      remoteUrl: HOST_BASE,
      integrity: "sha384-dW50cmFuc2NyaWJlZA==",
      ...(input.digest ? { digest: input.digest } : {}),
    },
    ui: {
      name: "ui",
      url: "http://127.0.0.1:3003",
      entry: "/mf-manifest.json",
      source: "local",
    },
    api: {
      name: "api",
      url: "http://127.0.0.1:3001",
      entry: "/mf-manifest.json",
      source: "local",
    },
  } as unknown as RuntimeConfig;
}

const descriptor = {
  key: "host",
  source: "remote",
  url: HOST_BASE,
  remoteUrl: HOST_BASE,
  entry: `${HOST_BASE}/mf-manifest.json`,
  name: "host",
  readinessPath: "/health",
  defaultPort: 3000,
} as Parameters<typeof spawnRemoteHost>[0];

/** The immutable version document the pin's digest attests — the served
 * bytes hash to the SRI the pin carries, so the verify engine accepts it. */
const VERSION_DIR = "versions/0123456789abcdef";
const versionDocument = JSON.stringify({
  version: "0123456789abcdef",
  entry: "remoteEntry.0123abcd.js",
  entryIntegrity: "sha384-dW50cmFuc2NyaWJlZA==",
  dir: VERSION_DIR,
});
const pinIntegrity = `sha384-${createHash("sha384").update(versionDocument).digest("base64")}`;

const fetchVersionDocument = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(versionDocument),
      text: async () => versionDocument,
      json: async () => JSON.parse(versionDocument),
    })),
  );

const fetchUnavailable = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => Buffer.from(""),
      text: async () => "",
    })),
  );

beforeEach(() => {
  registerRemoteCalls.length = 0;
  manifestFetches.length = 0;
  loadRemoteFailure = null;
  delete process.env.BOS_BUNDLE_DIR;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pinnedManifestDocumentUrl", () => {
  const base = "http://cdn.example/bundles/parent/host";
  const resolved = {
    base,
    dir: "versions/abcdef0123456789",
  };

  it("prefers the hashed manifest copy — immutable in both CDN and staged layouts", () => {
    expect(
      pinnedManifestDocumentUrl(`${base}/mf-manifest.json`, {
        ...resolved,
        browserManifestUrl: `${base}/versions/abcdef0123456789/mf-manifest.deadbeef12345678.json`,
      }),
    ).toBe(`${base}/versions/abcdef0123456789/mf-manifest.deadbeef12345678.json`);
  });

  it("prefixes the pin's immutable version dir on the CDN layout", () => {
    expect(pinnedManifestDocumentUrl(`${base}/mf-manifest.json`, resolved)).toBe(
      `${base}/versions/abcdef0123456789/mf-manifest.json`,
    );
  });

  it("keeps the staged flat layout under BOS_BUNDLE_DIR", () => {
    process.env.BOS_BUNDLE_DIR = "/app/.bos/bundles";
    expect(pinnedManifestDocumentUrl(`${base}/mf-manifest.json`, resolved)).toBe(
      `${base}/mf-manifest.json`,
    );
  });

  it("falls back to the fixed name for legacy pins (no dir, no hashed copy)", () => {
    expect(pinnedManifestDocumentUrl(`${base}/mf-manifest.json`, { base })).toBe(
      `${base}/mf-manifest.json`,
    );
  });
});

/** The library-blessed failure accessor — no Cause-shape walking, no
 * toJSON guessing; Exit.findError returns the first fail-reason error. */
const failureOf = (exit: Exit<unknown, unknown>): OrchestratorError | undefined => {
  const found = Exit.findError(exit);
  return found._tag === "Success" ? (found.success as OrchestratorError) : undefined;
};

const dumpCause = (exit: unknown): string =>
  JSON.stringify(exit, (_, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message } : value,
  );

describe("spawnRemoteHost — the #874 replay: a root publish must not move a pinned child's host bytes", () => {
  it("registers the host manifest from the pin's immutable version dir, not the mutable slot root", async () => {
    fetchVersionDocument();
    await Effect.runPromise(
      spawnRemoteHost(descriptor, callbacks).pipe(
        Effect.provide(
          DevRuntimeConfigLive(
            runtimeConfig({ digest: { manifest: "versions/v1.json", integrity: pinIntegrity } }),
          ),
        ),
      ),
    );

    expect(manifestFetches).toEqual([`${HOST_BASE}/${VERSION_DIR}/mf-manifest.json`]);
    expect(registerRemoteCalls).toEqual([
      { name: "host", entry: `${HOST_BASE}/${VERSION_DIR}/mf-manifest.json` },
    ]);
  });

  it("prefers the pin's hashed manifest copy when the build emitted one", async () => {
    const doc = JSON.stringify({
      version: "0123456789abcdef",
      entry: "remoteEntry.0123abcd.js",
      entryIntegrity: "sha384-dW50cmFuc2NyaWJlZA==",
      dir: VERSION_DIR,
      browserManifest: {
        file: "mf-manifest.deadbeef12345678.json",
        integrity: "sha384-dW50cmFuc2NyaWJlZA==",
      },
    });
    const sri = `sha384-${createHash("sha384").update(doc).digest("base64")}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from(doc),
        text: async () => doc,
        json: async () => JSON.parse(doc),
      })),
    );
    await Effect.runPromise(
      spawnRemoteHost(descriptor, callbacks).pipe(
        Effect.provide(
          DevRuntimeConfigLive(
            runtimeConfig({ digest: { manifest: "versions/v1.json", integrity: sri } }),
          ),
        ),
      ),
    );

    expect(manifestFetches).toEqual([
      `${HOST_BASE}/${VERSION_DIR}/mf-manifest.deadbeef12345678.json`,
    ]);
  });

  it("keeps the slot-root fixed name for unpinned dev boots", async () => {
    await Effect.runPromise(
      spawnRemoteHost(descriptor, callbacks).pipe(
        Effect.provide(DevRuntimeConfigLive(runtimeConfig({ env: "development" }))),
      ),
    );

    expect(manifestFetches).toEqual([`${HOST_BASE}/mf-manifest.json`]);
  });

  it("fails loud with the pin named when the pinned manifest cannot resolve in production", async () => {
    fetchUnavailable();
    const exit = await Effect.runPromiseExit(
      spawnRemoteHost(descriptor, callbacks).pipe(
        Effect.provide(
          DevRuntimeConfigLive(
            runtimeConfig({ digest: { manifest: "versions/v1.json", integrity: "sha384-abcd" } }),
          ),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
    const failure = failureOf(exit);
    expect(failure, dumpCause(exit)).toBeInstanceOf(OrchestratorError);
    expect(failure?.message).toContain("resolve host pin");
    expect(failure?.message).toContain("versions/v1.json");
    expect(registerRemoteCalls).toEqual([]);
  });

  it("names the release skew when the pinned host's shared singletons cannot resolve in the image", async () => {
    fetchVersionDocument();
    loadRemoteFailure = new Error(
      `Could not resolve shared dependency "effect". Looked in:\n  - require.resolve("effect")`,
    );
    const exit = await Effect.runPromiseExit(
      spawnRemoteHost(descriptor, callbacks).pipe(
        Effect.provide(
          DevRuntimeConfigLive(
            runtimeConfig({ digest: { manifest: "versions/v1.json", integrity: pinIntegrity } }),
          ),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
    const failure = failureOf(exit);
    const message = failure?.message ?? "";
    expect(message, dumpCause(exit)).toContain("Could not resolve shared dependency");
    expect(message).toContain("Host release skew");
    expect(message).toContain("2.0.0-rc.42");
    expect(message).toContain("versions/v1.json");
    expect(message).toContain("bos upgrade && bos deploy");
  });
});
