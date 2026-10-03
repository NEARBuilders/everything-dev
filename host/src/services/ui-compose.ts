/**
 * Manifest composition for SSR (ADR 0008): manifests + route configs in →
 * host-built tree out, digest-cached per resolved config.
 *
 * Production: the core ui's `./compose` engine (executing inside the core
 * container's module graph — constructed routes are minted by the same
 * react/router instance that renders them) + `./routeConfig` import maps over
 * MF, plugin remotes as consumers (`import: false` — the core provides).
 * Local dev: the same modules imported from source — one module graph, one
 * React by construction, no MF in the server path.
 *
 * The digest covers plugin keys + MF names + manifests + the imported
 * MOUNT_REGISTRY_VERSION; deployment URLs are excluded so disk and prod
 * paths digest identically (hydration parity).
 */

import { readFileSync, statSync } from "node:fs";
import { Clock, Data, Effect } from "effect";
import {
  CORE_UI_PLUGIN_KEY as CORE_UI_KEY,
  type ComposePayload,
  type ConstructedTree,
  digestOf,
  type EntrySlot,
  entryUrls,
  MANIFEST_FILENAME,
  type NavManifest,
  type PluginManifest,
  PluginManifestSchema,
  type RouteConfigModule,
} from "everything-dev/ui/manifest";
import type { RouterModule } from "../types";
import { logger } from "../utils/logger";
import type { RuntimeConfig } from "./config";
import {
  type ComposeModule,
  loadCoreUiRouteConfig,
  loadRouterModule,
  loadUiComposeModule,
  loadUiRouteConfig,
  localUiRemoteEntry,
  resolveLocalRoot,
  waitForLocalContainer,
} from "./federation.server";

const MAX_COMPOSE_VARIANTS = 64;

export class ComposeDigestMismatchError extends Data.TaggedError("ComposeDigestMismatchError")<{
  readonly engineDigest: string;
  readonly manifestDigest: string;
}> {
  get message() {
    return `Digest mismatch between composition engine (${this.engineDigest}) and manifest inputs (${this.manifestDigest}) — refusing to serve a tree the client cannot reconstruct`;
  }
}
export interface ComposedUi {
  routerModule: RouterModule;
  routeTree: ConstructedTree["routeTree"];
  digest: string;
  nav: NavManifest;
  clientPayload: ComposePayload;
}

interface UiSource {
  key: string;
  mfName: string;
  remote?: EntrySlot;
  localRoot?: string;
  manifestUrl?: string;
  /** the MF browser manifest URL (mf-manifest.json — hashed when the slot
   * pins a version manifest); rides the compose payload for hydrate-time
   * remote registration */
  browserManifestUrl?: string;
  /** client-side web entry (browser remoteEntry.js) */
  webEntry?: string;
}

/**
 * SSR availability: a production SSR entry, or a local core ui with SSR
 * explicitly requested (`bos dev --ssr` → BOS_SSR=1 — source-composed dev,
 * no dedicated SSR servers). Off by default in dev; loud when requested.
 */
export function isSsrAvailable(config: RuntimeConfig): boolean {
  if (config.ui.ssrUrl) return true;
  return config.ui.source === "local" && process.env.BOS_SSR === "1";
}

export function uiSources(config: RuntimeConfig): UiSource[] {
  const coreUrls = entryUrls(config.ui, config.env);
  const sources: UiSource[] = [
    {
      key: CORE_UI_KEY,
      mfName: config.ui.name,
      remote: {
        name: config.ui.name,
        ssrUrl: config.ui.ssrUrl,
        ssrIntegrity: config.ui.ssrIntegrity,
        ssrEntryUrl: config.ui.ssrEntryUrl,
        localPath: config.ui.localPath,
      },
      localRoot:
        config.ui.source === "local" && config.ui.localPath
          ? resolveLocalRoot(config.ui.localPath)
          : undefined,
      manifestUrl:
        config.ui.source === "local"
          ? undefined
          : `${config.ui.url.replace(/\/$/, "")}/${MANIFEST_FILENAME}`,
      browserManifestUrl: coreUrls.browserManifest,
      webEntry: coreUrls.web,
    },
  ];
  for (const [id, plugin] of Object.entries(config.plugins ?? {})) {
    const ui = plugin?.ui;
    if (!ui) continue;
    if (ui.source !== "local" && !ui.url) {
      logger.warn(
        `[Compose] Plugin ui "${id}" has no production URL — skipping its routes. Deploy it with \`bos publish --deploy\`.`,
      );
      continue;
    }
    const urls = entryUrls(ui, config.env);
    sources.push({
      key: id,
      mfName: ui.name,
      remote: {
        name: ui.name,
        ssrUrl: ui.ssrUrl,
        ssrIntegrity: ui.ssrIntegrity,
        ssrEntryUrl: ui.ssrEntryUrl,
        localPath: ui.localPath,
      },
      localRoot: ui.localPath ? resolveLocalRoot(ui.localPath) : undefined,
      manifestUrl: `${ui.url.replace(/\/$/, "")}/${MANIFEST_FILENAME}`,
      browserManifestUrl: urls.browserManifest,
      webEntry: urls.web,
    });
  }
  return sources.sort((a, b) => a.key.localeCompare(b.key));
}

const MANIFEST_TTL_MS = 30_000;
const DEV_VARIANT_TTL_MS = 2_000;

interface CachedManifest {
  manifest: PluginManifest;
  fetchedAt: number;
}

interface CachedComposeVariant {
  variant: ComposedUi;
  staleAfter: number;
}

export interface UiComposeCacheState {
  remoteManifests: Map<string, CachedManifest>;
  variants: Map<string, CachedComposeVariant>;
}

export function createUiComposeCacheState(): UiComposeCacheState {
  return { remoteManifests: new Map(), variants: new Map() };
}

const runFetch = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init);

const loadRemoteManifestCached = (
  source: UiSource,
  manifestUrl: string,
  cache: UiComposeCacheState,
): Effect.Effect<PluginManifest, Error> =>
  Effect.gen(function* () {
    const cached = cache.remoteManifests.get(source.key);
    const now = yield* Clock.currentTimeMillis;
    if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached.manifest;
    }
    const fresh = yield* Effect.tryPromise(async () => {
      const response = await runFetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`manifest fetch ${response.status} for ${manifestUrl}`);
      }
      return PluginManifestSchema.parse(await response.json()) satisfies PluginManifest;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (cached?.manifest) {
            yield* Effect.logWarning(
              `[Compose] Manifest fetch failed for "${source.key}" (${error.message}); using last-good snapshot`,
            );
            return cached.manifest;
          }
          return yield* error;
        }),
      ),
    );
    cache.remoteManifests.set(source.key, { manifest: fresh, fetchedAt: now });
    return fresh;
  });

const loadManifest = (
  source: UiSource,
  cache: UiComposeCacheState,
): Effect.Effect<PluginManifest, Error> => {
  if (source.localRoot) {
    return Effect.try(() =>
      PluginManifestSchema.parse(
        JSON.parse(readFileSync(`${source.localRoot}/src/${MANIFEST_FILENAME}`, "utf8")),
      ),
    );
  }
  if (!source.manifestUrl) {
    return Effect.fail(new Error(`Ui source "${source.key}" has no manifest location`));
  }
  return loadRemoteManifestCached(source, source.manifestUrl, cache);
};

interface ResolvedManifests {
  manifests: PluginManifest[];
  digest: string;
}

/** The shared front half of composition: manifests + digest. Both composeUi
 * (full SSR variant) and composeClientPayload (payload only) run this so the
 * two paths digest identically by construction. */
const resolveManifestsAndDigest = (
  sources: UiSource[],
  cache: UiComposeCacheState,
): Effect.Effect<ResolvedManifests, Error> =>
  Effect.gen(function* () {
    const manifests = yield* Effect.forEach(sources, (source) => loadManifest(source, cache), {
      concurrency: "unbounded",
    });
    const digest = yield* Effect.tryPromise(() =>
      digestOf({
        plugins: sources.map((source, i) => ({
          // Composition identity is the manifest's build-time container
          // name — the identity the client derives from the payload's
          // manifests (hydrate builds refs as key: manifest.name). Source
          // config labels are deployment detail and must not enter the
          // digest.
          key: manifests[i]?.name ?? source.key,
          mfName: source.mfName,
        })),
        manifests,
      }),
    );
    return { manifests, digest };
  });

const clientPayloadOf = (
  sources: UiSource[],
  manifests: PluginManifest[],
  digest: string,
): ComposePayload => ({
  digest,
  remotes: sources.flatMap((source, i) => {
    if (source.key === CORE_UI_KEY || !source.webEntry) return [];
    return [
      {
        // The client matches remotes to manifests by `key === manifest.name`;
        // a source's `key` (config label) often differs from the manifest's
        // build-time container name (derived from the package name).
        key: manifests[i]?.name ?? source.key,
        name: source.mfName,
        entry: source.webEntry,
        ...(source.browserManifestUrl ? { manifestUrl: source.browserManifestUrl } : {}),
      },
    ];
  }),
  manifests,
});

function rememberVariant(
  cache: UiComposeCacheState,
  digest: string,
  variant: ComposedUi,
  staleAfter: number,
) {
  cache.variants.set(digest, { variant, staleAfter });
}

/** Variant cache identity: the structural digest plus a deployment
 * fingerprint (SSR integrity in prod, local manifest mtime in dev) so a
 * code-only redeploy or dev rebuild invalidates the composed tree even
 * though the hydration digest deliberately stays deployment-free. */
function variantFingerprint(sources: UiSource[]): string {
  return sources
    .map((source) => {
      if (source.localRoot) {
        try {
          const mtime = statSync(`${source.localRoot}/src/${MANIFEST_FILENAME}`).mtimeMs;
          return `${source.key}:${mtime}`;
        } catch {
          return `${source.key}:missing`;
        }
      }
      return `${source.key}:${source.remote?.ssrIntegrity ?? ""}`;
    })
    .join("|");
}

export const composeUi = (
  config: RuntimeConfig,
  cache: UiComposeCacheState,
): Effect.Effect<ComposedUi, Error> =>
  Effect.gen(function* () {
    const sources = uiSources(config);
    const core = sources.find((source) => source.key === CORE_UI_KEY)!;

    const { manifests, digest } = yield* resolveManifestsAndDigest(sources, cache);
    const manifestByName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
    const manifestNameByKey = new Map(
      sources.map((source, i) => [source.key, manifests[i]!.name] as const),
    );

    const variantKey = `${digest}::${variantFingerprint(sources)}`;
    const isDev = sources.some((source) => source.localRoot);
    const now = yield* Clock.currentTimeMillis;
    const cached = cache.variants.get(variantKey);
    if (cached && (isDev ? cached.staleAfter > now : true)) {
      return cached.variant;
    }

    let compose: ComposeModule["constructTree"];
    let coreRouteConfig: RouteConfigModule;

    const coreEntry = core.localRoot
      ? yield* Effect.tryPromise(() =>
          localUiRemoteEntry({ name: core.mfName, localRoot: core.localRoot! }),
        )
      : core.remote!;
    if (core.localRoot) {
      yield* waitForLocalContainer(coreEntry, config.env);
    }
    const [composeModule, routeConfig, routerModule] = yield* Effect.all([
      loadUiComposeModule(coreEntry, config.env),
      loadCoreUiRouteConfig(coreEntry, config.env),
      loadRouterModule(config, core.localRoot ? coreEntry : undefined),
    ]);
    compose = composeModule.constructTree;
    coreRouteConfig = routeConfig;

    const routeConfigByName = new Map<string, RouteConfigModule>([
      [manifestNameByKey.get(CORE_UI_KEY) ?? CORE_UI_KEY, coreRouteConfig],
    ]);
    for (const source of sources) {
      if (source.key === CORE_UI_KEY) continue;
      const name = manifestNameByKey.get(source.key) ?? source.key;
      if (source.localRoot) {
        const localEntry = yield* Effect.tryPromise(() =>
          localUiRemoteEntry({ name: source.mfName, localRoot: source.localRoot! }),
        );
        yield* waitForLocalContainer(localEntry, config.env);
        routeConfigByName.set(name, yield* loadUiRouteConfig(localEntry, config.env));
      } else if (source.remote) {
        routeConfigByName.set(name, yield* loadUiRouteConfig(source.remote, config.env));
      }
    }

    const constructed = yield* Effect.tryPromise(() =>
      compose({
        name: "server",
        plugins: sources.map((source, i) => ({
          key: manifests[i]?.name ?? source.key,
          mfName: source.mfName,
        })),
        resolve: async (ref: { key: string }) => {
          const manifest = manifestByName.get(ref.key);
          const routeConfig = routeConfigByName.get(ref.key);
          if (!manifest || !routeConfig) {
            throw new Error(`composition source "${ref.key}" is not fully resolved`);
          }
          return { key: ref.key, manifest, routeConfig };
        },
        rootOptions: coreRouteConfig.rootMeta,
      }),
    );

    if (constructed.digest !== digest) {
      return yield* new ComposeDigestMismatchError({
        engineDigest: constructed.digest,
        manifestDigest: digest,
      });
    }

    const variant: ComposedUi = {
      routerModule,
      routeTree: constructed.rootRoute,
      digest,
      nav: constructed.nav,
      clientPayload: clientPayloadOf(sources, manifests, digest),
    };
    rememberVariant(
      cache,
      variantKey,
      variant,
      isDev ? now + DEV_VARIANT_TTL_MS : Number.POSITIVE_INFINITY,
    );
    while (cache.variants.size > MAX_COMPOSE_VARIANTS) {
      const oldest = cache.variants.keys().next().value;
      if (!oldest) break;
      cache.variants.delete(oldest);
    }
    return variant;
  });

export interface ClientCompose {
  digest: string;
  clientPayload: ComposePayload;
}

/**
 * Client compose payload without the SSR machinery — manifests + digest +
 * plugin web entries only. The no-SSR client shell (default dev, CSR-only
 * deployments) embeds it so the browser composes plugin routes itself
 * (hydrate's composeFromPayload); `undefined` when no plugin ui sources
 * exist — the bundled core-only tree is already complete there, and serving
 * a core-manifest payload would needlessly swap the bundled generated tree
 * for the constructed one. Digest parity with composeUi is structural: both
 * run resolveManifestsAndDigest over the same sources.
 */
export const composeClientPayload = (
  config: RuntimeConfig,
  cache: UiComposeCacheState,
): Effect.Effect<ClientCompose | undefined, Error> =>
  Effect.gen(function* () {
    const sources = uiSources(config);
    if (sources.every((source) => source.key === CORE_UI_KEY)) return undefined;
    const { manifests, digest } = yield* resolveManifestsAndDigest(sources, cache);
    return { digest, clientPayload: clientPayloadOf(sources, manifests, digest) };
  });
