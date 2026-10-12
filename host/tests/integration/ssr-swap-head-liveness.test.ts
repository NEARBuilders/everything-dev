import path from "node:path";
import { createInstance } from "@module-federation/enhanced/runtime";
import { Effect, Layer } from "effect";
import { buildRuntimeConfigEffect } from "everything-dev/config";
import { patchManifestFetchForSsrPublicPath } from "everything-dev/mf";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import { adoptPublishedPointer } from "../../src/services/snapshot-coordinator";
import { createSsrRender } from "../../src/services/ssr-render";
import { type StaticDistServer, startStaticDistServer } from "../helpers/static-dist-server";

/**
 * Full-host head/nonce liveness across a serving swap: REAL composeUi +
 * createSsrRender + snapshot adopt, with the real ui exposes loaded through
 * generation-addressed federation containers (gen0 = local-flavored URLs,
 * gen1 = cdn-flavored URLs — the SnapshotWatch adopt shape). Every response's
 * head must be generated from ITS request's inputs: fresh CSP nonce, fresh
 * assets URL. A response whose head carries the previous generation's config
 * or nonce silently breaks CSP (every script blocked) and hangs the page.
 */

const HOST_URL = "http://localhost:4100";
const NONCE_A = "bm9uY2UtYQ==";
const NONCE_B = "bm9uY2UtYg==";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

let serverA: StaticDistServer;
let serverB: StaticDistServer;

const genConfig = (base: string): RuntimeConfig =>
  ({
    env: "production",
    account: "dev.everything.near",
    domain: "everything.dev",
    networkId: "mainnet",
    title: "everything.dev",
    host: {
      name: "host",
      url: HOST_URL,
      entry: `${base}/host/mf-manifest.json`,
      source: "remote",
    },
    ui: {
      name: "ui",
      url: base,
      entry: `${base}/mf-manifest.json`,
      entryUrl: `${base}/remoteEntry.js`,
      source: "remote",
      ssrUrl: base,
      ssrEntryUrl: `${base}/ssr/mf-manifest.json`,
    },
    api: {
      name: "api",
      url: `${base}/api/`,
      entry: `${base}/api/mf-manifest.json`,
      source: "remote",
    },
    plugins: {},
  }) as unknown as RuntimeConfig;

// ---- federation: one composition instance, generation-addressed containers --

let mf: ReturnType<typeof createInstance> | null = null;
const loadedEntryByRemote = new Map<string, string>();

function useGeneration(base: string) {
  const entry = `${base}/ssr/mf-manifest.json`;
  if (!mf) {
    mf = createInstance({
      name: "ssr-swap-host",
      remotes: [{ name: "ui", entry, alias: "ui" }],
    });
    patchManifestFetchForSsrPublicPath(mf as never);
    loadedEntryByRemote.set("ui", entry);
    return;
  }
  const previous = loadedEntryByRemote.get("ui");
  if (previous === entry) return;
  const remoteHandler = (
    mf as unknown as { remoteHandler?: { removeRemote?: (remote: unknown) => void } }
  ).remoteHandler;
  const registered = (mf as unknown as { options: { remotes: Array<unknown> } }).options.remotes;
  for (const remote of registered) remoteHandler?.removeRemote?.(remote);
  (mf as never as { registerRemotes: (remotes: Array<unknown>) => void }).registerRemotes([
    { name: "ui", entry, alias: "ui" },
  ]);
  loadedEntryByRemote.set("ui", entry);
  (mf as unknown as { moduleCache?: Map<string, unknown> }).moduleCache?.delete("ui");
}

const loadExpose = async <T>(expose: string, unwrapDefault: boolean): Promise<T> => {
  if (!mf) throw new Error("federation instance not initialized");
  await (
    mf as unknown as { initializeSharing?: (scope: string) => Promise<unknown> }
  ).initializeSharing?.("default");
  const mod = await (
    mf as never as { loadRemote: (id: string, o: object) => Promise<unknown> }
  ).loadRemote(`ui/${expose.replace(/^\.\//, "")}`, { from: "build" });
  const resolved = mod as { default?: unknown };
  return (unwrapDefault ? resolved?.default : (mod as T)) as T;
};

// ---- mocks: route the real loaders through the generation-addressed instance

const { loadUiComposeModuleMock, loadCoreUiRouteConfigMock, loadRouterModuleMock } = vi.hoisted(
  () => ({
    loadUiComposeModuleMock: vi.fn(),
    loadCoreUiRouteConfigMock: vi.fn(),
    loadRouterModuleMock: vi.fn(),
  }),
);

vi.mock("../../src/services/federation.server", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/federation.server")>(
    "../../src/services/federation.server",
  );
  return {
    ...actual,
    loadUiComposeModule: loadUiComposeModuleMock,
    loadCoreUiRouteConfig: loadCoreUiRouteConfigMock,
    loadRouterModule: loadRouterModuleMock,
  };
});

const buildRuntimeConfigMock = vi.mocked(buildRuntimeConfigEffect);

vi.mock("everything-dev/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("everything-dev/config")>();
  return { ...actual, buildRuntimeConfigEffect: vi.fn() };
});

vi.mock("../../src/services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const wireRealLoaders = () => {
  loadUiComposeModuleMock.mockImplementation(() =>
    Effect.tryPromise({
      try: () => loadExpose("compose", false),
      catch: (cause: unknown) => new Error(`compose load failed: ${String(cause)}`),
    }),
  );
  loadCoreUiRouteConfigMock.mockImplementation(() =>
    Effect.tryPromise({
      try: () => loadExpose("routeConfig", false),
      catch: (cause: unknown) => new Error(`routeConfig load failed: ${String(cause)}`),
    }),
  );
  loadRouterModuleMock.mockImplementation(() =>
    Effect.tryPromise({
      try: () => loadExpose("Router", true),
      catch: (cause: unknown) => new Error(`Router load failed: ${String(cause)}`),
    }),
  );
};

// ---- assertions helpers ------------------------------------------------------

async function consumeStream(stream: ReadableStream | null | undefined): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

function scriptNonceAttrs(html: string): string[] {
  return [...html.matchAll(/<script[^>]*\bnonce="([^"]+)"/g)].map((m) => m[1]!);
}

function cspNonceInBootstrap(html: string): string | undefined {
  return html.match(/window\.__CSP_NONCE__="([^"]*)"/)?.[1];
}

function runtimeConfigInBootstrap(html: string): { assetsUrl?: string } | undefined {
  const raw = html.match(/window\.__RUNTIME_CONFIG__=(\{.*?\});\s*\n?\s*function __hydrate/s)?.[1];
  return raw ? (JSON.parse(raw) as { assetsUrl?: string }) : undefined;
}

// ---- the test -----------------------------------------------------------------

describe("SSR head liveness across a serving swap (full host pipeline)", () => {
  beforeAll(async () => {
    const { ensureUiServerDistBuild } = await import("../helpers/bundled-ssr-module");
    await ensureUiServerDistBuild();
    const distDir = path.join(workspaceRoot, "ui", "dist");
    serverA = await startStaticDistServer(distDir);
    serverB = await startStaticDistServer(distDir);
    useGeneration(serverA.baseUrl);
    wireRealLoaders();
  });

  afterAll(async () => {
    if (mf) {
      const remoteHandler = (
        mf as unknown as { remoteHandler?: { removeRemote?: (remote: unknown) => void } }
      ).remoteHandler;
      const registered = (mf as unknown as { options: { remotes: Array<unknown> } }).options
        .remotes;
      for (const remote of registered) remoteHandler?.removeRemote?.(remote);
    }
    mf = null;
    await Promise.allSettled([serverA?.stop(), serverB?.stop()]);
  });

  it("the post-swap render emits only the new generation's nonce and assets", async () => {
    let derivedBase = serverA.baseUrl;
    buildRuntimeConfigMock.mockImplementation(() => Effect.succeed(genConfig(derivedBase)));

    const snapshotLayer = RuntimeSnapshot.layer().pipe(
      Layer.provide(Layer.succeed(ConfigService, genConfig(serverA.baseUrl))),
    );

    const program = Effect.gen(function* () {
      const snapshot = yield* RuntimeSnapshot;
      const effectContext = yield* Effect.context();

      const makeRender = (nonce: string) => {
        const render = createSsrRender({
          config: genConfig(serverA.baseUrl),
          getServingState: () => Effect.runPromiseWith(effectContext)(snapshot.get),
          plugins: {
            runtime: null,
            auth: null,
            api: null,
            plugins: {},
            authClient: null,
            status: {
              available: false,
              error: null,
              errorDetails: null,
              failures: [],
              loadedPlugins: [],
            },
          } as never,
        });
        return async () => {
          const request = new Request(`${HOST_URL}/login`);
          const ctx = {
            session: null,
            user: null,
            pluginContext: {},
            cspNonce: nonce,
            cspHeader: null,
          } as never;
          const response = await render(request, ctx);
          return consumeStream(response.body);
        };
      };

      // warm + pre-swap render — head carries gen0 assets and its own nonce
      const renderA = makeRender(NONCE_A);
      const htmlWarm = yield* Effect.promise(renderA);
      expect(cspNonceInBootstrap(htmlWarm)).toBe(NONCE_A);
      expect(htmlWarm).toContain(serverA.baseUrl);

      // adopt the published (gen1) pointer — pre-warm + atomic swap
      derivedBase = serverB.baseUrl;
      const outcome = yield* adoptPublishedPointer({
        snapshot,
        publishedConfig: {
          account: "dev.everything.near",
          domain: "everything.dev",
          app: {
            ui: {
              development: "local:ui",
              production: `${serverB.baseUrl}/ui/`,
            },
          },
        } as unknown as BosConfig,
      });
      expect(outcome.status).toBe("swapped");

      // post-swap render — head must carry ONLY the new generation
      const renderB = makeRender(NONCE_B);
      const htmlB = yield* Effect.promise(renderB);

      expect(cspNonceInBootstrap(htmlB), "fresh per-request nonce required").toBe(NONCE_B);
      const attrs = scriptNonceAttrs(htmlB);
      expect(attrs.length).toBeGreaterThan(0);
      for (const nonce of attrs) {
        expect(nonce, "stale nonce from the previous generation leaked into the head").toBe(
          NONCE_B,
        );
      }
      expect(
        runtimeConfigInBootstrap(htmlB)?.assetsUrl,
        "post-swap head must embed the new generation's config",
      ).toBe(serverB.baseUrl);
      expect(htmlB).toContain(serverB.baseUrl);
      expect(
        htmlB,
        "post-swap head must not reference the previous generation's assets",
      ).not.toContain(serverA.baseUrl);
    });

    await Effect.runPromise(program.pipe(Effect.provide(snapshotLayer)));
  });
});
