/**
 * Minimal shape-of-028 descriptor slice (ADR 0005 / plan 028) — the
 * composition-resolver slice only. Pure data: `App({...})` returns a typed
 * object; the host consumes it. `extends` resolves child-wins over the base
 * app's plugins (the publish-time-flattening model of wayfinder ticket 08).
 *
 * Explicitly OUT (they belong to plan 028's full surface): account/domain,
 * FastKV extends CHAINS (depth > 1), stage, resources/bindings, auth/api.
 */
import { MOUNT_REGISTRY_VERSION } from "./mount-registry";

export type RemoteSource =
  | { kind: "local"; /** path relative to the prototype root */ path: string }
  | { kind: "remote"; mfName: string; /** remoteEntry.server.js URL of the deployed SSR bundle */ url: string };

export interface PluginRef {
  key: string;
  source: RemoteSource;
}

export interface ResolvedApp {
  name: string;
  plugins: Record<string, PluginRef>;
}

export interface AppInput {
  name: string;
  /** name of the base app whose plugins this app inherits (child-wins) */
  extends?: string;
  plugins: Record<string, PluginRefInput>;
}

export interface PluginRefInput {
  name: string;
  source: RemoteSource;
}

// In production (plan 028) `KnownPlugins` is declaration-merged from
// generated `.bos/plugin-types.d.ts`. The prototype declares the two
// prototype plugins here — the shape is what matters: `Plugin("bogus")`
// must not compile.
export interface KnownPlugins {
  auth: "auth";
  landing: "landing";
}

export function App(input: AppInput): AppInput {
  return input;
}

export function Plugin<K extends keyof KnownPlugins & string>(
  name: K,
): { local: (path: string) => PluginRefInput; remote: (mfName: string, url: string) => PluginRefInput } {
  return {
    local: (path: string) => ({ name, source: { kind: "local", path } }),
    remote: (mfName: string, url: string) => ({ name, source: { kind: "remote", mfName, url } }),
  };
}

/**
 * Flatten an app against the registry of apps: `extends` inherits the base's
 * plugins, the child's entries win. Depth-1 only (chains are plan 028).
 */
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
  appName: string;
  plugins: Array<{ key: string; mfName: string; url: string }>;
  manifests: Array<unknown>;
}

/** Composition digest — sha256 over everything that determines the tree. */
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
