import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Layer } from "effect";
import { buildRuntimeConfigEffect, type ConfigVersionManifestError } from "everything-dev/config";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import { RuntimeSnapshot } from "../../src/services/runtime-snapshot";
import { adoptPublishedPointer } from "../../src/services/snapshot-coordinator";
import { createSsrRender } from "../../src/services/ssr-render";

/**
 * Swap-under-traffic (C7) — answers, with measurements, the questions the
 * hot-swap prototype (v2-platform-services/09) was chartered to measure:
 *
 *   in-flight drain vs shadow-flip
 *     → in-flight requests capture ONE snapshot state (config + serving
 *       caches together) and complete it fully; a swap shadow-flips readers
 *       with zero draining machinery.
 *   ESM disposal
 *     → the abandoned generation's compose graphs drop because the swap runs
 *       the previous state's `release` (cache clear) — the explicit disposal
 *       seam old ESM graphs need.
 *   leak measurement
 *     → repeated swaps keep exactly one live generation: the pre-warmed
 *       compose IS the serving compose (no double compose on adopt) and
 *       abandoned caches measure empty, not asserted-empty.
 */

const CORE_MANIFEST = {
  name: "ui",
  manifestVersion: 2,
  routes: [{ id: "_public", type: "layout", mount: "public", file: "_public.tsx" }],
};

const composeCount = { count: 0 };

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

// ---- fake CDN: per-generation hashed entries + the shared manifest --------

const entryBytes = (gen: number) => `console.log('web entry gen ${gen}');`;
const ssrEntryBytes = (gen: number) => `console.log('ssr entry gen ${gen}');`;
const sriOf = (bytes: string) => `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

const fakeCdnFetch = async (input: string | URL | Request): Promise<Response> => {
  const url = String(input);
  const genMatch = url.match(/gen-(\d+)/);
  if (url.endsWith("/manifest.gen.json")) {
    return new Response(JSON.stringify(CORE_MANIFEST), { status: 200 });
  }
  if (genMatch) {
    const gen = Number(genMatch[1]);
    const bytes = url.includes("server") ? ssrEntryBytes(gen) : entryBytes(gen);
    return new Response(bytes, { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

// ---- generations -----------------------------------------------------------

const assetBaseUrl = "http://cdn.invalid";

const genConfig = (gen: number): RuntimeConfig =>
  ({
    env: "production",
    account: "v1.citynode.near",
    domain: "citynode.app",
    networkId: "mainnet",
    host: {
      name: "host",
      url: `${assetBaseUrl}/host`,
      entry: `${assetBaseUrl}/host/mf-manifest.json`,
      source: "remote",
    },
    ui: {
      name: "ui",
      url: `${assetBaseUrl}/ui`,
      entry: `${assetBaseUrl}/ui/mf-manifest.json`,
      entryUrl: `${assetBaseUrl}/ui/remoteEntry.gen-${gen}.js`,
      source: "remote",
      integrity: sriOf(entryBytes(gen)),
      ssrUrl: `${assetBaseUrl}/ui-ssr`,
      ssrEntryUrl: `${assetBaseUrl}/ui-ssr/remoteEntry.server.gen-${gen}.js`,
      ssrIntegrity: sriOf(ssrEntryBytes(gen)),
    },
    api: {
      name: "api",
      url: `${assetBaseUrl}/api/`,
      entry: `${assetBaseUrl}/api/mf-manifest.json`,
      source: "remote",
    },
    plugins: {},
  }) as unknown as RuntimeConfig;

const publishedPointer = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    ui: {
      development: "local:ui",
      production: `${assetBaseUrl}/ui/`,
      pin: { manifest: "versions/x.json", integrity: "sha384-slot-pin" },
    },
  },
} as unknown as BosConfig;

// ---- composition engine: real composeUi, counted constructTree -------------

const mockCompositionSucceeds = () => {
  loadUiComposeModuleMock.mockReturnValue(
    Effect.succeed({
      constructTree: async (input: {
        plugins: ReadonlyArray<{ key: string; mfName?: string }>;
        resolve: (ref: { key: string }) => Promise<{ manifest: unknown }>;
      }) => {
        composeCount.count += 1;
        const resolved = [];
        for (const ref of input.plugins) resolved.push(await input.resolve(ref));
        const { digestOf } = await import("everything-dev/ui/manifest");
        return {
          rootRoute: { id: "composed-tree" },
          routeTree: { id: "composed-tree" },
          nav: { items: [], generation: composeCount.count },
          manifests: [CORE_MANIFEST],
          digest: await digestOf({
            plugins: input.plugins.map((p) => ({ key: p.key, mfName: p.mfName ?? p.key })),
            manifests: resolved.map((r) => r.manifest),
          }),
        };
      },
    }),
  );
  loadCoreUiRouteConfigMock.mockReturnValue(
    Effect.succeed({ routeConfigLoaders: {}, rootMeta: undefined }),
  );
  loadRouterModuleMock.mockReturnValue(Effect.succeed(makeRouterModule()));
};

const makeRouterModule = () => ({
  renderToStream: async (_request: Request, options: { pluginNav?: { generation?: number } }) => {
    entered();
    if (gate) await gate;
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`gen=${options.pluginNav?.generation}`));
          controller.close();
        },
      }),
      statusCode: 200,
      headers: new Headers(),
    };
  },
  getRouteHead: vi.fn(),
  createRouter: vi.fn(),
});

// ---- gate for parking an in-flight request mid-render ----------------------

let gate: Promise<void> | null = null;
let releaseGate: () => void = () => {};
let entered: () => void = () => {};

const setGate = () => {
  gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
};

const snapshotLayer = RuntimeSnapshot.layer().pipe(
  Layer.provide(Layer.succeed(ConfigService, genConfig(0))),
);

describe("swap under traffic (C7: shadow-flip, ESM disposal, leak measurement)", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(fakeCdnFetch) as unknown as typeof fetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("an in-flight request completes fully old-snapshot, the pre-warmed compose IS the serving compose, and abandoned generations measure empty", async () => {
    mockCompositionSucceeds();
    let derivedGen = 0;
    buildRuntimeConfigMock.mockImplementation(() => Effect.succeed(genConfig(derivedGen)));

    let servingCaptures = 0;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const effectContext = yield* Effect.context();
        const snapshot = yield* RuntimeSnapshot;
        const bootState = yield* snapshot.get;
        const bootFingerprint = bootState.fingerprint;

        const render = createSsrRender({
          config: genConfig(0),
          getServingState: () => {
            servingCaptures += 1;
            return Effect.runPromiseWith(effectContext)(snapshot.get);
          },
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

        const request = new Request("https://citynode.app/", {
          headers: { host: "citynode.app" },
        });
        const ctx = { session: null, user: null, pluginContext: {} } as never;
        const doRequest = () => render(request, ctx).then((r) => r.text());

        // warm the boot generation — compose #1 into the snapshot's cache
        const warm = yield* Effect.promise(doRequest);
        expect(warm).toBe("gen=1");
        expect(composeCount.count).toBe(1);
        expect(bootState.composeState.variants.size).toBe(1);

        // an in-flight request captures the boot state and parks mid-render
        setGate();
        const inFlight = doRequest();
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              entered = resolve;
            }),
        );

        // adopt under traffic: pre-warm composes into the NEXT state's own
        // cache (compose #2), then the swap flips readers — no drain
        derivedGen = 1;
        const outcome = yield* adoptPublishedPointer({
          snapshot,
          publishedConfig: publishedPointer,
        });
        expect(outcome.status).toBe("swapped");

        // release the park — the in-flight request completes FULLY old-snapshot
        releaseGate();
        const inFlightBody = yield* Effect.promise(() => inFlight);
        expect(inFlightBody).toBe("gen=1");

        // the post-swap request is served from the PRE-WARMED state — zero
        // additional compose work (no double compose on adopt)
        const afterSwap = yield* Effect.promise(doRequest);
        expect(afterSwap).toBe("gen=2");
        expect(composeCount.count).toBe(2);

        // leak measurement: the abandoned generation's caches measured empty
        expect(bootState.composeState.variants.size).toBe(0);
        expect(bootState.composeState.remoteManifests.size).toBe(0);
        expect(bootState.clientConfigState.entries.size).toBe(0);

        // the serving state is the adopted one — fully new coordinates
        const adopted = yield* snapshot.get;
        expect(adopted.fingerprint).not.toBe(bootFingerprint);
        expect(adopted.config.ui.integrity).toBe(sriOf(entryBytes(1)));

        // repeated swaps keep exactly one live generation
        const generation1 = adopted;
        derivedGen = 2;
        yield* adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer });
        const afterSecondSwap = yield* Effect.promise(doRequest);
        expect(afterSecondSwap).toBe("gen=3");
        expect(composeCount.count).toBe(3);
        expect(generation1.composeState.variants.size).toBe(0);
        expect(generation1.clientConfigState.entries.size).toBe(0);
        expect((yield* snapshot.get).composeState.variants.size).toBe(1);

        return servingCaptures;
      }).pipe(Effect.provide(snapshotLayer)),
    );

    // one serving capture per request: warm, in-flight, post-swap, second
    // post-swap — config + caches always move together (torn-proof by capture)
    expect(result).toBe(4);
  });

  it("a failed adopt leaves the serving caches untouched (no release, no warm loss)", async () => {
    mockCompositionSucceeds();
    buildRuntimeConfigMock.mockReturnValueOnce(
      Effect.fail(
        new Error("version manifest fetch failed") as unknown as ConfigVersionManifestError,
      ),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        before.composeState.variants.set("live", {
          variant: {} as never,
          staleAfter: Number.POSITIVE_INFINITY,
        });
        const exit = yield* Effect.exit(
          adoptPublishedPointer({ snapshot, publishedConfig: publishedPointer }),
        );
        return { before, exit, after: yield* snapshot.get };
      }).pipe(Effect.provide(snapshotLayer)),
    );
    if (!Exit.isFailure(result.exit)) throw new Error("expected adopt failure");
    const squashed = Cause.squash(result.exit.cause);
    expect((squashed as Error).message).toContain("version manifest fetch failed");
    expect(result.after).toBe(result.before);
    expect(result.before.composeState.variants.get("live")).toBeDefined();
  });
});
