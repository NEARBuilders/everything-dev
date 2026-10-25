/**
 * The composition inspector's generator (#591/#594): a *generated,
 * machine- and human-readable* effective route tree for a resolved runtime.
 *
 * Reads every ui source's route manifest (local `src/manifest.gen.json`, or
 * the published `<ui>/manifest.gen.json` for remote sources), applies the
 * same core-wins precedence the host's `constructTree` applies at runtime,
 * and emits:
 *
 *   .bos/generated/runtime-map.json   machine/human inventory
 *   ui/src/lib/runtime-map.gen.ts     typed REMOTE_ROUTES union + metadata
 *
 * This is a *static model* of composition: nav labels are runtime-only (they
 * live in route options, not manifests) and are reported as null.
 *
 * Loud degradation: a remote manifest that can't be fetched is reported as
 * UNRESOLVED and — in strict mode (`bos types gen`) — fails the run, so
 * typecheck catches an upstream rename instead of silently shrinking the
 * map. Dev/build/train paths run warn-mode (a flaky remote must not block a
 * boot; the runtime load fails loudly on its own). Set
 * BOS_MAP_ALLOW_UNRESOLVED=1 for offline work (the map is still written,
 * with the unresolved sources).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  MANIFEST_VERSION,
  type PluginManifest,
  resolveMountSegment,
} from "every-plugin/ui/manifest";
import type { RuntimeConfig } from "../../types";

const CORE_UI_KEY = "ui";
const FETCH_TIMEOUT_MS = Number(process.env.BOS_MAP_FETCH_TIMEOUT_MS ?? 15_000);

export interface RouteRecord {
  id: string;
  type: string;
  path?: string;
  parentId?: string;
  mount?: string;
}

export interface MapSource {
  key: string;
  kind: "core" | "auth-ui" | "plugin-ui";
  source: "local" | "remote";
  location: string;
  manifestPath?: string;
  manifestUrl?: string;
  pin?: string;
  note?: string;
  manifest: PluginManifest;
}

export interface UnresolvedSource {
  key: string;
  kind: string;
  reason: string;
}

export interface ComposedRoute {
  id: string;
  owner: string;
  mount: string;
  type: string;
  path: string | null;
  fullPath: string;
  core: boolean;
  nav: null;
}

export interface ComposedRuntimeMap {
  mounts: Array<{ id: string; declaredBy: string; recordId: string }>;
  routes: ComposedRoute[];
  shadowed: Array<{ id: string; owner: string; kind: "mount" | "route"; reason: string }>;
}

function joinPath(a: string, b?: string): string {
  const left = a && a !== "/" ? a.replace(/\/+$/, "") : "";
  const right = b && b !== "/" ? (b ?? "").replace(/^\/+/, "") : "";
  if (!left) return right ? `/${right}` : "/";
  if (!right) return left;
  return `${left}/${right}`;
}

function isHttp(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function manifestUrlFor(base: string): string {
  return new URL("manifest.gen.json", base.endsWith("/") ? base : `${base}/`).toString();
}

interface SourceDescriptor {
  key: string;
  kind: "core" | "auth-ui" | "plugin-ui";
  source: "local" | "remote";
  location: string;
  manifestPath?: string;
  manifestUrl?: string;
  pin?: string;
  note?: string;
}

function describeSlot(
  _root: string,
  key: string,
  kind: SourceDescriptor["kind"],
  slot:
    | { url?: string; localPath?: string; source?: string; pin?: { manifest?: string } }
    | undefined,
  unresolved: UnresolvedSource[],
): SourceDescriptor | null {
  if (!slot) return null;
  const pin = slot.pin?.manifest;
  if (slot.localPath) {
    const manifestPath = join(slot.localPath, "src/manifest.gen.json");
    if (existsSync(manifestPath)) {
      return { key, kind, source: "local", location: slot.localPath, manifestPath, pin };
    }
    if (isHttp(slot.url)) {
      return {
        key,
        kind,
        source: "remote",
        location: slot.url,
        manifestUrl: manifestUrlFor(slot.url),
        pin,
        note: `local path "${slot.localPath}" is absent; using the published bundle`,
      };
    }
    unresolved.push({
      key,
      kind,
      reason: `local path "${slot.localPath}" is absent and there is no production target`,
    });
    return null;
  }
  if (isHttp(slot.url)) {
    return {
      key,
      kind,
      source: "remote",
      location: slot.url,
      manifestUrl: manifestUrlFor(slot.url),
      pin,
    };
  }
  unresolved.push({ key, kind, reason: "no local workspace or remote target" });
  return null;
}

function validateManifest(source: SourceDescriptor, manifest: PluginManifest): void {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.routes)) {
    throw new Error(`source "${source.key}": manifest is not a route manifest`);
  }
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `source "${source.key}": manifest version ${manifest.manifestVersion} (expected ${MANIFEST_VERSION})`,
    );
  }
}

/**
 * Static model of every-plugin's `constructTree` precedence: core ui first,
 * then sources by key; core wins route/mount claims, peer collisions throw.
 */
export function composeRuntimeMap(
  sources: Array<SourceDescriptor & { manifest: PluginManifest }>,
): ComposedRuntimeMap {
  const ordered = [
    ...sources.filter((source) => source.key === CORE_UI_KEY),
    ...sources
      .filter((source) => source.key !== CORE_UI_KEY)
      .sort((a, b) => a.key.localeCompare(b.key)),
  ];

  const mounts = new Map<string, { key: string; recordId: string }>();
  const mountByLayoutId = new Map<string, string>();
  const shadowed: ComposedRuntimeMap["shadowed"] = [];

  for (const source of ordered) {
    for (const record of source.manifest.routes) {
      if (!record.mount) continue;
      const existing = mounts.get(record.mount);
      if (existing) {
        if (existing.key === CORE_UI_KEY && source.key !== CORE_UI_KEY) {
          shadowed.push({
            id: record.id,
            owner: source.key,
            kind: "mount",
            reason: `mount "${record.mount}" is declared by core ui`,
          });
          mountByLayoutId.set(record.id, record.mount);
          continue;
        }
        throw new Error(
          `mount "${record.mount}" declared by multiple sources: "${existing.key}" and "${source.key}"`,
        );
      }
      mounts.set(record.mount, { key: source.key, recordId: record.id });
      mountByLayoutId.set(record.id, record.mount);
    }
  }

  const routes: ComposedRoute[] = [];
  const claims = new Map<string, Map<string, string>>();

  for (const source of ordered) {
    const pending = source.manifest.routes.filter((record) => !record.mount);
    const byId = new Map<string, { fullPath: string; mount: string }>();
    const shadowedIds = new Set<string>();
    let progressed = true;

    while (pending.length > 0 && progressed) {
      progressed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const record = pending[index]!;

        let parent: { fullPath: string; mount: string; key: string };
        if (record.parentId) {
          if (shadowedIds.has(record.parentId)) {
            shadowedIds.add(record.id);
            shadowed.push({
              id: record.id,
              owner: source.key,
              kind: "route",
              reason: `parent "${record.parentId}" is shadowed`,
            });
            pending.splice(index, 1);
            index -= 1;
            progressed = true;
            continue;
          }
          const local = byId.get(record.parentId);
          if (local) {
            parent = {
              fullPath: local.fullPath,
              mount: local.mount,
              key: `${source.key}:${record.parentId}`,
            };
          } else if (mountByLayoutId.has(record.parentId)) {
            const mount = mountByLayoutId.get(record.parentId)!;
            parent = { fullPath: "", mount, key: `mount:${mount}` };
          } else {
            continue;
          }
        } else {
          const firstSegment = record.id.split("/")[0] ?? "";
          if (!firstSegment.startsWith("_")) {
            throw new Error(`route "${record.id}" in "${source.key}" must live under a mount`);
          }
          const mount = resolveMountSegment(firstSegment.slice(1));
          if (!mount) {
            throw new Error(
              `unknown mount "_${firstSegment.slice(1)}" (route "${record.id}" in "${source.key}")`,
            );
          }
          if (!mounts.has(mount)) {
            throw new Error(
              `mount "${mount}" is not declared by any source (route "${record.id}" in "${source.key}")`,
            );
          }
          parent = { fullPath: "", mount, key: `mount:${mount}` };
        }

        pending.splice(index, 1);
        index -= 1;
        progressed = true;

        const isLayoutRoute = record.type === "layout" || record.path === undefined;
        if (!isLayoutRoute) {
          const siblings = claims.get(parent.key) ?? new Map<string, string>();
          const claimant = siblings.get(record.path!);
          if (claimant) {
            if (source.key !== CORE_UI_KEY && claimant.startsWith(`${CORE_UI_KEY}:`)) {
              shadowedIds.add(record.id);
              shadowed.push({
                id: record.id,
                owner: source.key,
                kind: "route",
                reason: `path "${record.path}" is claimed by "${claimant}"`,
              });
              continue;
            }
            throw new Error(
              `path collision: "${source.key}" route "${record.id}" declares "${record.path}" already claimed by "${claimant}"`,
            );
          }
          siblings.set(record.path!, `${source.key}:${record.id}`);
          claims.set(parent.key, siblings);
        }

        const fullPath = joinPath(parent.fullPath, record.path);
        byId.set(record.id, { fullPath, mount: parent.mount });
        routes.push({
          id: record.id,
          owner: source.key,
          mount: parent.mount,
          type: record.type,
          path: record.path ?? null,
          fullPath,
          core: source.key === CORE_UI_KEY,
          nav: null,
        });
      }
    }

    if (pending.length > 0) {
      throw new Error(
        `unresolvable parentage in "${source.key}": ${pending.map((record) => record.id).join(", ")}`,
      );
    }
  }

  return {
    mounts: [...mounts.entries()].map(([id, value]) => ({
      id,
      declaredBy: value.key,
      recordId: value.recordId,
    })),
    routes,
    shadowed,
  };
}

async function fetchRemoteManifest(url: string): Promise<PluginManifest> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return (await response.json()) as PluginManifest;
}

async function fetchPluginManifestAsset(url: string): Promise<PluginManifestAsset> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const asset = (await response.json()) as PluginManifestAsset;
  if (!asset || typeof asset !== "object" || asset.kind !== "every-plugin/manifest") {
    throw new Error("not a plugin manifest");
  }
  return asset;
}

function pluginManifestUrlFor(base: string): string {
  return new URL("plugin.manifest.json", base.endsWith("/") ? base : `${base}/`).toString();
}

/** The backend inventory (#594 review): host, api, the auth server, and every
 * plugin backend — the "who serves this runtime, from where" analog of the ui
 * sources list. Local backends are their own truth (workspace path); remote
 * backends fetch their published `plugin.manifest.json` for the version +
 * contract hash drift signal. The host is source-level only (it ships no
 * manifest asset — it is not an every-plugin module). */
function describeBackend(
  root: string,
  key: string,
  kind: BackendRecord["kind"],
  slot:
    | {
        name?: string;
        url?: string;
        localPath?: string;
        source?: string;
        remoteUrl?: string;
        remoteEntry?: string;
        pin?: { manifest?: string };
        integrity?: string;
        dependsOn?: string[];
      }
    | undefined,
): BackendRecord | null {
  if (!slot) return null;
  const name = typeof slot.name === "string" ? slot.name : null;
  const pin = slot.pin?.manifest;
  const dependsOn = slot.dependsOn;
  if (slot.localPath) {
    return {
      key,
      kind,
      name,
      source: "local",
      location: slot.localPath.startsWith(root)
        ? slot.localPath.slice(root.length + 1)
        : slot.localPath,
      ...(pin ? { pin } : {}),
      ...(slot.integrity ? { integrity: slot.integrity } : {}),
      ...(dependsOn ? { dependsOn } : {}),
    };
  }
  const remote = slot.remoteUrl ?? slot.url;
  if (isHttp(remote)) {
    return {
      key,
      kind,
      name,
      source: "remote",
      location: remote,
      pluginManifestUrl: pluginManifestUrlFor(remote),
      ...(pin ? { pin } : {}),
      ...(slot.integrity ? { integrity: slot.integrity } : {}),
      ...(dependsOn ? { dependsOn } : {}),
    };
  }
  return null;
}

export interface RuntimeMapResult {
  routeCount: number;
  remoteCount: number;
  sourceCount: number;
  backendCount: number;
  unresolved: UnresolvedSource[];
  jsonPath: string;
  tsPath: string | undefined;
}

/** The published `plugin.manifest.json` (EmitPluginManifest asset) — the
 * backend inventory's remote drift signal: which plugin version, and which
 * contract bytes, is this runtime actually composing? */
export interface PluginManifestAsset {
  schemaVersion: number;
  kind: string;
  plugin?: { name?: string; version?: string };
  contract?: { types?: { sha256?: string } };
}

export interface BackendRecord {
  key: string;
  kind: "host" | "api" | "auth" | "plugin";
  name: string | null;
  source: "local" | "remote";
  /** Workspace-relative path (local) or URL (remote). */
  location: string;
  pin?: string;
  integrity?: string;
  dependsOn?: string[];
  /** Remote backends only: the composed plugin bundle's version + contract
   * hash, from its published `plugin.manifest.json`. */
  pluginVersion?: string;
  contractSha256?: string;
  /** Where the remote manifest asset was fetched from. */
  pluginManifestUrl?: string;
  note?: string;
}

/** The TS emission requires a local core ui workspace (`ui/src/lib/`); a
 * remote-only core ui skips it with a note. */
function renderTypeScript(map: GeneratedRuntimeMap): string {
  const remoteRoutes = map.routes
    .filter((route) => !route.core)
    .map((route) => ({
      id: route.id,
      path: route.fullPath,
      mount: route.mount,
      owner: route.owner,
      type: route.type,
    }));
  const json = (value: unknown) => JSON.stringify(value, null, 2);

  return `// Generated by bos types gen — do not edit.
// Regenerate with \`bos types gen\` (or \`pnpm run types:gen\`). A static model of the
// composed runtime: core ui wins route/mount claims; plugin routes are listed
// below. Nav labels are runtime-only (route options, not manifests).
// See docs/agents/runtime-map.md for the investigation workflows.

export const RUNTIME_MAP_GENERATED_AT = ${JSON.stringify(map.generatedAt)};
export const RUNTIME_MAP_ENV = ${JSON.stringify(map.env)};
export const RUNTIME_PLATFORM = ${JSON.stringify(map.platform)};

export const RUNTIME_SOURCES = ${json(map.sources)} as const;

/** The serving side: host, api, the auth server, and every plugin backend —
 * source-level inventory; remote entries carry the composed plugin version
 * and contract hash. */
export const RUNTIME_BACKENDS = ${json(map.backends)} as const;
export type RuntimeBackend = (typeof RUNTIME_BACKENDS)[number];

/** Routes owned by a plugin/remote ui source (not the core). */
export const REMOTE_ROUTES = ${json(remoteRoutes)} as const;
export type RemoteRoute = (typeof REMOTE_ROUTES)[number];
export type RemotePath = RemoteRoute["path"];

export const RUNTIME_MOUNTS = ${json(map.mounts)} as const;
export const SHADOWED_ROUTES = ${json(map.shadowed)} as const;

export const UNRESOLVED_SOURCES = ${json(map.unresolved)} as const;
export type UnresolvedSource = (typeof UNRESOLVED_SOURCES)[number];
`;
}

interface GeneratedRuntimeMap {
  generatedAt: string;
  env: string;
  platform: string | null;
  extends: string | null;
  sources: Array<{
    key: string;
    kind: string;
    source: string;
    location: string;
    manifestUrl: string | null;
    pin: string | null;
    note: string | null;
  }>;
  backends: BackendRecord[];
  unresolved: UnresolvedSource[];
  mounts: ComposedRuntimeMap["mounts"];
  routes: ComposedRuntimeMap["routes"];
  shadowed: ComposedRuntimeMap["shadowed"];
}

export const generateRuntimeMapEffect = Effect.fn("generateRuntimeMap")(function* (
  configDir: string,
  runtimeConfig: RuntimeConfig,
  opts?: { strict?: boolean; env?: string; platform?: string | null; extendsChain?: string[] },
): Effect.fn.Return<RuntimeMapResult | null, Error> {
  const allowUnresolved = process.env.BOS_MAP_ALLOW_UNRESOLVED === "1";
  const unresolved: UnresolvedSource[] = [];

  const descriptors = [
    describeSlot(configDir, CORE_UI_KEY, "core", runtimeConfig.ui, unresolved),
    describeSlot(configDir, "auth", "auth-ui", runtimeConfig.auth?.ui, unresolved),
  ];
  for (const [key, plugin] of Object.entries(runtimeConfig.plugins ?? {})) {
    // `plugins.auth` is the auth mirror (the auth app slot's backend owns
    // it — planner isAuthMirrorFor): its ui is the same source already
    // described under the "auth" key — describing it twice collides with
    // its own claims.
    if (key === "auth" && runtimeConfig.auth !== undefined) continue;
    descriptors.push(describeSlot(configDir, key, "plugin-ui", plugin.ui, unresolved));
  }

  const sources: Array<SourceDescriptor & { manifest: PluginManifest }> = [];
  for (const descriptor of descriptors) {
    if (!descriptor) continue;
    if (descriptor.source === "local" && descriptor.manifestPath) {
      const manifest = JSON.parse(readFileSync(descriptor.manifestPath, "utf8")) as PluginManifest;
      validateManifest(descriptor, manifest);
      sources.push({ ...descriptor, manifest });
    } else if (descriptor.manifestUrl) {
      // Effect generators cannot await — the fetch failure degrades to an
      // unresolved entry inside the promise.
      yield* Effect.tryPromise({
        try: async () => {
          try {
            const manifest = await fetchRemoteManifest(descriptor.manifestUrl!);
            validateManifest(descriptor, manifest);
            sources.push({ ...descriptor, manifest });
          } catch (error) {
            unresolved.push({
              key: descriptor.key,
              kind: descriptor.kind,
              reason: `fetch ${descriptor.manifestUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        },
        catch: (cause) => new Error(String(cause)),
      });
    }
  }

  // Backend inventory (#594 review): the auth mirror dedupes against the
  // auth app slot's backend (same source, same key collision rule). Effect
  // generators cannot await — the fetch loop runs inside the promise.
  const backendSlots: Array<BackendRecord | null> = [
    describeBackend(configDir, "host", "host", runtimeConfig.host),
    describeBackend(configDir, "api", "api", runtimeConfig.api),
    describeBackend(configDir, "auth", "auth", runtimeConfig.auth),
  ];
  for (const [key, plugin] of Object.entries(runtimeConfig.plugins ?? {})) {
    if (key === "auth" && runtimeConfig.auth !== undefined) continue;
    backendSlots.push(describeBackend(configDir, key, "plugin", plugin));
  }
  const backends: BackendRecord[] = yield* Effect.tryPromise({
    try: async () => {
      const collected: BackendRecord[] = [];
      for (const backend of backendSlots) {
        if (!backend) continue;
        if (backend.pluginManifestUrl) {
          try {
            const asset = await fetchPluginManifestAsset(backend.pluginManifestUrl);
            collected.push({
              ...backend,
              pluginVersion: asset.plugin?.version,
              contractSha256: asset.contract?.types?.sha256,
            });
          } catch (error) {
            const reason = `plugin manifest ${backend.pluginManifestUrl} failed: ${error instanceof Error ? error.message : String(error)}`;
            unresolved.push({ key: backend.key, kind: backend.kind, reason });
            collected.push({ ...backend, note: reason });
          }
        } else {
          collected.push(backend);
        }
      }
      return collected;
    },
    catch: (cause) => new Error(String(cause)),
  });

  if (sources.length === 0 && unresolved.length === 0 && backends.length === 0) return null;

  if (unresolved.length > 0 && !allowUnresolved) {
    for (const entry of unresolved) {
      console.error(`[runtime-map] UNRESOLVED ${entry.key} (${entry.kind}): ${entry.reason}`);
    }
    if (opts?.strict) {
      return yield* Effect.fail(
        new Error(
          "runtime map is incomplete — fix the source or set BOS_MAP_ALLOW_UNRESOLVED=1 for offline work",
        ),
      );
    }
  }

  const composed = composeRuntimeMap(sources);
  const map: GeneratedRuntimeMap = {
    generatedAt: new Date().toISOString(),
    env: opts?.env ?? "unknown",
    platform: opts?.platform ?? null,
    extends: opts?.extendsChain?.join(" → ") ?? null,
    sources: sources.map((source) => ({
      key: source.key,
      kind: source.kind,
      source: source.source,
      // workspace-relative for local sources — no absolute paths in the
      // committed/generated surface
      location:
        source.source === "local" && source.location.startsWith(configDir)
          ? source.location.slice(configDir.length + 1)
          : source.location,
      manifestUrl: source.manifestUrl ?? null,
      pin: source.pin ?? null,
      note: source.note ?? null,
    })),
    backends,
    unresolved,
    mounts: composed.mounts,
    routes: composed.routes,
    shadowed: composed.shadowed,
  };

  const jsonPath = join(configDir, ".bos/generated/runtime-map.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(map, null, 2)}\n`);

  // The TS emission requires a local core ui workspace; a remote-only core
  // ui skips it with a note.
  let tsPath: string | undefined;
  const uiLocalPath = runtimeConfig.ui?.source === "local" ? runtimeConfig.ui.localPath : undefined;
  if (uiLocalPath && existsSync(join(uiLocalPath, "src"))) {
    tsPath = join(uiLocalPath, "src/lib/runtime-map.gen.ts");
    mkdirSync(dirname(tsPath), { recursive: true });
    writeFileSync(tsPath, renderTypeScript(map));
  }

  const remoteCount = map.routes.filter((route) => !route.core).length;
  const remoteBackends = backends.filter((backend) => backend.source === "remote").length;
  console.log(
    `[runtime-map] ${map.routes.length} routes (${remoteCount} remote) from ${sources.length} sources; ${backends.length} backends (${remoteBackends} remote)`,
  );
  for (const entry of unresolved) {
    console.warn(`[runtime-map] unresolved ${entry.key}: ${entry.reason}`);
  }
  console.log(
    `[runtime-map] wrote ${jsonPath}${tsPath ? ` + ${tsPath}` : " (no local core ui — ts emission skipped)"}`,
  );

  return {
    routeCount: map.routes.length,
    remoteCount,
    sourceCount: sources.length,
    backendCount: backends.length,
    unresolved,
    jsonPath,
    tsPath,
  };
});
