import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { cacheControlOf } from "every-plugin/build/artifact-names";
import {
  bundleCachePath,
  bundleCacheRoot,
  readBundleCache,
  writeBundleCache,
} from "./bundle-cache";
import { isAppDescriptorPath } from "./config";

/**
 * Local-first bundle resolution (ADR 0011 amendment): a self-contained
 * runtime image stages its own namespace under `BOS_BUNDLE_DIR` as
 * `bundles/<account>/<gateway>/<workspace>/…` and consumes those bytes
 * directly from disk instead of round-tripping through its own public
 * origin. The registry tier (children, `BOS_BUNDLE_DIR` unset) keeps the
 * network fetch — the namespace guard below only ever matches the runtime's
 * own account/gateway, never another runtime's layout.
 */

export interface BundleNamespace {
  readonly bundleDir: string;
  readonly account: string;
  readonly gateway: string;
}

export class BundleReadError extends Schema.TaggedError<BundleReadError>()("BundleReadError", {
  path: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".webmanifest": "application/manifest+json",
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

const notFound = (): Response =>
  new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });

export function bundleUrlToLocalPath(url: string, namespace: BundleNamespace): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const prefix = `/bundles/${encodeURIComponent(namespace.account)}/${encodeURIComponent(namespace.gateway)}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;

  let rest: string;
  try {
    rest = decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (!rest || rest.endsWith("/")) return null;

  // BOS_BUNDLE_DIR holds `<account>/<gateway>/<workspace>/…` directly (the
  // same layout host/src/routes/bundles.ts serves) — resolve and contain
  // within the OWN namespace, never a sibling one.
  const nsDir = path.resolve(namespace.bundleDir, namespace.account, namespace.gateway);
  const filePath = path.resolve(nsDir, rest);
  if (filePath !== nsDir && !filePath.startsWith(nsDir + path.sep)) return null;

  return filePath;
}

export class BundleResolver extends Context.Service<
  BundleResolver,
  {
    /** Resolve a fetch target from the staged namespace; null = not our namespace, fall through. */
    readonly lookup: (input: string | URL | Request) => Effect.Effect<Response | null>;
  }
>()("everything-dev/bundle-fs-resolve/BundleResolver") {
  static layer(namespace: BundleNamespace): Layer.Layer<BundleResolver> {
    const respond = Effect.fn("BundleResolver.respond")(function* (
      url: string,
    ): Effect.fn.Return<Response | null, never> {
      const filePath = bundleUrlToLocalPath(url, namespace);
      if (!filePath) return null;
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(filePath),
        catch: (cause) => new BundleReadError({ path: filePath, cause }),
      }).pipe(Effect.catchTag("BundleReadError", () => Effect.succeed(null)));
      if (bytes === null) return notFound();
      const name = path.basename(filePath);
      const contentType =
        MIME_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": contentType,
          "cache-control": cacheControlOf(name),
          etag: `"${Buffer.from(bytes.subarray(0, 4096)).toString("base64").slice(0, 24)}"`,
        },
      });
    });

    return Layer.effect(
      BundleResolver,
      Effect.succeed(
        BundleResolver.of({
          lookup: (input) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            return respond(url);
          },
        }),
      ),
    );
  }
}

export interface BundleFetchHandle {
  readonly uninstall: () => Promise<void>;
}

export interface BundleFetchOptions {
  /** Own-namespace FS resolution — requires a staged `BOS_BUNDLE_DIR`. */
  namespace?: BundleNamespace;
  /**
   * Foreign-namespace stale-if-error cache (child tier): `/bundles/…` URLs
   * outside the own namespace write through to disk on success and serve
   * the last-known-good bytes when the origin fails. Enabled implicitly
   * when `namespace` is present (deployment contexts), or explicitly via
   * `BOS_BUNDLE_CACHE_DIR`.
   */
  cacheDir?: string;
}

type FetchImpl = typeof globalThis.fetch;

const staleResponse = (bytes: Uint8Array, url: string): Response => {
  const name = url.split("?")[0].split("/").pop() ?? "";
  const contentType = MIME_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: { "content-type": contentType, "x-bundle-cache": "stale" },
  });
};

/**
 * Installs the resolver as a global fetch interceptor — the one seam every
 * boot-time consumer shares (config manifest discovery, contract-type
 * fetches, orchestrator host loading, MF remoteEntry/identity probes).
 * Own-namespace URLs resolve from the staged directory; other `/bundles/…`
 * URLs get the stale-if-error cache; everything else falls through to the
 * original fetch untouched. Inert when neither a staged namespace nor a
 * cache is configured.
 */
export function installGlobalBundleFetch(options: BundleFetchOptions): BundleFetchHandle {
  const namespace = options.namespace;
  const cacheDir = options.cacheDir;
  const runtime = namespace ? ManagedRuntime.make(BundleResolver.layer(namespace)) : null;
  const original: FetchImpl = globalThis.fetch;
  const patched = ((input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (namespace && bundleUrlToLocalPath(url, namespace)) {
      if (!runtime) throw new Error("unreachable: resolver runtime missing");
      return runtime.runPromise(
        Effect.gen(function* () {
          const resolver = yield* BundleResolver;
          return yield* resolver.lookup(input);
        }),
      );
    }

    if (cacheDir !== undefined && bundleCachePath(url, { cacheDir })) {
      return (async () => {
        try {
          const response = await original(input, init);
          if (response.ok) {
            try {
              const bytes = new Uint8Array(await response.clone().arrayBuffer());
              await writeBundleCache(url, bytes, { cacheDir });
            } catch {
              // write-through is best-effort
            }
          } else {
            const cached = await readBundleCache(url, { cacheDir });
            if (cached) return staleResponse(cached, url);
          }
          return response;
        } catch (error) {
          const cached = await readBundleCache(url, { cacheDir });
          if (cached) return staleResponse(cached, url);
          throw error;
        }
      })();
    }

    return original(input, init);
  }) as FetchImpl;
  const originalPreconnect = (original as Partial<FetchImpl>).preconnect;
  if (originalPreconnect) {
    patched.preconnect = originalPreconnect.bind(original);
  }
  globalThis.fetch = patched;
  return {
    uninstall: async () => {
      if (globalThis.fetch === patched) {
        globalThis.fetch = original;
      }
      if (runtime) await runtime.dispose();
    },
  };
}

/**
 * Boot-time installer for the CLI: derives the own namespace from
 * `BOS_BUNDLE_DIR` plus the runtime identity (`BOS_ACCOUNT`/`BOS_GATEWAY`
 * registry env taking precedence over the bos.config.json fields), and the
 * foreign-namespace cache from `BOS_BUNDLE_CACHE_DIR`. Tier auto-detection
 * (ADR 0021): an identity whose namespace is not actually staged under the
 * bundle dir drops to the registry tier — plain network fetch — instead of
 * deterministically 404ing own-namespace URLs against a foreign image's
 * staged bytes. Never throws — a missing or malformed identity leaves the
 * default network fetch in place.
 */
export function installBundleFetchFromEnv(input: {
  configPath?: string | null;
}): BundleFetchHandle | null {
  const bundleDir = process.env.BOS_BUNDLE_DIR;
  const cacheDir = process.env.BOS_BUNDLE_CACHE_DIR;
  if (!bundleDir && cacheDir === undefined) return null;

  let configAccount: string | undefined;
  let configGateway: string | undefined;
  const configPath = input.configPath;
  if (configPath && !isAppDescriptorPath(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
        account?: string;
        domain?: string;
      };
      configAccount = parsed.account;
      configGateway = parsed.domain;
    } catch {
      // unreadable config — identity may still come from the registry env
    }
  }

  const account = process.env.BOS_ACCOUNT ?? configAccount;
  const gateway = process.env.BOS_GATEWAY ?? configGateway;
  if (bundleDir && (!account || !gateway)) return null;

  let namespace: BundleNamespace | undefined;
  if (bundleDir && account && gateway) {
    if (existsSync(path.join(bundleDir, account, gateway))) {
      namespace = { bundleDir, account, gateway };
    } else {
      console.warn(
        `[bundles] staged namespace ${account}/${gateway} not found under ${bundleDir} — registry tier (network fetch)`,
      );
    }
  }
  return installGlobalBundleFetch({
    namespace,
    cacheDir: cacheDir ?? (namespace ? bundleCacheRoot() : undefined),
  });
}
