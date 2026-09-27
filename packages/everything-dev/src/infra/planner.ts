import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Effect } from "effect";
import { PortAllocator, type PortBlockEntry } from "../app";
import {
  buildConventionalDatabases,
  buildConventionalRedis,
  getSecretGroups,
  loadPortState,
  savePortState,
} from "../cli/infra";
import {
  type AuthSlotShape,
  buildDescription,
  isAuthMirrorPluginEntry,
} from "../service-descriptor";
import type { RuntimeConfig } from "../types";
import { shouldPersistPortState } from "./materializer";
import { ownerOfPort } from "./port-ownership";
import type {
  ClaimRecord,
  CliPorts,
  DatabasePlan,
  InfraInput,
  InfraPlan,
  RedisPlan,
  ResolvedPorts,
  RuntimeLaunchSpec,
  ServiceDescriptorPlan,
} from "./types";
import { InfraError } from "./types";

const DEFAULT_HOST_PORT = 3000;

const POSTGRES_USER = "everythingdev";
const POSTGRES_PASSWORD = "everythingdev";

export function workspaceKey(configDir: string): string {
  const hash = createHash("sha256").update(resolve(configDir)).digest("hex");
  return hash.slice(0, 12);
}

function normalizeCliPorts(input: InfraInput["cli"]): CliPorts {
  return {
    host: input.port,
    api: input.apiPort,
    auth: input.authPort,
    ui: input.uiPort,
    pluginsStart: input.pluginPortStart,
    plugins: input.plugins,
  };
}

interface AllocateServicesResult {
  ports: ResolvedPorts;
  claims: ClaimRecord[];
  devPortsState: {
    host?: number;
    api?: number;
    auth?: number;
    ui?: number;
    pluginPortStart?: number;
  };
}

export interface ServiceSources {
  host?: "local" | "remote";
  api?: "local" | "remote";
  auth?: "local" | "remote";
  ui?: "local" | "remote";
}

const PLUGIN_START_OFFSET = 10;
const BLOCK_STEP = 100;

function allocateServices(
  cliPorts: CliPorts,
  plugins: Record<
    string,
    { source: string; localPath?: string; ui?: { source: string; localPath?: string } }
  >,
  configDir: string,
  auth?: AuthSlotShape,
  sources?: ServiceSources,
): Effect.Effect<AllocateServicesResult, InfraError, PortAllocator> {
  return Effect.gen(function* () {
    const wKey = workspaceKey(configDir);
    const persisted = loadPortState(configDir).devPorts;
    const allocator = yield* PortAllocator;

    const base = cliPorts.host ?? persisted?.host ?? DEFAULT_HOST_PORT;
    const pluginStartPreferred =
      cliPorts.pluginsStart ?? persisted?.pluginPortStart ?? base + PLUGIN_START_OFFSET;
    const pluginStartPinned =
      cliPorts.pluginsStart !== undefined || persisted?.pluginPortStart !== undefined;

    const entries: PortBlockEntry[] = [];
    const addEntry = (
      key: string,
      flag: number | undefined,
      persistedValue: number | undefined,
      derived: number,
    ) => {
      if (flag !== undefined) {
        entries.push({ key, preferred: flag, pinned: true });
      } else if (persistedValue !== undefined) {
        entries.push({ key, preferred: persistedValue, pinned: true });
      } else {
        entries.push({ key, preferred: derived, pinned: false });
      }
    };

    // Remote-source services spawn nothing locally (ADR 0009 start stack:
    // remotes load over MF from their published origins) — no port is
    // allocated for them. The host is the exception: even when loaded as a
    // remote module, runServer binds its own port.
    addEntry("host", cliPorts.host, undefined, base);
    if (sources?.api !== "remote") {
      addEntry("api", cliPorts.api, persisted?.api, base + 1);
    }
    if (sources?.auth !== "remote") {
      addEntry("auth", cliPorts.auth, persisted?.auth, base + 2);
    }
    if (sources?.ui !== "remote") {
      addEntry("ui", cliPorts.ui, persisted?.ui, base + 3);
    }

    const pluginKeys = Object.keys(plugins).sort();
    const isAuthMirrorFor = (
      pluginId: string,
      pluginCfg: { source: string; localPath?: string } | undefined,
    ) => pluginCfg !== undefined && isAuthMirrorPluginEntry(auth, pluginId, pluginCfg);

    let pluginSlot = 0;
    for (const pluginId of pluginKeys) {
      const pluginCfg = plugins[pluginId];
      const pluginIsLocal = pluginCfg?.source === "local";
      const slotBase = pluginStartPinned ? pluginStartPreferred : base + PLUGIN_START_OFFSET;
      // The auth mirror's backend is owned by the `auth` app slot — no api
      // port. Its ui surface is still real: without a port the runtime config
      // advertises an empty ui.url and the browser can never load the remote
      // (the /login page never renders).
      if (!isAuthMirrorFor(pluginId, pluginCfg) && pluginIsLocal) {
        addEntry(
          `plugin:${pluginId}`,
          cliPorts.plugins?.[pluginId]?.api,
          undefined,
          slotBase + pluginSlot,
        );
        pluginSlot += 1;
      }
      if (
        pluginCfg?.source === "local" &&
        pluginCfg?.localPath &&
        pluginCfg?.ui?.source === "local"
      ) {
        addEntry(
          `plugin-ui:${pluginId}`,
          cliPorts.plugins?.[pluginId]?.ui,
          undefined,
          slotBase + pluginSlot,
        );
        pluginSlot += 1;
      }
    }

    const allocation = yield* allocator.acquireBlock({ base, step: BLOCK_STEP, entries });

    if (allocation.base !== base) {
      console.error(
        `[Dev] Preferred port block starting at ${base} is occupied — using ${allocation.base} (this run only; restarts will retry ${base})`,
      );
      for (const conflict of allocation.conflicts.slice(0, 6)) {
        if (conflict.claimed) {
          console.error(
            `[Dev]   port ${conflict.port} (${conflict.key}) — live bos session (registry claim)`,
          );
        } else {
          const owner = yield* ownerOfPort(conflict.port);
          console.error(
            `[Dev]   port ${conflict.port} (${conflict.key}) — ${
              owner ? `pid ${owner.pid} (${owner.command})` : "foreign holder (lsof unavailable)"
            }`,
          );
        }
      }
    }

    const pluginApiPorts: Record<string, number> = {};
    const pluginUiPorts: Record<string, number> = {};
    for (const pluginId of pluginKeys) {
      const api = allocation.ports[`plugin:${pluginId}`];
      if (api !== undefined) pluginApiPorts[pluginId] = api;
      const ui = allocation.ports[`plugin-ui:${pluginId}`];
      if (ui !== undefined) pluginUiPorts[pluginId] = ui;
    }

    const resolved: ResolvedPorts = {
      host: allocation.ports.host,
      api: allocation.ports.api,
      auth: allocation.ports.auth,
      ui: allocation.ports.ui,
      plugins: Object.fromEntries(
        pluginKeys.map((k) => [k, { api: pluginApiPorts[k], ui: pluginUiPorts[k] }]),
      ),
    };

    const devPortsState = {
      host: cliPorts.host,
      api: cliPorts.api,
      auth: cliPorts.auth,
      ui: cliPorts.ui,
      pluginPortStart: cliPorts.pluginsStart,
    };

    const claimPorts: Record<string, number> = {};
    for (const [key, port] of Object.entries(allocation.ports)) {
      claimPorts[key] = port;
    }

    const claim: ClaimRecord = {
      resourceKey: `workspace:${wKey}`,
      pid: process.pid,
      configDir,
      ports: claimPorts,
      startedAt: Date.now(),
    };

    return { ports: resolved, claims: [claim], devPortsState };
  }).pipe(
    Effect.mapError(
      (portErr) =>
        new InfraError({
          phase: "allocate-services",
          message: `Port allocation failed: ${String(portErr)}`,
          cause: portErr,
        }),
    ),
  );
}

function allocateDatabases(runtimeConfig: RuntimeConfig): Effect.Effect<
  {
    dbs: DatabasePlan[];
    redisPlans: RedisPlan[];
  },
  InfraError,
  PortAllocator
> {
  return Effect.gen(function* () {
    const groups = getSecretGroups(runtimeConfig);
    const allSecrets = groups.flatMap((group) => group.secrets);
    const allocator = yield* PortAllocator;

    const conventionalDatabases = buildConventionalDatabases(allSecrets);
    const conventionalRedis = buildConventionalRedis(allSecrets);

    const dbs: DatabasePlan[] = [];
    const allocatedByDesired = new Map<number, number>();
    for (const db of conventionalDatabases) {
      let port: number;
      if (allocatedByDesired.has(db.port)) {
        port = allocatedByDesired.get(db.port)!;
      } else {
        port = yield* allocator.pickAvailable(db.port);
        allocatedByDesired.set(db.port, port);
      }
      dbs.push({
        secret: db.secret,
        slug: db.slug,
        port,
        dbName: db.databaseName,
        url: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${db.databaseName}`,
      });
    }

    const redisPlans: RedisPlan[] = [];
    for (const r of conventionalRedis) {
      const port = yield* allocator.pickAvailable(r.port);
      redisPlans.push({
        secret: r.secret,
        slug: r.slug,
        port,
        url: `redis://localhost:${port}`,
      });
    }

    return { dbs, redisPlans };
  }).pipe(
    Effect.mapError(
      (portErr) =>
        new InfraError({
          phase: "allocate-databases",
          message: `Database port allocation failed: ${String(portErr)}`,
          cause: portErr,
        }),
    ),
  );
}

export function buildServiceDescriptors(
  runtimeConfig: RuntimeConfig,
  resolvedPorts: ResolvedPorts,
): ServiceDescriptorPlan[] {
  const descriptors: ServiceDescriptorPlan[] = [];

  if (runtimeConfig.host) {
    const isLocal = runtimeConfig.host.source === "local";
    descriptors.push({
      key: "host",
      source: runtimeConfig.host.source,
      url: isLocal ? `http://localhost:${resolvedPorts.host}` : runtimeConfig.host.url,
      port: isLocal ? resolvedPorts.host : undefined,
      localPath: isLocal ? runtimeConfig.host.localPath : undefined,
    });
  }

  if (runtimeConfig.api) {
    const isLocal = runtimeConfig.api.source === "local";
    descriptors.push({
      key: "api",
      source: runtimeConfig.api.source,
      url: isLocal ? `http://localhost:${resolvedPorts.api}` : runtimeConfig.api.url,
      port: isLocal ? resolvedPorts.api : undefined,
      localPath: isLocal ? runtimeConfig.api.localPath : undefined,
    });
  }

  if (runtimeConfig.auth) {
    const isLocal = runtimeConfig.auth.source === "local";
    descriptors.push({
      key: "auth",
      source: runtimeConfig.auth.source,
      url: isLocal ? `http://localhost:${resolvedPorts.auth}` : runtimeConfig.auth.url,
      port: isLocal ? resolvedPorts.auth : undefined,
      localPath: isLocal ? runtimeConfig.auth.localPath : undefined,
    });
  }

  if (runtimeConfig.ui) {
    const isLocal = runtimeConfig.ui.source === "local";
    descriptors.push({
      key: "ui",
      source: runtimeConfig.ui.source,
      url: isLocal ? `http://localhost:${resolvedPorts.ui}` : runtimeConfig.ui.url,
      port: isLocal ? resolvedPorts.ui : undefined,
      localPath: isLocal ? runtimeConfig.ui.localPath : undefined,
    });
  }

  if (runtimeConfig.plugins) {
    for (const [pluginId, pluginCfg] of Object.entries(runtimeConfig.plugins)) {
      const pluginIsLocal = pluginCfg.source === "local";
      const p = resolvedPorts.plugins[pluginId];
      const isAuthMirror = isAuthMirrorPluginEntry(runtimeConfig.auth, pluginId, pluginCfg);
      if (pluginIsLocal && p?.api && !isAuthMirror) {
        descriptors.push({
          key: `plugin:${pluginId}`,
          source: "local",
          url: `http://localhost:${p.api}`,
          port: p.api,
          localPath: pluginCfg.localPath,
        });
      }
      if (!pluginIsLocal && pluginCfg.url && !isAuthMirror) {
        descriptors.push({
          key: `plugin:${pluginId}`,
          source: "remote",
          url: pluginCfg.url,
          port: undefined,
          localPath: undefined,
        });
      }
      if (pluginIsLocal && p?.ui && pluginCfg.ui?.source === "local") {
        descriptors.push({
          key: `plugin-ui:${pluginId}`,
          source: "local",
          url: `http://localhost:${p.ui}`,
          port: p.ui,
          localPath: pluginCfg.ui?.localPath,
        });
      }
    }
  }

  return descriptors;
}

export function buildLaunchSpec(
  runtimeConfig: RuntimeConfig,
  resolvedPorts: ResolvedPorts,
): RuntimeLaunchSpec {
  const hostPort =
    runtimeConfig.host?.source === "local" ? resolvedPorts.host : runtimeConfig.host?.port;
  const corsOrigin = hostPort ? `http://localhost:${hostPort}` : `http://localhost:3000`;

  return {
    port: resolvedPorts.host,
    hostUrl: runtimeConfig.host?.url,
    corsOrigin,
    env: {
      ...(resolvedPorts.host ? { PORT: String(resolvedPorts.host) } : {}),
      ...(resolvedPorts.api ? { API_PORT: String(resolvedPorts.api) } : {}),
      ...(resolvedPorts.ui ? { UI_PORT: String(resolvedPorts.ui) } : {}),
      ...(resolvedPorts.auth ? { AUTH_PORT: String(resolvedPorts.auth) } : {}),
    },
    runtimeConfig,
  };
}

export function buildEnvGenerated(
  resolvedPorts: ResolvedPorts,
  dbs: DatabasePlan[],
  redisPlans: RedisPlan[],
): Record<string, string> {
  const env: Record<string, string> = {};

  if (resolvedPorts.host) {
    env.CORS_ORIGIN = `http://localhost:${resolvedPorts.host}`;
    // The host origin for plugins that derive absolute URLs from it (e.g. the
    // auth plugin's Better Auth baseURL — email links, passkey RP id).
    env.BASE_URL = `http://localhost:${resolvedPorts.host}`;
  }

  for (const db of dbs) {
    env[db.secret] = db.url;
  }
  for (const r of redisPlans) {
    env[r.secret] = r.url;
  }

  return env;
}

export function planInfra(input: InfraInput): Effect.Effect<InfraPlan, InfraError, PortAllocator> {
  return Effect.gen(function* () {
    const cliPorts = normalizeCliPorts(input.cli);
    const wKey = workspaceKey(input.configDir);

    const plugins = (input.bosConfig.plugins ?? {}) as Record<
      string,
      { source: string; localPath?: string; ui?: { source: string; localPath?: string } }
    >;

    const {
      ports: svcPorts,
      claims,
      devPortsState,
    } = yield* allocateServices(cliPorts, plugins, input.configDir, input.bosConfig.auth, {
      host: input.bosConfig.host?.source,
      api: input.bosConfig.api?.source,
      auth: input.bosConfig.auth?.source,
      ui: input.bosConfig.ui?.source,
    });

    const { dbs, redisPlans } = yield* allocateDatabases(input.bosConfig);

    const resolvedPorts: ResolvedPorts = { ...svcPorts };

    // Write merged state once after all allocations succeed
    // Skip persistence for regression tests / ephemeral runs
    // devPorts pins are explicit choices only (ADR 0012 §4): this run's flags,
    // falling back to previously-persisted explicit choices — never drift.
    const previousDevPorts = loadPortState(input.configDir).devPorts ?? {};
    const devPorts = {
      host: devPortsState.host ?? previousDevPorts.host,
      api: devPortsState.api ?? previousDevPorts.api,
      auth: devPortsState.auth ?? previousDevPorts.auth,
      ui: devPortsState.ui ?? previousDevPorts.ui,
      pluginPortStart: devPortsState.pluginPortStart ?? previousDevPorts.pluginPortStart,
    };
    if (shouldPersistPortState()) {
      savePortState(input.configDir, { devPorts });
    }

    const hostIsLocal = input.bosConfig.host?.source === "local";
    const apiIsLocal = input.bosConfig.api?.source === "local";
    const uiIsLocal = input.bosConfig.ui?.source === "local";
    const authIsLocal = input.bosConfig.auth?.source === "local";
    const assignedRuntimeConfig: RuntimeConfig = {
      ...input.bosConfig,
      host: resolvedPorts.host
        ? {
            ...input.bosConfig.host,
            port: resolvedPorts.host,
            url: `http://localhost:${resolvedPorts.host}`,
            remoteUrl: !hostIsLocal
              ? (input.bosConfig.host.remoteUrl ?? input.bosConfig.host.url)
              : undefined,
          }
        : input.bosConfig.host,
      api:
        apiIsLocal && resolvedPorts.api
          ? {
              ...input.bosConfig.api,
              port: resolvedPorts.api,
              url: `http://localhost:${resolvedPorts.api}`,
            }
          : input.bosConfig.api,
      ui:
        uiIsLocal && resolvedPorts.ui
          ? {
              ...input.bosConfig.ui,
              port: resolvedPorts.ui,
              url: `http://localhost:${resolvedPorts.ui}`,
              ssrUrl: undefined,
            }
          : input.bosConfig.ui,
      auth:
        authIsLocal && resolvedPorts.auth && input.bosConfig.auth
          ? {
              ...input.bosConfig.auth,
              port: resolvedPorts.auth,
              url: `http://localhost:${resolvedPorts.auth}`,
            }
          : input.bosConfig.auth,
      plugins: input.bosConfig.plugins
        ? Object.fromEntries(
            Object.entries(input.bosConfig.plugins).map(([id, p]) => {
              const isAuthMirror = isAuthMirrorPluginEntry(input.bosConfig.auth, id, p);
              const pluginPort = resolvedPorts.plugins[id];
              const patchedUi = (() => {
                if (p.ui?.source !== "local" || !p.ui?.localPath || !pluginPort?.ui) return p.ui;
                return {
                  ...p.ui,
                  port: pluginPort.ui,
                  url: `http://localhost:${pluginPort.ui}`,
                  ssrUrl: undefined,
                };
              })();
              if (isAuthMirror) {
                return [id, { ...p, ui: patchedUi }];
              }
              if (p.source === "local" && pluginPort?.api) {
                return [
                  id,
                  {
                    ...p,
                    port: pluginPort.api,
                    url: `http://localhost:${pluginPort.api}`,
                    ui: patchedUi,
                  },
                ];
              }
              return [id, p];
            }),
          )
        : undefined,
    };

    const serviceDescriptors = buildServiceDescriptors(assignedRuntimeConfig, resolvedPorts);

    const launch = buildLaunchSpec(input.bosConfig, resolvedPorts);
    const envGenerated = buildEnvGenerated(resolvedPorts, dbs, redisPlans);

    const packages = serviceDescriptors.map((d) => d.key);
    const descriptionMap = new Map(serviceDescriptors.map((d) => [d.key, d]));
    const description = buildDescription(descriptionMap);

    const orchestrator = {
      packages,
      env: {},
      description,
      port: resolvedPorts.host,
      interactive: input.cli.interactive,
    };

    return {
      workspaceKey: wKey,
      cliPorts,
      resolvedPorts,
      runtimeConfig: assignedRuntimeConfig,
      launch,
      description,
      serviceDescriptors: new Map(serviceDescriptors.map((d) => [d.key, d])),
      envGenerated,
      claims,
      orchestrator,
    };
  });
}
