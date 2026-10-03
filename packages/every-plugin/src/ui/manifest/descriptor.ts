import { MOUNT_REGISTRY_VERSION } from "./mount-registry";

/**
 * Shape-of-028 descriptor slice (ADR 0005 / plan 028) — composition-resolver
 * surface only. Pure data: `App({...})` returns a typed object. `extends`
 * resolves child-wins over the base app's plugins (publish-time flattening
 * model of wayfinder ticket 08). Plan 028 will declaration-merge
 * `KnownPlugins` from generated types; until then the interface is empty and
 * `Plugin("bogus")` does not compile.
 */

export interface RemoteSource {
  kind: "local" | "remote";
  path?: string;
  mfName?: string;
  url?: string;
}

export interface PluginRef {
  key: string;
  source: RemoteSource;
}

export interface ResolvedApp {
  name: string;
  plugins: Record<string, PluginRef>;
}

export interface PluginRefInput {
  name: string;
  source: RemoteSource;
}

export interface AppInput {
  name: string;
  extends?: string;
  plugins: Record<string, PluginRefInput>;
}

/** Declaration-merged from generated types by plan 028 — must stay an interface (types cannot merge). */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merge surface
export interface KnownPlugins {}

export function App(input: AppInput): AppInput {
  return input;
}

export function Plugin<K extends keyof KnownPlugins & string>(
  name: K,
): {
  local: (path: string) => PluginRefInput;
  remote: (mfName: string, url: string) => PluginRefInput;
} {
  return {
    local: (path) => ({ name, source: { kind: "local", path } }),
    remote: (mfName, url) => ({ name, source: { kind: "remote", mfName, url } }),
  };
}

/** Flatten an app against the registry of apps: `extends` inherits the base's plugins, child wins. */
export function resolveApp(input: AppInput, apps: Record<string, AppInput>): ResolvedApp {
  const base = input.extends ? apps[input.extends] : undefined;
  if (input.extends && !base) throw new Error(`extends target "${input.extends}" not found`);
  const plugins: Record<string, PluginRef> = {};
  for (const [key, ref] of Object.entries(base?.plugins ?? {})) {
    plugins[key] = { key, ...ref };
  }
  for (const [key, ref] of Object.entries(input.plugins)) {
    plugins[key] = { key, ...ref };
  }
  return { name: input.name, plugins };
}

export interface CompositionDigestInput {
  /** optional app label — deliberately NOT a tree-identity input; omit for server/client parity */
  appName?: string;
  plugins: Array<{ key: string; mfName: string }>;
  manifests: Array<unknown>;
}

/**
 * Composition digest — sha256 (WebCrypto) over everything that determines
 * the tree: app name, plugin keys, MF names, manifests, and the imported
 * `MOUNT_REGISTRY_VERSION`. Deployment URLs are deliberately excluded so
 * disk and prod paths digest identically (hydration parity).
 */
export async function digestOf(input: CompositionDigestInput): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...input, mountRegistryVersion: MOUNT_REGISTRY_VERSION }),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
