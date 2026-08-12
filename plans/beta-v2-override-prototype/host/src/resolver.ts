/**
 * Path-to-URL resolver — the bridge from `source` URIs to concrete remote URLs.
 *
 * Authoring uses URI descriptors; the runtime needs URLs. `resolveApp()` turns
 * one into the other:
 *
 *   source: "local://remote-dashboard-api"  →  { name, url, entry }
 *
 * This is the prototype's stand-in for `packages/everything-dev/src/resolver.ts`
 * (the production resolver reads `bos.config.json` the same way — the URI scheme
 * and resolve rules are identical; only the port/deploy map sources differ).
 *
 * fs access is confined to `moduleNameFromPackage`, invoked only via the
 * `nameOf` callback — browser bundles provide a static map instead.
 */

export interface ResolveContext {
  mode: "development" | "production";
  configDir: string;
  portMap?: Map<string, number>;
  deployMap?: Map<string, DeployResult>;
  localOverrides?: Map<string, string>;
  extendsResolver?: (ref: string) => Promise<ResolvedModule | null>;
  /** Derive the MF remote name from a local path. Browser: static map. Node: reads package.json. */
  nameOf?: (path: string) => string;
}

export interface DeployResult {
  url: string;
  integrity?: string;
}

export interface ResolvedModule {
  name: string;
  url: string;
  entry: string;
  integrity?: string;
}

const MF_MANIFEST = "mf-manifest.json";

export function isLocalSource(source: string): boolean {
  return source.startsWith("local://");
}

export function isBosSource(source: string): boolean {
  return source.startsWith("bos://");
}

export function parseLocalSource(source: string): string {
  // "local://plugins/dashboard" → "plugins/dashboard"
  return source.slice("local://".length).replace(/\/+$/, "");
}

export function parseBosRef(source: string): {
  account: string;
  domain: string;
  fieldPath?: string;
} {
  // "bos://dev.everything.near/dev.everything.dev#app.auth"
  const rest = source.slice("bos://".length);
  const [addr, fieldPath] = rest.split("#");
  const slash = addr.indexOf("/");
  const account = slash === -1 ? addr : addr.slice(0, slash);
  const domain = slash === -1 ? addr : addr.slice(slash + 1);
  return { account, domain, fieldPath };
}

function fallbackName(path: string): string {
  return path.split("/").filter(Boolean).join("-");
}

/**
 * Resolve one `source` URI → concrete remote info. Local sources resolve through
 * the port map (dev) or deploy map (prod); bos sources delegate to the
 * extendsResolver strategy.
 */
export async function resolveSource(
  source: string,
  ctx: ResolveContext,
): Promise<ResolvedModule> {
  if (isLocalSource(source)) {
    const path = parseLocalSource(source);
    const name = ctx.nameOf ? ctx.nameOf(path) : fallbackName(path);

    if (ctx.mode === "production") {
      const deploy = ctx.deployMap?.get(path);
      if (!deploy) {
        throw new Error(
          `[resolver] no deploy record for "${source}" (built "local://${path}" but deployMap has no entry)`,
        );
      }
      return { name, url: deploy.url, entry: `${deploy.url}/${MF_MANIFEST}`, integrity: deploy.integrity };
    }

    const port = ctx.portMap?.get(path);
    if (!port) {
      throw new Error(
        `[resolver] no port allocated for "${source}" (local://${path} not in portMap)`,
      );
    }
    const url = `http://localhost:${port}`;
    return { name, url, entry: `${url}/${MF_MANIFEST}` };
  }

  if (isBosSource(source)) {
    const resolver = ctx.extendsResolver;
    if (!resolver) {
      throw new Error(
        `[resolver] no extendsResolver configured for "${source}" — cannot resolve bos:// reference`,
      );
    }
    const resolved = await resolver(source);
    if (!resolved) {
      throw new Error(`[resolver] extendsResolver returned null for "${source}"`);
    }
    return resolved;
  }

  throw new Error(`[resolver] unrecognized source URI: "${source}"`);
}

export interface AppDescriptor {
  id: string;
  /** `local://path` — standalone UI-only plugins */
  ui?: Record<string, string>;
  /** `local://path` or `bos://...` — full-stack plugins */
  plugins?: Record<
    string,
    {
      api?: string;
      ui?: string;
    }
  >;
}

export interface ResolvedApp {
  id: string;
  api: Array<ResolvedModule & { ns: string; moduleKey: string }>;
  ui: Array<ResolvedModule & { ns: string }>;
}

/**
 * The single resolution function. Takes a plain `AppDescriptor` and a resolve
 * context, returns the shape the host consumes. This is the prototype stand-in
 * for the production `resolveApp()` (which reads `bos.config.json` and merges
 * extends chains — the URI semantics are identical).
 */
export async function resolveApp(
  app: AppDescriptor,
  ctx: ResolveContext,
): Promise<ResolvedApp> {
  const api: ResolvedApp["api"] = [];
  const ui: ResolvedApp["ui"] = [];

  for (const [ns, source] of Object.entries(app.ui ?? {})) {
    const resolved = await resolveSource(source, ctx);
    ui.push({ ns, ...resolved });
  }

  for (const [ns, entry] of Object.entries(app.plugins ?? {})) {
    if (entry.api) {
      const resolved = await resolveSource(entry.api, ctx);
      api.push({ ns, moduleKey: "api", ...resolved });
    }
    if (entry.ui) {
      const resolved = await resolveSource(entry.ui, ctx);
      ui.push({ ns, ...resolved });
    }
  }

  return { id: app.id, api, ui };
}
