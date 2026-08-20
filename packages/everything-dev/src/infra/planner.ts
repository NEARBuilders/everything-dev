import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Effect } from "effect";
import { PortAllocator } from "../app";
import {
  buildDatabaseConfigs,
  buildOriginMap,
  buildRedisConfigs,
  type DatabaseSecretConfig,
  getSecretGroups,
  loadPortState,
  type RedisSecretConfig,
  savePortState,
} from "../cli/infra";
import { buildDescription } from "../service-descriptor";
import type { RuntimeConfig } from "../types";
import type {
  ClaimRecord,
  CliPorts,
  ComposeModelPlan,
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
const DEFAULT_API_PORT = 3001;
const DEFAULT_AUTH_PORT = 3002;
const DEFAULT_UI_PORT = 3003;
const DEFAULT_PLUGIN_PORT_START = 3010;
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
    uiSsr: undefined,
    pluginsStart: input.pluginPortStart,
    plugins: input.plugins,
  };
}

interface AllocateServicesResult {
  ports: ResolvedPorts;
  claims: ClaimRecord[];
  devPortsState: { host: number; api: number; auth: number; ui: number; pluginPortStart: number };
}

function allocateServices(
  cliPorts: CliPorts,
  plugins: Record<
    string,
    { source: string; localPath?: string; ui?: { source: string; localPath?: string } }
  >,
  configDir: string,
): Effect.Effect<AllocateServicesResult, InfraError, PortAllocator> {
  return Effect.gen(function* () {
    const wKey = workspaceKey(configDir);
    const persisted = loadPortState(configDir).devPorts;
    const allocator = yield* PortAllocator;

    const hostPort = yield* allocator.pickAvailable(
      cliPorts.host ?? persisted?.host ?? DEFAULT_HOST_PORT,
    );

    const apiPort = yield* allocator.pickAvailable(
      cliPorts.api ?? persisted?.api ?? DEFAULT_API_PORT,
    );

    const authPort = yield* allocator.pickAvailable(
      cliPorts.auth ?? persisted?.auth ?? DEFAULT_AUTH_PORT,
    );

    const uiPort = yield* allocator.pickAvailable(cliPorts.ui ?? persisted?.ui ?? DEFAULT_UI_PORT);

    const uiSsrPort = yield* allocator.pickAvailable(cliPorts.uiSsr ?? uiPort + 1);

    const pluginApiPorts: Record<string, number> = {};
    const pluginUiPorts: Record<string, number> = {};

    const pluginKeys = Object.keys(plugins).sort();
    const pluginStart =
      cliPorts.pluginsStart ?? persisted?.pluginPortStart ?? DEFAULT_PLUGIN_PORT_START;
    let nextPluginPort = pluginStart;
    for (const pluginId of pluginKeys) {
      const pluginCfg = plugins[pluginId];
      const preferred = cliPorts.plugins?.[pluginId]?.api ?? nextPluginPort;
      const pluginPort = yield* allocator.pickAvailable(preferred);
      pluginApiPorts[pluginId] = pluginPort;
      nextPluginPort = pluginPort + 1;

      if (
        pluginCfg?.source === "local" &&
        pluginCfg?.localPath &&
        pluginCfg?.ui?.source === "local"
      ) {
        const uiPreferred = cliPorts.plugins?.[pluginId]?.ui ?? nextPluginPort;
        const pluginUiPort = yield* allocator.pickAvailable(uiPreferred);
        pluginUiPorts[pluginId] = pluginUiPort;
        nextPluginPort = pluginUiPort + 1;
      }
    }

    const resolved: ResolvedPorts = {
      host: hostPort,
      api: apiPort,
      auth: authPort,
      ui: uiPort,
      uiSsr: uiSsrPort,
      plugins: Object.fromEntries(
        Object.entries(pluginApiPorts).map(([k, v]) => [k, { api: v, ui: pluginUiPorts[k] }]),
      ),
      postgres: {},
      redis: {},
    };

    const devPortsState = {
      host: hostPort,
      api: apiPort,
      auth: authPort,
      ui: uiPort,
      pluginPortStart: pluginStart,
    };

    const claimPorts: Record<string, number> = {
      host: hostPort,
      api: apiPort,
      auth: authPort,
      ui: uiPort,
      uiSsr: uiSsrPort,
    };
    for (const [id, port] of Object.entries(pluginApiPorts)) {
      claimPorts[`plugin:${id}`] = port;
    }
    for (const [id, port] of Object.entries(pluginUiPorts)) {
      claimPorts[`plugin-ui:${id}`] = port;
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

function allocateDatabases(
  runtimeConfig: RuntimeConfig,
  configDir: string,
): Effect.Effect<
  {
    postgres: Record<string, number>;
    redis: Record<string, number>;
    dbs: DatabasePlan[];
    redisPlans: RedisPlan[];
  },
  InfraError,
  PortAllocator
> {
  return Effect.gen(function* () {
    const persisted = loadPortState(configDir);
    const groups = getSecretGroups(runtimeConfig);
    const allSecrets = groups.flatMap((group) => group.secrets);
    const originMap = buildOriginMap(configDir, runtimeConfig);
    const allocator = yield* PortAllocator;

    const infraDatabases: DatabaseSecretConfig[] = yield* Effect.sync(() =>
      buildDatabaseConfigs(allSecrets, originMap, { ...persisted.postgresPorts }),
    );
    const infraRedis: RedisSecretConfig[] = yield* Effect.sync(() =>
      buildRedisConfigs(allSecrets, originMap, { ...persisted.redisPorts }),
    );

    const postgres: Record<string, number> = {};
    const dbs: DatabasePlan[] = [];
    for (const db of infraDatabases) {
      const port = yield* allocator.pickAvailable(db.port);
      postgres[db.slug] = port;
      dbs.push({
        secret: db.secret,
        slug: db.slug,
        port,
        dbName: db.databaseName,
        containerName: db.containerName,
        volumeName: db.volumeName,
        url: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${db.slug}_db`,
      });
    }

    const redis: Record<string, number> = {};
    const redisPlans: RedisPlan[] = [];
    for (const r of infraRedis) {
      const port = yield* allocator.pickAvailable(r.port);
      redis[r.slug] = port;
      redisPlans.push({
        secret: r.secret,
        slug: r.slug,
        port,
        containerName: r.containerName,
        volumeName: r.volumeName,
        url: `redis://localhost:${port}`,
      });
    }

    return { postgres, redis, dbs, redisPlans };
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
    if (isLocal && resolvedPorts.uiSsr) {
      descriptors.push({
        key: "ui-ssr",
        source: "local",
        url: `http://localhost:${resolvedPorts.uiSsr}`,
        port: resolvedPorts.uiSsr,
        localPath: runtimeConfig.ui.localPath,
      });
    }
  }

  if (runtimeConfig.plugins) {
    for (const [pluginId, pluginCfg] of Object.entries(runtimeConfig.plugins)) {
      const pluginIsLocal = pluginCfg.source === "local";
      const p = resolvedPorts.plugins[pluginId];
      if (pluginIsLocal && p?.api) {
        descriptors.push({
          key: `plugin:${pluginId}`,
          source: "local",
          url: `http://localhost:${p.api}`,
          port: p.api,
          localPath: pluginCfg.localPath,
        });
      }
      if (!pluginIsLocal && pluginCfg.url) {
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

export function buildComposeModel(dbs: DatabasePlan[], redisPlans: RedisPlan[]): ComposeModelPlan {
  return { databases: dbs, redis: redisPlans };
}

export function buildEnvGenerated(
  resolvedPorts: ResolvedPorts,
  dbs: DatabasePlan[],
  redisPlans: RedisPlan[],
): Record<string, string> {
  const env: Record<string, string> = {};

  if (resolvedPorts.host) {
    env.CORS_ORIGIN = `http://localhost:${resolvedPorts.host}`;
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
    } = yield* allocateServices(cliPorts, plugins, input.configDir);

    const {
      dbs,
      redisPlans,
      postgres: pgPorts,
      redis: rdPorts,
    } = yield* allocateDatabases(input.bosConfig, input.configDir);

    const resolvedPorts: ResolvedPorts = {
      ...svcPorts,
      postgres: pgPorts,
      redis: rdPorts,
    };

    // Write merged state once after all allocations succeed
    // Skip persistence for regression tests / ephemeral runs
    if (process.env.BOS_NO_PERSIST_PORTS !== "1") {
      savePortState(input.configDir, {
        postgresPorts: pgPorts,
        redisPorts: rdPorts,
        devPorts: devPortsState,
      });
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
              ssrUrl:
                input.cli.ssr && resolvedPorts.uiSsr
                  ? `http://localhost:${resolvedPorts.uiSsr}`
                  : input.bosConfig.ui.ssrUrl,
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
              const pluginPort = resolvedPorts.plugins[id];
              if (p.source === "local" && pluginPort?.api) {
                return [
                  id,
                  { ...p, port: pluginPort.api, url: `http://localhost:${pluginPort.api}` },
                ];
              }
              return [id, p];
            }),
          )
        : undefined,
    };

    const serviceDescriptors = buildServiceDescriptors(input.bosConfig, resolvedPorts);

    const launch = buildLaunchSpec(input.bosConfig, resolvedPorts);
    const composeModel = buildComposeModel(dbs, redisPlans);
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
      composeModel,
      claims,
      orchestrator,
    };
  });
}
