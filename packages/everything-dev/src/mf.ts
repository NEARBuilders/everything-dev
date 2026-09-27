import { readFileSync } from "node:fs";
import { createInstance, getInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import { isEffectCriticalSharedDep } from "every-plugin/build/rspack";
import { computeSriHash, type IntegrityRegistry } from "./integrity";
import type { BosConfig, BosPluginRef } from "./types";

type FederationInstance = ReturnType<typeof createInstance>;

let mfInstance: FederationInstance | null = null;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function patchManifestFetchForSsrPublicPath(mf: FederationInstance): void {
  if (!mf || !(mf as any).loaderHook?.lifecycle?.fetch?.on) return;
  if ((mf as any).__everythingDevPatchedManifestFetch === true) return;
  (mf as any).__everythingDevPatchedManifestFetch = true;

  (mf as any).loaderHook.lifecycle.fetch.on((url: unknown, init: unknown) => {
    if (typeof url !== "string" || !url.endsWith("/mf-manifest.json")) {
      return;
    }
    return fetchWithTimeout(url as string, init as RequestInit, 15_000)
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

    return fetchWithTimeout(url as string, init as RequestInit, 15_000).then(async (res) => {
      const buffer = Buffer.from(await res.arrayBuffer());
      const computed = computeSriHash(buffer);

      if (computed !== expectedHash) {
        console.error(
          `[SRI] Integrity check failed in MF fetch pipeline for ${url}\n  Expected: ${expectedHash}\n  Computed: ${computed}`,
        );
        return new Response(`Integrity check failed for ${url}`, {
          status: 500,
          statusText: "Integrity Check Failed",
        });
      }

      console.log(`[SRI] Integrity verified in pipeline for ${url}`);
      return new Response(buffer, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    });
  });
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
    if (opts.entry.endsWith("/remoteEntry.js")) return "script";
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

function parseSemver(v: unknown): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ""));
  return m ? { major: +m[1]!, minor: +m[2]!, patch: +m[3]! } : null;
}

function satisfiesConstraint(version: string, constraint: string): boolean {
  const trimmed = constraint.trim();
  if (!trimmed) return true;
  if (!["^", "~", ">", "<", "=", "x"].some((c) => trimmed.startsWith(c))) {
    return version === trimmed;
  }
  const m = /^\s*\^\s*(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!m) return true;
  const v = parseSemver(version);
  if (!v) return false;
  if (v.major !== +m[1]!) return false;
  if (v.minor < +m[2]! || (v.minor === +m[2]! && v.patch < +m[3]!)) return false;
  const constraintPrerelease = trimmed.match(/-([0-9A-Za-z.-]+)/);
  const versionPrerelease = /-([0-9A-Za-z.-]+)\s*$/.exec(version);
  if (constraintPrerelease) {
    if (!versionPrerelease) return false;
    const cPre = constraintPrerelease[1]!.split(".");
    const vPre = versionPrerelease[1]!.split(".");
    for (let i = 0; i < Math.max(cPre.length, vPre.length); i += 1) {
      const c = cPre[i] ?? "0";
      const p = vPre[i] ?? "0";
      if (c === p) continue;
      const cNum = /^\d+$/.test(c) ? +c : null;
      const pNum = /^\d+$/.test(p) ? +p : null;
      if (cNum !== null && pNum !== null) return cNum < pNum;
      return cNum === null ? c.localeCompare(p) < 0 : false;
    }
    return true;
  }
  if (versionPrerelease) return false;
  return true;
}

function manifestUrl(remoteUrl: string): string {
  return remoteUrl.endsWith("/") ? `${remoteUrl}mf-manifest.json` : `${remoteUrl}/mf-manifest.json`;
}

async function fetchManifest(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(manifestUrl(url), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function listFederationRemotes(bosConfig: BosConfig): Array<{ role: string; url: string }> {
  const out: Array<{ role: string; url: string }> = [];
  for (const role of ["api", "auth"] as const) {
    const url = readProductionUrl((bosConfig?.app as Record<string, unknown> | undefined)?.[role]);
    if (url) out.push({ role, url });
  }
  for (const [id, slot] of Object.entries(bosConfig?.plugins ?? {})) {
    const url = readProductionUrl(slot);
    if (url) out.push({ role: id, url });
  }
  return out;
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
  let hostManifest: RemoteManifest | null = null;
  let hostReason: string | undefined;
  try {
    hostManifest = (await fetchManifest(hostUrl, timeoutMs)) as RemoteManifest;
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
