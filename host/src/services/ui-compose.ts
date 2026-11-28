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
import { Clock, Data, Effect, Result, Schema } from "effect";
import type { BosEnv } from "everything-dev/config";
import {
  CORE_UI_PLUGIN_KEY as CORE_UI_KEY,
  type ComposePayload,
  type ConstructedTree,
  digestOf,
  entryUrls,
  MANIFEST_FILENAME,
  type NavManifest,
  type PluginManifest,
  parsePluginManifest,
  type RemoteEntry,
  type RouteConfigModule,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "everything-dev/ui/manifest";
import { asDigest, fetchVerified } from "everything-dev/verify";
import type { RouterModule } from "../types";
import { logger } from "../utils/logger";
import type { RuntimeConfig } from "./config";
import { UiComposeError } from "./errors";
import {
  FederationContainers,
  LOCAL_CONTAINER_RECOVERY_TIMEOUT_MS,
  resolveLocalRoot,
  waitForLocalContainer,
} from "./federation/containers";
import type { CompositionSession } from "./federation/instance";
import {
  FederationLoader,
  loadCoreUiRouteConfig,
  loadRouterModule,
  loadUiComposeModule,
  loadUiRouteConfig,
  requireSsrEntryUrl,
} from "./federation/loader";
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

export interface UiSource {
  key: string;
  mfName: string;
  remote?: RemoteEntry;
  localRoot?: string;
  manifestUrl?: string;
  /** SRI the pinned version manifest records for the compose manifest —
   * verified on every fetch so mutable-latest bytes that drifted from the
   * resolved pin fail the compose loud instead of rendering a mixed tree */
  manifestIntegrity?: string;
  /** the MF browser manifest URL (mf-manifest.json — hashed when the remote
   * pins a version manifest); rides the compose payload for hydrate-time
   * remote registration */
  browserManifestUrl?: string;
  /** client-side web entry (browser remoteEntry.js) */
  uiEntry?: string;
  /** Shared-singleton `name → version` the pinned build embedded (#546) —
   * cross-compared across the composition before any remote loads, so a
   * platform skew fails with a named error instead of the federation
   * runtime's cryptic singleton negotiation error. */
  sharedVersions?: Record<string, string>;
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
          : (config.ui.manifestUrl ?? `${config.ui.url.replace(/\/$/, "")}/${MANIFEST_FILENAME}`),
      manifestIntegrity: config.ui.manifestIntegrity,
      browserManifestUrl: coreUrls.browserManifest,
      uiEntry: coreUrls.ui,
      sharedVersions: config.ui.sharedVersions,
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
      // Remote sources publish their manifest at a known URL; local remotes are
      // read straight from the workspace (src/manifest.gen.json) — no URL.
      // Pinned remotes resolve it through the immutable version directory
      // (#826); the slot-root fixed name is the legacy fallback.
      manifestUrl: ui.url
        ? (ui.manifestUrl ?? `${ui.url.replace(/\/$/, "")}/${MANIFEST_FILENAME}`)
        : undefined,
      manifestIntegrity: ui.manifestIntegrity,
      browserManifestUrl: urls.browserManifest,
      uiEntry: urls.ui,
      sharedVersions: ui.sharedVersions,
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

/** The emergency floor (#940): the most recent fully-composed variant. When
 * the SSR container transiently disappears (a concurrent build mid-write),
 * a compose that cannot reach it serves this instead of failing the request —
 * an in-memory tree is immune to the dist underneath it. */
interface CachedLastGood {
  variant: ComposedUi;
  savedAt: number;
}

export interface UiComposeCacheState {
  remoteManifests: Map<string, CachedManifest>;
  variants: Map<string, CachedComposeVariant>;
  lastGood: CachedLastGood | null;
}

export function createUiComposeCacheState(): UiComposeCacheState {
  return { remoteManifests: new Map(), variants: new Map(), lastGood: null };
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
      if (!source.manifestIntegrity) {
        const response = await runFetch(manifestUrl);
        if (!response.ok) {
          throw new Error(`manifest fetch ${response.status} for ${manifestUrl}`);
        }
        return await response.text();
      }
      const bytes = await fetchVerified({
        url: manifestUrl,
        expected: asDigest(source.manifestIntegrity),
      }).catch((cause) => {
        throw new Error(
          `manifest bytes at ${manifestUrl} do not match the resolved pin's SRI — ` +
            `the resolved config is older than the deployed bundles (stale host or rolled-back publish); ` +
            `redeploy or restart the host to re-resolve`,
          { cause },
        );
      });
      return new TextDecoder().decode(bytes);
    },
    catch: (cause) =>
      new UiComposeError({ operation: `Failed to load UI manifest from ${manifestUrl}`, cause }),
  }).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))),
    Effect.mapError((cause) =>
      cause instanceof UiComposeError
        ? cause
        : new UiComposeError({
            operation: `Failed to load UI manifest from ${manifestUrl}`,
            cause,
          }),
    ),
    Effect.map((manifestJson) => parsePluginManifest(manifestJson) satisfies PluginManifest),
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

export class SharedSingletonSkewError extends Data.TaggedError("SharedSingletonSkewError")<{
  readonly name: string;
  readonly versionA: string;
  readonly sourceA: string;
  readonly versionB: string;
  readonly sourceB: string;
}> {
  get message() {
    return (
      `Shared singleton "${this.name}" skew across UI sources: "${this.sourceA}" was built against ` +
      `${this.versionA}, "${this.sourceB}" against ${this.versionB} — the composition refuses to load ` +
      `a split module graph. Redeploy the older bundle: \`bos upgrade\` realigns the platform pin, ` +
      `\`bos deploy\` rebuilds against it (issue #546).`
    );
  }
}

/**
 * The composition's shared-singleton consistency guard (#546): every UI
 * source's version manifest declares the singleton versions its build
 * embedded; any singleton named by two or more sources at different versions
 * would throw the federation runtime's cryptic negotiation error mid-load —
 * this names the sources and versions instead. Sources without a record
 * (local dev sources, builds predating the field) are skipped.
 */
export function sharedSingletonSkew(
  composable: ComposableSource[],
): SharedSingletonSkewError | null {
  const byName = new Map<string, Array<{ source: string; version: string }>>();
  for (const { source, manifest } of composable) {
    const shared = source.sharedVersions;
    if (!shared || manifest.name !== source.key) continue;
    for (const [name, version] of Object.entries(shared)) {
      const uses = byName.get(name) ?? [];
      uses.push({ source: source.key, version });
      byName.set(name, uses);
    }
  }
  for (const [name, uses] of byName) {
    const first = uses[0]!;
    const diverged = uses.find((use) => use.version !== first.version);
    if (diverged) {
      return new SharedSingletonSkewError({
        name,
        versionA: first.version,
        sourceA: first.source,
        versionB: diverged.version,
        sourceB: diverged.source,
      });
    }
  }
  return null;
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
          return yield* new UiComposeError({
            operation: `[Compose] the core ui manifest names itself "${manifest.name}" — expected "${source.key}"`,
            cause: new Error("identity mismatch (ADR 0008 §2)"),
          });
        }
        // A local ui source is authored into this runtime — a manifest that
        // names another plugin is a configuration bug, not a transient remote
        // failure: fail loud instead of silently dropping the remote.
        if (source.localRoot) {
          return yield* new UiComposeError({
            operation: `[Compose] local ui source "${source.key}" manifest names itself "${manifest.name}" — expected "${source.key}"`,
            cause: new Error("identity mismatch (ADR 0008 §2)"),
          });
        }
        yield* Effect.logWarning(
          `[Compose] dropping ui source "${source.key}" — its manifest names itself "${manifest.name}" (identity mismatch, ADR 0008 §2)`,
        );
        return null;
      }).pipe(
        Effect.catch((error) =>
          source.localRoot || source.key === CORE_UI_KEY
            ? Effect.fail(
                new UiComposeError({
                  operation: `Failed to load UI manifest for ${source.localRoot ? "local" : "core"} ui source "${source.key}"`,
                  cause: error,
                }),
              )
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
    if (source.key === CORE_UI_KEY || !source.uiEntry) return [];
    return [
      {
        // The client matches remotes to manifests by `key === manifest.name`;
        // the manifest name IS the composition identity (ADR 0008 §2). The
        // MF container name is separate deployment detail.
        key: manifest.name,
        name: source.mfName,
        entry: source.uiEntry,
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

/**
 * Wait for one local source's SSR container, or recover to the last-good
 * generation (#940): while a previous compose succeeded, an unavailable
 * container (a concurrent build's transient wipe) serves that generation
 * loud instead of failing the request — bounded by the recovery budget so
 * requests never park behind bytes a build is rewriting. Without a last-good
 * generation there is nothing to serve: the failure stays loud (cold boots
 * keep the full wait budget).
 */
const waitOrLastGood = Effect.fn("waitOrLastGood")(function* (
  entry: RemoteEntry,
  env: BosEnv,
  cache: UiComposeCacheState,
) {
  const lastGood = cache.lastGood;
  const outcome = yield* Effect.result(
    waitForLocalContainer(
      entry,
      env,
      lastGood ? { timeoutMs: LOCAL_CONTAINER_RECOVERY_TIMEOUT_MS } : undefined,
    ),
  );
  const failure = Result.match(outcome, {
    onSuccess: () => null,
    onFailure: (error) => error,
  });
  if (!failure) return null;
  if (!lastGood) return yield* Effect.fail(failure);
  yield* Effect.logWarning(
    `[Compose] ${entry.name} SSR container not ready — serving the last-good generation ` +
      `(${Math.max(0, Date.now() - lastGood.savedAt)}ms old, digest ${lastGood.variant.digest}): ` +
      `${failure.detail ?? failure.message}`,
  ).pipe(
    Effect.annotateLogs({
      remote: entry.name,
      digest: lastGood.variant.digest,
      recovery: "last-good",
    }),
  );
  return lastGood.variant;
});

/** Variant cache identity: the structural digest plus a deployment
 * fingerprint (SSR integrity in prod; src manifest mtime AND built container
 * mtime in dev) so a code-only redeploy or dev rebuild invalidates the
 * composed tree even though the hydration digest deliberately stays
 * deployment-free. The built container's mtime is the hot-reload signal: a
 * content-only route edit rewrites `dist/ssr/remoteEntry.server.js` (or is
 * restamped by a rebuild), and the stale tree holding the old route modules
 * must not outlive it. */
function variantFingerprint(sources: UiSource[]): string {
  return sources
    .map((source) => {
      if (source.localRoot) {
        try {
          const manifestMtime = statSync(`${source.localRoot}/src/${MANIFEST_FILENAME}`).mtimeMs;
          try {
            const containerMtime = statSync(
              `${source.localRoot}/dist/ssr/${UI_REMOTE_SERVER_ENTRY_FILENAME}`,
            ).mtimeMs;
            return `${source.key}:${manifestMtime}:${containerMtime}`;
          } catch {
            return `${source.key}:${manifestMtime}`;
          }
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
  const containers = yield* FederationContainers;
  const sources = uiSources(config);
  const composable = yield* resolveComposableSources(sources, cache);
  const skew = sharedSingletonSkew(composable);
  if (skew) return yield* skew;
  const corePair = composable.find(({ source }) => source.key === CORE_UI_KEY)!;
  const core = corePair.source;

  const coreEntry = core.localRoot
    ? yield* containers.localUiRemoteEntry({ name: core.mfName, localRoot: core.localRoot! })
    : core.remote!;
  if (core.localRoot) {
    const recovered = yield* waitOrLastGood(coreEntry, config.env, cache);
    if (recovered) return recovered;
  }

  // Every source's entry resolves BEFORE the compose session opens: the
  // session pins one generation for the whole compose, so a rebuild landing
  // mid-compose can only change the entries the NEXT compose sees — never
  // this one's bytes (mixed generations mix React copies; ADR 0049
  // invariant 4).
  const loader = yield* FederationLoader;
  const nonCore = composable.filter(({ source }) => source.key !== CORE_UI_KEY);
  const pluginEntries = yield* Effect.forEach(
    nonCore,
    ({ source }) =>
      source.localRoot
        ? containers.localUiRemoteEntry({ name: source.mfName, localRoot: source.localRoot! })
        : Effect.succeed(source.remote!),
    { concurrency: "unbounded" },
  );
  const recoveredVariant = yield* Effect.forEach(
    nonCore,
    ({ source }, i) =>
      source.localRoot
        ? waitOrLastGood(pluginEntries[i]!, config.env, cache)
        : Effect.succeed(null),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((results) => results.find((result): result is ComposedUi => result !== null)));
  if (recoveredVariant) return recoveredVariant;
  const session: CompositionSession = loader.ensureSession([
    { name: core.mfName, entry: requireSsrEntryUrl(coreEntry, config.env) },
    ...nonCore.map(({ source }, i) => ({
      name: source.mfName,
      entry: requireSsrEntryUrl(pluginEntries[i]!, config.env),
    })),
  ]);

  const [composeModule, routeConfig, routerModule] = yield* Effect.all([
    loadUiComposeModule(coreEntry, config.env, session),
    loadCoreUiRouteConfig(coreEntry, config.env, session),
    loadRouterModule(config, core.localRoot ? coreEntry : undefined, session),
  ]);
  const coreRouteConfig: RouteConfigModule = routeConfig;

  // Per-source route-config isolation: a plugin whose container/config
  // cannot load drops itself (warn); the core stays loud. The digest is
  // computed over the final healthy set — after drops — so the engine's
  // parity check and the client payload agree by construction. Plugin
  // route-configs load in parallel through the pinned session.
  const healthy: ComposableSource[] = [{ source: core, manifest: corePair.manifest }];
  const routeConfigByName = new Map<string, RouteConfigModule>([
    [corePair.manifest.name, coreRouteConfig],
  ]);
  const loaded = yield* Effect.forEach(
    pluginEntries,
    (entry, i) =>
      loadUiRouteConfig(entry, config.env, session).pipe(
        Effect.catch((error) =>
          nonCore[i]!.source.localRoot
            ? Effect.fail(error)
            : Effect.logWarning(
                `[Compose] dropping ui source "${nonCore[i]!.source.key}" — route config unavailable (${error.message})`,
              ).pipe(Effect.as(null)),
        ),
      ),
    { concurrency: "unbounded" },
  );
  for (let i = 0; i < loaded.length; i++) {
    if (loaded[i]) {
      healthy.push(nonCore[i]!);
      routeConfigByName.set(nonCore[i]!.manifest.name, loaded[i]!);
    }
  }
  const healthySources = healthy.map(({ source }) => source);

  // Canonical order — the engine sorts refs by key before digesting; the
  // same sorted set feeds the manifest digest, the payload, and the
  // variant cache key.
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
  cache.lastGood = { variant, savedAt: now };
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
  const skew = sharedSingletonSkew(composable);
  if (skew) return yield* skew;
  const digest = yield* digestOfSources(composable);
  return { digest, clientPayload: clientPayloadOf(composable, digest) };
});
