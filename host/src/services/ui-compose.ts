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
import { Data, Effect } from "effect";
import {
  CORE_UI_PLUGIN_KEY as CORE_UI_KEY,
  type ComposePayload,
  type ConstructedTree,
  digestOf,
  MANIFEST_FILENAME,
  type NavManifest,
  type PluginManifest,
  PluginManifestSchema,
  type RouteConfigModule,
  UI_REMOTE_ENTRY_FILENAME,
} from "everything-dev/ui/manifest";
import type { RouterModule } from "../types";
import type { RuntimeConfig } from "./config";
import {
  type ComposeModule,
  loadCoreUiRouteConfig,
  loadRouterModule,
  loadUiComposeModule,
  loadUiRouteConfig,
  localUiRemoteEntry,
  resolveLocalRoot,
  type UiRemoteEntry,
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
  remote?: UiRemoteEntry;
  localRoot?: string;
  manifestUrl?: string;
  /** client-side web entry (browser remoteEntry.js) — the publicUrl base
   * when the runtime declares one (image-native /bundles), else the url */
  webEntry?: string;
}

/** Browser-facing base for a ui surface: publicUrl declares the
 * browser-reachable base (image-native /bundles slots); url is the
 * server-side loading base and the fallback. */
const browserUiBase = (ui: { url: string; publicUrl?: string | undefined }): string =>
  (ui.publicUrl ?? ui.url).replace(/\/$/, "");

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
  const sources: UiSource[] = [
    {
      key: CORE_UI_KEY,
      mfName: config.ui.name,
      remote: {
        name: config.ui.name,
        ssrUrl: config.ui.ssrUrl,
        ssrIntegrity: config.ui.ssrIntegrity,
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
      webEntry: `${browserUiBase(config.ui)}/${UI_REMOTE_ENTRY_FILENAME}`,
    },
  ];
  for (const [id, plugin] of Object.entries(config.plugins ?? {})) {
    const ui = plugin?.ui;
    if (!ui) continue;
    sources.push({
      key: id,
      mfName: ui.name,
      remote: {
        name: ui.name,
        ssrUrl: ui.ssrUrl,
        ssrIntegrity: ui.ssrIntegrity,
        localPath: ui.localPath,
      },
      localRoot: ui.localPath ? resolveLocalRoot(ui.localPath) : undefined,
      manifestUrl: `${ui.url.replace(/\/$/, "")}/${MANIFEST_FILENAME}`,
      webEntry: `${browserUiBase(ui)}/${UI_REMOTE_ENTRY_FILENAME}`,
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

/** Remote manifest fetches are cached + last-good: a flaky plugin host must
 * not 500 the site (or force per-request fetches) while a valid snapshot
 * exists. Local manifests re-read every time — dev must see edits. */
const remoteManifestCache = new Map<string, CachedManifest>();

const loadRemoteManifestCached = (
  source: UiSource,
  manifestUrl: string,
): Effect.Effect<PluginManifest, Error> =>
  Effect.gen(function* () {
    const cached = remoteManifestCache.get(source.key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached.manifest;
    }
    const fresh = yield* Effect.tryPromise(async () => {
      const response = await fetch(manifestUrl);
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
          return yield* Effect.fail(error);
        }),
      ),
    );
    remoteManifestCache.set(source.key, { manifest: fresh, fetchedAt: now });
    return fresh;
  });

const loadManifest = (source: UiSource): Effect.Effect<PluginManifest, Error> => {
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
  return loadRemoteManifestCached(source, source.manifestUrl);
};

interface ResolvedManifests {
  manifests: PluginManifest[];
  digest: string;
}

/** The shared front half of composition: manifests + digest. Both composeUi
 * (full SSR variant) and composeClientPayload (payload only) run this so the
 * two paths digest identically by construction. */
const resolveManifestsAndDigest = (sources: UiSource[]): Effect.Effect<ResolvedManifests, Error> =>
  Effect.gen(function* () {
    const manifests = yield* Effect.forEach(sources, (source) => loadManifest(source), {
      concurrency: "unbounded",
    });
    const digest = yield* Effect.tryPromise(() =>
      digestOf({
        plugins: sources.map((source) => ({ key: source.key, mfName: source.mfName })),
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
  remotes: sources
    .filter((source) => source.key !== CORE_UI_KEY && source.webEntry)
    .map((source) => ({ key: source.key, name: source.mfName, entry: source.webEntry! })),
  manifests,
});

const composeVariants = new Map<string, { variant: ComposedUi; staleAfter: number }>();

export function resetUiComposeCache() {
  composeVariants.clear();
  remoteManifestCache.clear();
}

/** Ages out the remote manifest cache only — variant composition state is
 * preserved so callers can observe digest-driven recomposition. */
export function resetRemoteManifestCache() {
  remoteManifestCache.clear();
}

function rememberVariant(digest: string, variant: ComposedUi, staleAfter: number) {
  composeVariants.set(digest, { variant, staleAfter });
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

export const composeUi = (config: RuntimeConfig): Effect.Effect<ComposedUi, Error> =>
  Effect.gen(function* () {
    const sources = uiSources(config);
    const core = sources.find((source) => source.key === CORE_UI_KEY)!;

    const { manifests, digest } = yield* resolveManifestsAndDigest(sources);
    const manifestByKey = new Map(sources.map((source, i) => [source.key, manifests[i]!]));

    const variantKey = `${digest}::${variantFingerprint(sources)}`;
    const isDev = sources.some((source) => source.localRoot);
    const now = Date.now();
    const cached = composeVariants.get(variantKey);
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
      yield* Effect.tryPromise(() => waitForLocalContainer(coreEntry));
    }
    const [composeModule, routeConfig, routerModule] = yield* Effect.all([
      loadUiComposeModule(coreEntry),
      loadCoreUiRouteConfig(coreEntry),
      loadRouterModule(config, core.localRoot ? coreEntry : undefined),
    ]);
    compose = composeModule.constructTree;
    coreRouteConfig = routeConfig;

    const routeConfigBySource = new Map<string, RouteConfigModule>([
      [CORE_UI_KEY, coreRouteConfig],
    ]);
    for (const source of sources) {
      if (source.key === CORE_UI_KEY) continue;
      if (source.localRoot) {
        const localEntry = yield* Effect.tryPromise(() =>
          localUiRemoteEntry({ name: source.mfName, localRoot: source.localRoot! }),
        );
        yield* Effect.tryPromise(() => waitForLocalContainer(localEntry));
        routeConfigBySource.set(source.key, yield* loadUiRouteConfig(localEntry));
      } else if (source.remote) {
        routeConfigBySource.set(source.key, yield* loadUiRouteConfig(source.remote));
      }
    }

    const constructed = yield* Effect.tryPromise(() =>
      compose({
        name: "server",
        plugins: sources.map((source) => ({ key: source.key, mfName: source.mfName })),
        resolve: async (ref: { key: string }) => {
          const manifest = manifestByKey.get(ref.key);
          const routeConfig = routeConfigBySource.get(ref.key);
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
      variantKey,
      variant,
      isDev ? now + DEV_VARIANT_TTL_MS : Number.POSITIVE_INFINITY,
    );
    while (composeVariants.size > MAX_COMPOSE_VARIANTS) {
      const oldest = composeVariants.keys().next().value;
      if (!oldest) break;
      composeVariants.delete(oldest);
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
): Effect.Effect<ClientCompose | undefined, Error> =>
  Effect.gen(function* () {
    const sources = uiSources(config);
    if (sources.every((source) => source.key === CORE_UI_KEY)) return undefined;
    const { manifests, digest } = yield* resolveManifestsAndDigest(sources);
    return { digest, clientPayload: clientPayloadOf(sources, manifests, digest) };
  });
