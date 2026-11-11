import { readFileSync } from "node:fs";
import { createInstance, getInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import {
  createPluginRuntime as createManagedPluginRuntime,
  type InferRegistryFromEntries,
  type PluginRegistryEntry,
  type PluginRuntime,
  type PluginRuntimeConfig,
} from "every-plugin";
import { isEffectCriticalSharedDep } from "every-plugin/build/rspack";
import type { BosConfig, BosPluginRef } from "../../types";
import { fetchRaw } from "../../utils/http-client";
import { satisfiesConstraint } from "../../utils/semver";
import type { IntegrityRegistry } from "../deploy/integrity";
import { pinnedManifestDocumentUrl, resolveRemoteVersion } from "../deploy/version-manifest";
import { readBundleCache, writeBundleCache } from "../registry/bundle-cache";
import { computeSri, IntegrityMismatch } from "../verify/engine";

type FederationInstance = ReturnType<typeof createInstance>;

let mfInstance: FederationInstance | null = null;

export function patchManifestFetchForSsrPublicPath(mf: FederationInstance): void {
  if (!mf || !(mf as any).loaderHook?.lifecycle?.fetch?.on) return;
  if ((mf as any).__everythingDevPatchedManifestFetch === true) return;
  (mf as any).__everythingDevPatchedManifestFetch = true;

  (mf as any).loaderHook.lifecycle.fetch.on((url: unknown, init: unknown) => {
    if (typeof url !== "string" || !url.endsWith("/mf-manifest.json")) {
      return;
    }
    return fetchRaw(url as string, init as RequestInit, "15 seconds")
      .then((res) => res.json())
      .then((json: any) => {
        json.metaData = json.metaData ?? {};
        json.metaData.ssrPublicPath =
          json.metaData.ssrPublicPath ?? url.replace(/\/mf-manifest\.json$/, "/");
        if (json.metaData.publicPath === "auto" || json.metaData.publicPath === "") {
          json.metaData.publicPath = "/";
        }
        return new Response(JSON.stringify(json), {
          headers: { "content-type": "application/json" },
        });
      });
  });
}

export function installIntegrityFetchHook(
  mf: FederationInstance,
  registry: IntegrityRegistry,
  options?: { cacheDir?: string },
): void {
  if (!mf || !(mf as any).loaderHook?.lifecycle?.fetch?.on) {
    console.warn("[SRI] MF lifecycle fetch hook not available, skipping integrity-in-pipeline");
    return;
  }
  if ((mf as any).__everythingDevIntegrityHook === true) return;
  (mf as any).__everythingDevIntegrityHook = true;

  (mf as any).loaderHook.lifecycle.fetch.on((url: unknown, init: unknown) => {
    if (typeof url !== "string") return;

    const expectedHash = registry.get(url);
    if (!expectedHash) return;

    return fetchRaw(url as string, init as RequestInit, "15 seconds").then(async (res) => {
      const buffer = Buffer.from(await res.arrayBuffer());
      const computed = computeSri(new Uint8Array(buffer));

      if (computed !== expectedHash) {
        // ticket 09 (atomic-deploys): an SRI mismatch is treated like an
        // origin failure — the last-known-good bytes (which satisfied the
        // same pin when cached) serve instead, and the corrupted bytes are
        // never written into the cache.
        const cached = await readBundleCache(url as string, { cacheDir: options?.cacheDir });
        if (cached && computeSri(new Uint8Array(cached)) === expectedHash) {
          console.warn(
            `[SRI] Origin bytes failed verification for ${url} — serving last-known-good from the bundle cache`,
          );
          return new Response(cached.slice().buffer, {
            status: 200,
            headers: { "x-bundle-cache": "stale" },
          });
        }
        const mismatch = new IntegrityMismatch({
          url,
          expected: expectedHash,
          actual: computed,
        });
        console.error(`[SRI] ${mismatch._tag} in the MF fetch pipeline — ${mismatch.message}`);
        return new Response(
          `${mismatch._tag}: integrity check failed for ${url} (expected ${expectedHash}, actual ${computed})`,
          {
            status: 500,
            statusText: "Integrity Check Failed",
          },
        );
      }

      // verified: pin-checked write-through
      await writeBundleCache(url as string, new Uint8Array(buffer), {
        cacheDir: options?.cacheDir,
      }).catch(() => {
        // write-through is best-effort
      });

      return new Response(buffer, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    });
  });
}

export interface HostPluginRuntimeOptions {
  /** The integrity-in-pipeline registry: resolved artifact URLs → pin SRI.
   * When present, the MF fetch hook installs inside this factory — the
   * loader verifies every registered byte at fetch time (#642 revival). */
  readonly integrityRegistry?: IntegrityRegistry;
  readonly cacheDir?: string;
}

export function createPluginRuntime<TRegistry extends Record<string, PluginRegistryEntry>>(
  config: PluginRuntimeConfig<TRegistry>,
  options?: HostPluginRuntimeOptions,
): PluginRuntime<InferRegistryFromEntries<TRegistry>> {
  const runtime = createManagedPluginRuntime(config);
  if (options?.integrityRegistry) {
    try {
      installIntegrityFetchHook(getFederationInstance(), options.integrityRegistry, {
        cacheDir: options.cacheDir,
      });
    } catch (error) {
      console.warn(
        `[SRI] MF instance unavailable for the integrity hook — verification degrades to the entry gates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return runtime;
}

export function getFederationInstance(): FederationInstance {
  if (mfInstance) return mfInstance;

  const existing = getInstance();
  if (existing) {
    mfInstance = existing as FederationInstance;
    setGlobalFederationInstance(mfInstance as any);
    patchManifestFetchForSsrPublicPath(mfInstance);
    return mfInstance;
  }

  mfInstance = createInstance({
    name: "host",
    remotes: [],
  }) as FederationInstance;
  setGlobalFederationInstance(mfInstance as any);
  patchManifestFetchForSsrPublicPath(mfInstance);
  return mfInstance;
}

export async function registerRemote(opts: {
  name: string;
  entry: string;
  type?: "manifest" | "script";
}): Promise<void> {
  const instance = getFederationInstance();

  const inferType = (): "manifest" | "script" => {
    if (opts.type) return opts.type;
    if (opts.entry.endsWith("/mf-manifest.json")) return "manifest";
    if (/\/remoteEntry(\.[a-f0-9]{8,})?\.js$/.test(opts.entry)) return "script";
    return typeof window === "undefined" ? "script" : "manifest";
  };

  const remoteType = inferType();

  instance.registerRemotes([
    {
      name: opts.name,
      entry: opts.entry,
      type: remoteType,
    },
  ]);
}

export async function loadRemoteModule<T>(
  specifier: string,
  options?: { loadFactory?: boolean; from?: "build" | "runtime" },
): Promise<T> {
  const instance = getFederationInstance();

  const isServer = typeof window === "undefined";
  if (isServer) {
    await (instance as any).initializeSharing?.("default");
  }

  const mod = await instance.loadRemote<T>(specifier, options as any);
  if (!mod) {
    throw new Error(`Failed to load remote module: ${specifier}`);
  }
  return mod;
}

export async function ensureNodeRuntimePlugin(): Promise<void> {
  const instance = getFederationInstance();
  if (typeof window !== "undefined") return;
  if ((instance as any).__nodeRuntimePluginLoaded) return;

  const mod: any = await import("@module-federation/node/runtimePlugin");
  const factory = mod?.default ?? mod;
  const plugin = typeof factory === "function" ? factory() : null;
  if (plugin) {
    instance.registerPlugins([plugin]);
  }
  (instance as any).__nodeRuntimePluginLoaded = true;
}

export interface FederationCompatRemote {
  role: string;
  url: string;
  reachable: boolean;
  pluginVersion: string | null;
  ok: boolean;
  reason?: string;
}

export interface FederationCompatReport {
  ok: boolean;
  hostVersion: string | null;
  hostReachable: boolean;
  hostReason?: string;
  remotes: FederationCompatRemote[];
}

function manifestUrl(remoteUrl: string): string {
  return remoteUrl.endsWith("/") ? `${remoteUrl}mf-manifest.json` : `${remoteUrl}/mf-manifest.json`;
}

async function fetchManifest(url: string, timeoutMs: number): Promise<unknown> {
  // A pinned remote's resolved `browserManifestUrl` IS the manifest document
  // (hashed name); plain remote URLs are bases that the fixed name appends to.
  const target = url.endsWith(".json") ? url : manifestUrl(url);
  const res = await fetchRaw(target, {}, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function listFederationRemotes(bosConfig: BosConfig): Array<{ role: string; url: string }> {
  const out: Array<{ role: string; url: string }> = [];
  for (const role of ["api", "auth"] as const) {
    const url = readProductionUrl((bosConfig?.app as Record<string, unknown> | undefined)?.[role]);
    if (url) out.push({ role, url });
  }
  for (const [id, remote] of Object.entries(bosConfig?.plugins ?? {})) {
    const url = readProductionUrl(remote);
    if (url) out.push({ role: id, url });
  }
  return out;
}

export interface UiCompositionRemote {
  remote: string;
  url: string;
  reachable: boolean;
  ok: boolean;
  reason?: string;
}

export interface UiCompositionReport {
  ok: boolean;
  remotes: UiCompositionRemote[];
}

/**
 * The UI composition compat check (#546) — mf check's mirror of the host's
 * boot guard. The core UI remote is the composition's shared-singleton
 * provider; plugin UI remotes are consumers. Any singleton named by two or
 * more UI manifests at different versions fails the composition at
 * `mf.loadRemote` with the federation runtime's cryptic negotiation error —
 * this names the remotes and versions instead. Server remotes (api/auth) are
 * intentionally out of scope: the host-side `checkFederationCompat` covers
 * them against the host's own core map.
 */
export async function checkUiCompositionCompat(
  bosConfig: BosConfig | null,
  opts: { timeoutMs?: number } = {},
): Promise<UiCompositionReport> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const uiRemotes: Array<{ remote: string; url: string }> = [];
  const pushRemote = (remote: string, entry: unknown): void => {
    const asRef = entry as { browserManifestUrl?: string; production?: string };
    const url =
      typeof asRef?.browserManifestUrl === "string" && asRef.browserManifestUrl
        ? asRef.browserManifestUrl
        : readProductionUrl(entry);
    if (url) uiRemotes.push({ remote, url });
  };
  pushRemote("app.ui", (bosConfig?.app as Record<string, unknown> | undefined)?.ui);
  for (const [id, remote] of Object.entries(bosConfig?.plugins ?? {})) {
    if (!remote || typeof remote === "string") continue;
    const ui = (remote as BosPluginRef).ui;
    if (ui) pushRemote(`plugins.${id}.ui`, ui);
  }

  if (uiRemotes.length === 0) return { ok: true, remotes: [] };

  const resolved = await Promise.all(
    uiRemotes.map(async ({ remote, url }) => {
      try {
        const manifest = (await fetchManifest(url, timeoutMs)) as RemoteManifest;
        return { remote, url, reachable: true, shared: manifest.shared ?? [] };
      } catch (e) {
        return {
          remote,
          url,
          reachable: false,
          shared: [] as Array<{ name: string; version?: string }>,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const byName = new Map<string, Array<{ remote: string; version: string }>>();
  for (const entry of resolved) {
    for (const dep of entry.shared) {
      if (typeof dep.version !== "string") continue;
      const uses = byName.get(dep.name) ?? [];
      uses.push({ remote: entry.remote, version: dep.version });
      byName.set(dep.name, uses);
    }
  }

  const remotes: UiCompositionRemote[] = resolved.map((entry) => {
    if (!entry.reachable) {
      return {
        remote: entry.remote,
        url: uiRemotes.find((s) => s.remote === entry.remote)!.url,
        reachable: false,
        ok: false,
        reason: entry.reason,
      };
    }
    const skewed = [...byName.entries()].flatMap(([name, uses]) => {
      const first = uses[0]!;
      const diverged = uses.find((use) => use.version !== first.version);
      return diverged ? [name] : [];
    });
    if (skewed.length === 0) {
      return {
        remote: entry.remote,
        url: uiRemotes.find((s) => s.remote === entry.remote)!.url,
        reachable: true,
        ok: true,
      };
    }
    return {
      remote: entry.remote,
      url: uiRemotes.find((s) => s.remote === entry.remote)!.url,
      reachable: true,
      ok: false,
      reason: `shared singleton skew across UI remotes: ${skewed
        .map((name) => {
          const uses = byName.get(name)!;
          return `${name} is ${uses.map((use) => `${use.remote}=${use.version}`).join(", ")}`;
        })
        .join("; ")}`,
    };
  });

  return { ok: remotes.every((remote) => remote.ok), remotes };
}

function readProductionUrl(entry: unknown): string | null {
  if (typeof entry === "string") return entry.length > 0 ? entry : null;
  if (entry && typeof (entry as BosPluginRef).production === "string") {
    const url = (entry as BosPluginRef).production!;
    return url.length > 0 ? url : null;
  }
  return null;
}

interface RemoteManifest {
  metaData?: { pluginVersion?: string };
  shared?: Array<{ name: string; version?: string; requiredVersion?: string | null }>;
}

export async function checkFederationCompat(
  bosConfig: BosConfig | null,
  opts: { timeoutMs?: number } = {},
): Promise<FederationCompatReport> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (!bosConfig?.app?.host?.production) {
    return { ok: true, hostVersion: null, hostReachable: false, remotes: [] };
  }

  const hostUrl = bosConfig.app.host.production;
  // Probe the pin's immutable coordinates when the slot pins one (#874) —
  // the fixed name at the mutable slot root answers with the newest bytes,
  // so the check would grade the composition the boot will never load.
  // Resolution failure keeps the floating probe (diagnostic surface stays
  // best-effort; the boot path is where the pin is a contract).
  let probeUrl = hostUrl;
  const hostPin = bosConfig.app.host.digest;
  if (hostPin) {
    // Probe the pin's immutable coordinates when the slot pins one (#874) —
    // the fixed name at the mutable slot root serves the newest bytes, so the
    // check would grade a composition the boot never loads. Resolution failure
    // keeps the floating probe: this surface is diagnostic and stays
    // best-effort; the boot path is where the pin is a contract.
    try {
      const resolvedPin = await resolveRemoteVersion({ base: hostUrl, digest: hostPin });
      probeUrl = pinnedManifestDocumentUrl(hostUrl, resolvedPin);
    } catch {
      probeUrl = hostUrl;
    }
  }
  let hostManifest: RemoteManifest | null = null;
  let hostReason: string | undefined;
  try {
    hostManifest = (await fetchManifest(probeUrl, timeoutMs)) as RemoteManifest;
  } catch (e) {
    hostReason = e instanceof Error ? e.message : String(e);
  }

  const hostVersion = hostManifest?.metaData?.pluginVersion ?? null;
  const hostShared = (hostManifest?.shared ?? []).filter(
    (s) => typeof s.requiredVersion === "string",
  );

  const remotes = listFederationRemotes(bosConfig);
  const settled = await Promise.allSettled(
    remotes.map(async ({ role, url }) => {
      let manifest: RemoteManifest | null = null;
      let reason: string | undefined;
      try {
        manifest = (await fetchManifest(url, timeoutMs)) as RemoteManifest;
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }

      const version = manifest?.metaData?.pluginVersion ?? null;
      const versionOk = version !== null && version === hostVersion;

      if (!manifest) {
        return {
          role,
          url,
          reachable: false,
          pluginVersion: null,
          ok: false,
          reason: reason ?? "unreachable",
        } satisfies FederationCompatRemote;
      }

      if (!versionOk) {
        return {
          role,
          url,
          reachable: true,
          pluginVersion: version,
          ok: false,
          reason: hostVersion
            ? `expected pluginVersion=${hostVersion} (host), got ${version ?? "missing"} — redeploy this plugin`
            : `host manifest missing pluginVersion`,
        } satisfies FederationCompatRemote;
      }

      const missingShared: string[] = [];
      const mismatchedShared: string[] = [];
      for (const hostDep of hostShared) {
        const remDep = manifest.shared?.find((s) => s.name === hostDep.name);
        if (!remDep) {
          missingShared.push(`${hostDep.name}@${hostDep.requiredVersion}`);
          continue;
        }
        if (!satisfiesConstraint(remDep.version ?? "", hostDep.requiredVersion!)) {
          mismatchedShared.push(
            `${hostDep.name}: remote=${remDep.version ?? "?"} hostReq=${hostDep.requiredVersion}`,
          );
        }
        if (isEffectCriticalSharedDep(hostDep.name)) {
          const hostVersion = hostDep.version ?? "";
          const remoteVersion = remDep.version ?? "";
          if (remoteVersion && remoteVersion !== hostVersion) {
            mismatchedShared.push(
              `${hostDep.name}: exact-version skew — remote=${remoteVersion} host=${hostVersion} — bundle was built against a different prerelease build; redeploy host and plugin together`,
            );
          }
          const remoteRequired =
            typeof remDep.requiredVersion === "string" ? remDep.requiredVersion.trim() : "";
          if (
            remoteRequired.length > 0 &&
            remoteRequired[0] !== "^" &&
            !satisfiesConstraint(hostVersion, remoteRequired)
          ) {
            mismatchedShared.push(
              `${hostDep.name}: train skew — host=${hostVersion} vs remote requiredVersion=${remoteRequired}`,
            );
          }
        }
      }

      const reasons = [
        ...missingShared.map((d) => `missing shared "${d}" required by host`),
        ...mismatchedShared,
      ];
      return {
        role,
        url,
        reachable: true,
        pluginVersion: version,
        ok: reasons.length === 0,
        reason: reasons[0],
      } satisfies FederationCompatRemote;
    }),
  );

  const remoteReports = settled.map((s, i) => {
    const placeholder = {
      role: remotes[i]!.role,
      url: remotes[i]!.url,
      reachable: false,
      pluginVersion: null,
      ok: false,
    };
    return s.status === "fulfilled" ? s.value : { ...placeholder, reason: String(s.reason) };
  });

  const ok =
    hostManifest !== null &&
    remoteReports.every((r) => r.ok && r.reachable && r.pluginVersion !== null);

  return {
    ok,
    hostVersion,
    hostReachable: hostManifest !== null,
    hostReason,
    remotes: remoteReports,
  };
}

export function loadBosConfigForMfCheck(configPath: string): BosConfig {
  return JSON.parse(readFileSync(configPath, "utf8")) as BosConfig;
}
