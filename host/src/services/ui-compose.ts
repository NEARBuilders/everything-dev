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
import { Clock, Data, Effect, Schema } from "effect";
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
  parsePluginManifest,
  type RouteConfigModule,
} from "everything-dev/ui/manifest";
import type { RouterModule } from "../types";
import { logger } from "../utils/logger";
import type { RuntimeConfig } from "./config";
import { UiComposeError } from "./errors";
import {
  loadCoreUiRouteConfig,
  loadRouterModule,
  loadUiComposeModule,
  loadUiRouteConfig,
  localUiRemoteEntry,
  resolveLocalRoot,
  waitForLocalContainer,
} from "./federation.server";
import { enforceCacheLimit } from "./ttl-cache";

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

const loadRemoteManifestCached = Effect.fn("loadRemoteManifestCached")(function* (
  source: UiSource,
  manifestUrl: string,
  cache: UiComposeCacheState,
) {
  const cached = cache.remoteManifests.get(source.key);
  const now = yield* Clock.currentTimeMillis;
  if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
    return cached.manifest;
  }
  const fresh = yield* Effect.tryPromise({
    try: async () => {
      const response = await runFetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`manifest fetch ${response.status} for ${manifestUrl}`);
      }
      return parsePluginManifest(await response.json()) satisfies PluginManifest;
    },
    catch: (cause) =>
      new UiComposeError({ operation: `Failed to load UI manifest from ${manifestUrl}`, cause }),
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

const loadManifest = Effect.fn("loadManifest")(function* (
  source: UiSource,
  cache: UiComposeCacheState,
) {
  if (source.localRoot) {
    const manifestContents = Effect.try({
      try: () => readFileSync(`${source.localRoot}/src/${MANIFEST_FILENAME}`, "utf8"),
      catch: (cause) =>
        new UiComposeError({ operation: "Failed to read local UI manifest", cause }),
    });
    return yield* manifestContents.pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))),
      Effect.mapError(
        (cause) => new UiComposeError({ operation: "Failed to decode local UI manifest", cause }),
      ),
      Effect.flatMap((manifestJson) =>
        Effect.try({
          try: () => parsePluginManifest(manifestJson) satisfies PluginManifest,
          catch: (cause) => new UiComposeError({ operation: "Invalid local UI manifest", cause }),
        }),
      ),
    );
  }
  if (!source.manifestUrl) {
    return yield* new UiComposeError({
      operation: `UI source "${source.key}" has no manifest location`,
      cause: new Error("Manifest location is required"),
    });
  }
  return yield* loadRemoteManifestCached(source, source.manifestUrl, cache);
});

interface ComposableSource {
  source: UiSource;
  manifest: PluginManifest;
}

/**
 * Per-source isolation (ADR 0024 §5): a plugin source that cannot produce a
 * usable manifest — fetch failure with no last-good snapshot, unparsable
 * content, or an identity mismatch with its config key — drops itself with a
 * warning instead of failing the whole composition. The core source failing
 * stays loud. composeUi and composeClientPayload digest the same healthy set,
 * so their payloads stay in parity by construction.
 */
const resolveComposableSources = Effect.fn("resolveComposableSources")(function* (
  sources: UiSource[],
  cache: UiComposeCacheState,
) {
  return yield* Effect.forEach(
    sources,
    (source) =>
      Effect.gen(function* () {
        const manifest = yield* loadManifest(source, cache);
        if (manifest.name === source.key) return manifest;
        if (source.key === CORE_UI_KEY) {
          return yield* Effect.fail(
            new Error(
              `[Compose] the core ui manifest names itself "${manifest.name}" — expected "${source.key}" (ADR 0008 §2)`,
            ),
          );
        }
        yield* Effect.logWarning(
          `[Compose] dropping ui source "${source.key}" — its manifest names itself "${manifest.name}" (identity mismatch, ADR 0008 §2)`,
        );
        return null;
      }).pipe(
        Effect.catch((error) =>
          source.key === CORE_UI_KEY
            ? Effect.fail(error)
            : Effect.logWarning(
                `[Compose] dropping ui source "${source.key}" — no usable manifest (${error.message})`,
              ).pipe(Effect.as(null)),
        ),
      ),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((loaded) =>
      loaded.flatMap((entry, i): ComposableSource[] =>
        entry ? [{ source: sources[i]!, manifest: entry }] : [],
      ),
    ),
  );
});

const digestOfSources = Effect.fn("digestOfSources")(function* (composable: ComposableSource[]) {
  return yield* Effect.tryPromise(() => {
    // The construction engine sorts plugins by key before digesting — the
    // manifest digest must read the same sorted order or parity fails.
    const sorted = [...composable].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    return digestOf({
      plugins: sorted.map(({ source, manifest }) => ({
        key: manifest.name,
        mfName: source.mfName,
      })),
      manifests: sorted.map(({ manifest }) => manifest),
    });
  });
});

const clientPayloadOf = (composable: ComposableSource[], digest: string): ComposePayload => ({
  digest,
  remotes: composable.flatMap(({ source, manifest }) => {
    if (source.key === CORE_UI_KEY || !source.webEntry) return [];
    return [
      {
        // The client matches remotes to manifests by `key === manifest.name`;
        // the manifest name IS the composition identity (ADR 0008 §2). The
        // MF container name is separate deployment detail.
        key: manifest.name,
        name: source.mfName,
        entry: source.webEntry,
        ...(source.browserManifestUrl ? { manifestUrl: source.browserManifestUrl } : {}),
      },
    ];
  }),
  manifests: composable.map(({ manifest }) => manifest),
});

function rememberVariant(
  cache: UiComposeCacheState,
  variantKey: string,
  variant: ComposedUi,
  staleAfter: number,
) {
  cache.variants.set(variantKey, { variant, staleAfter });
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

export const composeUi = Effect.fn("composeUi")(function* (
  config: RuntimeConfig,
  cache: UiComposeCacheState,
) {
  const sources = uiSources(config);
  const composable = yield* resolveComposableSources(sources, cache);
  const corePair = composable.find(({ source }) => source.key === CORE_UI_KEY)!;
  const core = corePair.source;

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
  const coreRouteConfig: RouteConfigModule = routeConfig;

  // Per-source route-config isolation: a plugin whose container/config
  // cannot load drops itself (warn); the core stays loud. The digest is
  // computed over the final healthy set — after drops — so the engine's
  // parity check and the client payload agree by construction.
  const healthy: ComposableSource[] = [{ source: core, manifest: corePair.manifest }];
  const routeConfigByName = new Map<string, RouteConfigModule>([
    [corePair.manifest.name, coreRouteConfig],
  ]);
  for (const entry of composable) {
    if (entry.source.key === CORE_UI_KEY) continue;
    const loaded = yield* (
      entry.source.localRoot
        ? Effect.gen(function* () {
            const localEntry = yield* Effect.tryPromise(() =>
              localUiRemoteEntry({
                name: entry.source.mfName,
                localRoot: entry.source.localRoot!,
              }),
            );
            yield* waitForLocalContainer(localEntry, config.env);
            return yield* loadUiRouteConfig(localEntry, config.env);
          })
        : loadUiRouteConfig(entry.source.remote!, config.env)
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `[Compose] dropping ui source "${entry.source.key}" — route config unavailable (${error.message})`,
        ).pipe(Effect.as(null)),
      ),
    );
    if (loaded) {
      healthy.push(entry);
      routeConfigByName.set(entry.manifest.name, loaded);
    }
  }
  const healthySources = healthy.map(({ source }) => source);

  // Canonical order — the engine sorts refs by key before digesting; the
  // same sorted set feeds the manifest digest, the payload, and the
  // fingerprint.
  healthy.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const digest = yield* digestOfSources(healthy);

  const variantKey = `${digest}::${variantFingerprint(healthySources)}`;
  const isDev = healthySources.some((source) => source.localRoot);
  const now = yield* Clock.currentTimeMillis;
  const cached = cache.variants.get(variantKey);
  if (cached && (isDev ? cached.staleAfter > now : true)) {
    return cached.variant;
  }

  const constructed = yield* Effect.tryPromise(() =>
    composeModule.constructTree({
      name: "server",
      plugins: healthy.map(({ source, manifest }) => ({
        key: manifest.name,
        mfName: source.mfName,
      })),
      resolve: async (ref: { key: string }) => {
        const manifest = healthy.find(({ manifest }) => manifest.name === ref.key)?.manifest;
        const routeConfigFor = routeConfigByName.get(ref.key);
        if (!manifest || !routeConfigFor) {
          throw new Error(`composition source "${ref.key}" is not fully resolved`);
        }
        return { key: ref.key, manifest, routeConfig: routeConfigFor };
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
    clientPayload: clientPayloadOf(healthy, digest),
  };
  rememberVariant(
    cache,
    variantKey,
    variant,
    isDev ? now + DEV_VARIANT_TTL_MS : Number.POSITIVE_INFINITY,
  );
  enforceCacheLimit(cache.variants, MAX_COMPOSE_VARIANTS);
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
 * isolate and digest the same healthy source set.
 */
export const composeClientPayload = Effect.fn("composeClientPayload")(function* (
  config: RuntimeConfig,
  cache: UiComposeCacheState,
) {
  const sources = uiSources(config);
  if (sources.every((source) => source.key === CORE_UI_KEY)) return undefined;
  const composable = yield* resolveComposableSources(sources, cache);
  const digest = yield* digestOfSources(composable);
  return { digest, clientPayload: clientPayloadOf(composable, digest) };
});
